package account

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"
)

/*
The account area (fadymondy's internal/rest/account_area_api.go,
account_delete_handler.go, account_export_api.go). Huma operations, so errors
carry `detail` (application/problem+json) exactly as fadymondy's do. Every call
acts on the session's account and takes no account id. Cookie writes need the
CSRF token (X-CSRF-Token echoing the togo_csrf cookie); bearer calls are exempt.

	GET/PUT  /api/me/account/profile
	GET/PUT  /api/me/account/notifications
	GET/POST /api/me/account/export
	GET      /api/me/account/export/download?token=
	GET/POST /api/me/delete
	POST     /api/me/delete/cancel      (public: email + password)
*/

type accountProfile struct {
	Email       string `json:"email"`
	Name        string `json:"name"`
	Avatar      string `json:"avatar"`
	Timezone    string `json:"timezone"`
	Verified    bool   `json:"verified"`
	HasPassword bool   `json:"has_password"`
}

// accountPrefs is a flat object of booleans (the console's contract).
type accountPrefs struct {
	SecurityAlerts bool `json:"security_alerts" doc:"Email me about sign-ins and security changes."`
	ProductUpdates bool `json:"product_updates" doc:"Email me Zekra product updates."`
	WeeklyDigest   bool `json:"weekly_digest" doc:"Email me a weekly digest of my brains."`
}

// CSRFIn carries the double-submit CSRF inputs (exported: Huma only flattens exported embedded structs).
type CSRFIn struct {
	Authorization string `header:"Authorization"`
	CSRFHeader    string `header:"X-CSRF-Token"`
	CSRFCookie    string `cookie:"togo_csrf"`
}

func (c CSRFIn) ok() bool { return csrfValues(c.Authorization, c.CSRFHeader, c.CSRFCookie) }

func sessionAccount(ctx context.Context) (*auth.Identity, error) {
	id, ok := auth.IdentityFrom(ctx)
	if !ok || id == nil || id.ID == "" {
		return nil, huma.Error401Unauthorized("sign in first")
	}
	return id, nil
}

func (s *Service) loadProfile(ctx context.Context, userID string) accountProfile {
	var p accountProfile
	var hash string
	_ = s.DB.QueryRowContext(ctx, `SELECT lower(email), password_hash FROM users WHERE id = $1`, userID).Scan(&p.Email, &hash)
	p.HasPassword = strings.HasPrefix(hash, "$2") // bcrypt; SSO accounts carry a marker
	p.Verified = s.Verified(ctx, userID)
	_ = s.DB.QueryRowContext(ctx, `SELECT name, avatar, timezone FROM account_profiles WHERE user_id = $1`, userID).Scan(&p.Name, &p.Avatar, &p.Timezone)
	return p
}

func (s *Service) loadPrefs(ctx context.Context, userID string) accountPrefs {
	p := accountPrefs{SecurityAlerts: true}
	_ = s.DB.QueryRowContext(ctx, `SELECT security_alerts, product_updates, weekly_digest FROM account_prefs WHERE user_id = $1`, userID).
		Scan(&p.SecurityAlerts, &p.ProductUpdates, &p.WeeklyDigest)
	return p
}

// RegisterAreaAPI mounts the account area on api. s may be nil when only the
// OpenAPI document is being built.
func RegisterAreaAPI(api huma.API, s *Service) {
	tags := []string{"Account"}

	huma.Register(api, huma.Operation{
		OperationID: "account-profile-get", Method: http.MethodGet, Path: "/api/me/account/profile",
		Summary: "Your profile", Tags: tags, Errors: []int{401},
	}, func(ctx context.Context, _ *struct{}) (*struct{ Body accountProfile }, error) {
		id, err := sessionAccount(ctx)
		if err != nil {
			return nil, err
		}
		return &struct{ Body accountProfile }{Body: s.loadProfile(ctx, id.ID)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "account-profile-update", Method: http.MethodPut, Path: "/api/me/account/profile",
		Summary: "Update your display name, avatar and timezone", Tags: tags, Errors: []int{401, 403, 422},
	}, func(ctx context.Context, in *struct {
		CSRFIn
		// Each field is optional: one left out keeps its saved value (the apps
		// edit name + timezone only and must not wipe the avatar).
		Body struct {
			Name     *string `json:"name,omitempty" maxLength:"80"`
			Avatar   *string `json:"avatar,omitempty" maxLength:"500"`
			Timezone *string `json:"timezone,omitempty" maxLength:"64"`
		}
	}) (*struct{ Body accountProfile }, error) {
		id, err := sessionAccount(ctx)
		if err != nil {
			return nil, err
		}
		if !in.ok() {
			return nil, huma.Error403Forbidden("invalid csrf token")
		}
		cur := s.loadProfile(ctx, id.ID)
		pick := func(v *string, keep string) string {
			if v == nil {
				return keep
			}
			return strings.TrimSpace(*v)
		}
		name, avatar, tz := pick(in.Body.Name, cur.Name), pick(in.Body.Avatar, cur.Avatar), pick(in.Body.Timezone, cur.Timezone)
		if avatar != "" {
			if u, err := url.Parse(avatar); err != nil || u.Scheme != "https" || u.Host == "" {
				return nil, huma.Error422UnprocessableEntity("the avatar must be an https address")
			}
		}
		if tz != "" {
			if _, err := time.LoadLocation(tz); err != nil {
				return nil, huma.Error422UnprocessableEntity("that is not a known timezone")
			}
		}
		if _, err := s.DB.ExecContext(ctx, `
			INSERT INTO account_profiles (user_id, name, avatar, timezone) VALUES ($1,$2,$3,$4)
			ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, avatar = EXCLUDED.avatar,
				timezone = EXCLUDED.timezone, updated_at = now()`, id.ID, name, avatar, tz); err != nil {
			return nil, huma.Error500InternalServerError("could not save your profile", err)
		}
		return &struct{ Body accountProfile }{Body: s.loadProfile(ctx, id.ID)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "account-notifications-get", Method: http.MethodGet, Path: "/api/me/account/notifications",
		Summary: "Your notification preferences", Tags: tags, Errors: []int{401},
	}, func(ctx context.Context, _ *struct{}) (*struct{ Body accountPrefs }, error) {
		id, err := sessionAccount(ctx)
		if err != nil {
			return nil, err
		}
		return &struct{ Body accountPrefs }{Body: s.loadPrefs(ctx, id.ID)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "account-notifications-update", Method: http.MethodPut, Path: "/api/me/account/notifications",
		Summary: "Change your notification preferences", Tags: tags, Errors: []int{401, 403},
	}, func(ctx context.Context, in *struct {
		CSRFIn
		Body struct {
			SecurityAlerts *bool `json:"security_alerts,omitempty"`
			ProductUpdates *bool `json:"product_updates,omitempty"`
			WeeklyDigest   *bool `json:"weekly_digest,omitempty"`
		}
	}) (*struct{ Body accountPrefs }, error) {
		id, err := sessionAccount(ctx)
		if err != nil {
			return nil, err
		}
		if !in.ok() {
			return nil, huma.Error403Forbidden("invalid csrf token")
		}
		// A partial body keeps the fields it leaves out.
		p := s.loadPrefs(ctx, id.ID)
		if in.Body.SecurityAlerts != nil {
			p.SecurityAlerts = *in.Body.SecurityAlerts
		}
		if in.Body.ProductUpdates != nil {
			p.ProductUpdates = *in.Body.ProductUpdates
		}
		if in.Body.WeeklyDigest != nil {
			p.WeeklyDigest = *in.Body.WeeklyDigest
		}
		if _, err := s.DB.ExecContext(ctx, `
			INSERT INTO account_prefs (user_id, security_alerts, product_updates, weekly_digest, updated_at) VALUES ($1,$2,$3,$4, now())
			ON CONFLICT (user_id) DO UPDATE SET security_alerts = EXCLUDED.security_alerts, product_updates = EXCLUDED.product_updates,
				weekly_digest = EXCLUDED.weekly_digest, updated_at = now()`,
			id.ID, p.SecurityAlerts, p.ProductUpdates, p.WeeklyDigest); err != nil {
			return nil, huma.Error500InternalServerError("could not save your preferences", err)
		}
		return &struct{ Body accountPrefs }{Body: s.loadPrefs(ctx, id.ID)}, nil
	})

	// ---- data export -----------------------------------------------------------

	huma.Register(api, huma.Operation{
		OperationID: "account-export-state", Method: http.MethodGet, Path: "/api/me/account/export",
		Summary: "Your latest data export", Tags: tags, Errors: []int{401},
	}, func(ctx context.Context, _ *struct{}) (*struct{ Body ExportState }, error) {
		id, err := sessionAccount(ctx)
		if err != nil {
			return nil, err
		}
		st, err := s.ExportStatus(ctx, id.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("could not read your export", err)
		}
		return &struct{ Body ExportState }{Body: st}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "account-export-request", Method: http.MethodPost, Path: "/api/me/account/export",
		Summary: "Request a copy of your data; the link arrives by email", Tags: tags, Errors: []int{401, 403, 429},
	}, func(ctx context.Context, in *struct {
		CSRFIn
		Body struct {
			Locale string `json:"locale,omitempty" enum:"en,ar"`
		}
	}) (*struct{ Body ExportState }, error) {
		id, err := sessionAccount(ctx)
		if err != nil {
			return nil, err
		}
		if !in.ok() {
			return nil, huma.Error403Forbidden("invalid csrf token")
		}
		locale := in.Body.Locale
		if locale == "" {
			locale = "en"
		}
		st, err := s.RequestExport(ctx, id.ID, locale, false)
		if errors.Is(err, ErrExportTooSoon) {
			return nil, huma.Error429TooManyRequests(err.Error())
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("could not start your export", err)
		}
		return &struct{ Body ExportState }{Body: st}, nil
	})

	type downloadOut struct {
		ContentType        string `header:"Content-Type"`
		ContentDisposition string `header:"Content-Disposition"`
		CacheControl       string `header:"Cache-Control"`
		Body               []byte
	}
	huma.Register(api, huma.Operation{
		OperationID: "account-export-download", Method: http.MethodGet, Path: "/api/me/account/export/download",
		Summary: "Download your data export (once)", Tags: tags, Errors: []int{401, 410},
	}, func(ctx context.Context, in *struct {
		Token string `query:"token" maxLength:"128"`
	}) (*downloadOut, error) {
		id, err := sessionAccount(ctx)
		if err != nil {
			return nil, err
		}
		zipped, ready, err := s.DownloadExport(ctx, in.Token, id.ID)
		if err != nil {
			return nil, huma.Error410Gone(err.Error())
		}
		return &downloadOut{
			ContentType:        "application/zip",
			ContentDisposition: `attachment; filename="zekra-data-` + ready.UTC().Format(time.DateOnly) + `.zip"`,
			CacheControl:       "no-store",
			Body:               zipped,
		}, nil
	})

	// ---- delete my account -----------------------------------------------------

	fail := func(err error) error {
		switch {
		case errors.Is(err, ErrWrongPassword), errors.Is(err, ErrBadCredentials):
			return huma.Error403Forbidden(err.Error())
		case errors.Is(err, ErrRateLimited):
			return huma.Error429TooManyRequests(err.Error())
		case errors.Is(err, ErrBadMode):
			return huma.Error422UnprocessableEntity(err.Error())
		case errors.Is(err, ErrNoPending), errors.Is(err, ErrGraceOver):
			return huma.Error409Conflict(err.Error())
		}
		if s != nil {
			s.log().Error("account deletion failed", "err", err)
		}
		return huma.Error500InternalServerError("could not complete the request")
	}

	type deleteOut struct {
		SetCookie http.Cookie `header:"Set-Cookie"`
		RequestID string      `header:"X-Request-Id"`
		Body      struct {
			Status       string `json:"status" example:"scheduled"`
			ScheduledFor string `json:"scheduled_for" format:"date-time"`
		}
	}
	huma.Register(api, huma.Operation{
		OperationID: "account-delete", Method: http.MethodPost, Path: "/api/me/delete",
		Summary:     "Schedule deletion of your account",
		Description: "Re-authenticates with the password, schedules deletion 14 days out, and signs the account out everywhere immediately.",
		Tags:        tags, Errors: []int{401, 403, 409, 422, 429},
	}, func(ctx context.Context, in *struct {
		ForwardedFor   string `header:"X-Forwarded-For"`
		ForwardedProto string `header:"X-Forwarded-Proto"`
		RequestID      string `header:"X-Request-Id"`
		Body           struct {
			Password     string `json:"password" minLength:"1" maxLength:"1024" doc:"The account password. Required: a session alone cannot delete an account."`
			Testimonials string `json:"testimonials,omitempty" enum:"anonymise,withdraw" doc:"Accepted for fadymondy parity; Zekra has no testimonials."`
		}
	}) (*deleteOut, error) {
		id, err := sessionAccount(ctx)
		if err != nil {
			return nil, err
		}
		// Deleting the admin account from a settings page would lock the owner out.
		if isAdmin(id) {
			return nil, huma.Error409Conflict("the site owner's account cannot be deleted from here")
		}
		meta := metaFromHeaders(in.ForwardedFor, in.RequestID)
		row, err := s.Schedule(ctx, id.ID, in.Body.Password, in.Body.Testimonials, meta)
		if err != nil {
			return nil, fail(err)
		}
		out := &deleteOut{RequestID: meta.RequestID}
		out.SetCookie = *ClearSessionCookie(strings.EqualFold(in.ForwardedProto, "https"))
		out.Body.Status = StatusScheduled
		out.Body.ScheduledFor = row.ScheduledFor.UTC().Format(time.RFC3339)
		return out, nil
	})

	type deleteState struct {
		Status       string `json:"status" enum:"none,scheduled,cancelled,purged"`
		ScheduledFor string `json:"scheduled_for,omitempty" format:"date-time"`
		RequestedAt  string `json:"requested_at,omitempty" format:"date-time"`
		CancelledAt  string `json:"cancelled_at,omitempty" format:"date-time"`
		Testimonials string `json:"testimonials,omitempty"`
	}
	huma.Register(api, huma.Operation{
		OperationID: "account-delete-status", Method: http.MethodGet, Path: "/api/me/delete",
		Summary: "Your account deletion request, if any", Tags: tags, Errors: []int{401},
	}, func(ctx context.Context, _ *struct{}) (*struct{ Body deleteState }, error) {
		id, err := sessionAccount(ctx)
		if err != nil {
			return nil, err
		}
		latest, err := s.Latest(ctx, id.ID)
		if err != nil {
			return nil, fail(err)
		}
		out := &struct{ Body deleteState }{}
		if latest == nil {
			out.Body.Status = StatusNone
			return out, nil
		}
		out.Body.Status = latest.Status
		if out.Body.Status != StatusCancelled && out.Body.Status != StatusPurged {
			out.Body.Status = StatusScheduled // "purging" is internal
		}
		out.Body.ScheduledFor = latest.ScheduledFor.UTC().Format(time.RFC3339)
		out.Body.RequestedAt = latest.RevokedAt.UTC().Format(time.RFC3339)
		if latest.CancelledAt != nil {
			out.Body.CancelledAt = latest.CancelledAt.UTC().Format(time.RFC3339)
		}
		out.Body.Testimonials = latest.Testimonials
		return out, nil
	})

	type cancelOut struct {
		RequestID string `header:"X-Request-Id"`
		Body      struct {
			Status string `json:"status" example:"cancelled"`
		}
	}
	huma.Register(api, huma.Operation{
		OperationID: "account-delete-cancel", Method: http.MethodPost, Path: "/api/me/delete/cancel",
		Summary:     "Cancel a pending account deletion",
		Description: "No session needed: deleting signed you out. The same 403 answers an unknown email and a wrong password.",
		Tags:        tags, Errors: []int{403, 409, 429},
	}, func(ctx context.Context, in *struct {
		ForwardedFor string `header:"X-Forwarded-For"`
		RequestID    string `header:"X-Request-Id"`
		Body         struct {
			Email    string `json:"email" minLength:"1" maxLength:"320"`
			Password string `json:"password" minLength:"1" maxLength:"1024"`
		}
	}) (*cancelOut, error) {
		meta := metaFromHeaders(in.ForwardedFor, in.RequestID)
		if err := s.Cancel(ctx, in.Body.Email, in.Body.Password, meta); err != nil {
			return nil, fail(err)
		}
		out := &cancelOut{RequestID: meta.RequestID}
		out.Body.Status = StatusCancelled
		return out, nil
	})
}

func metaFromHeaders(forwardedFor, requestID string) Meta {
	ip := strings.TrimSpace(strings.Split(forwardedFor, ",")[0])
	if ip == "" {
		ip = "unknown"
	}
	rid := strings.TrimSpace(requestID)
	if rid == "" || len(rid) > 128 {
		rid = randomHex(12)
	}
	return Meta{RequestID: rid, IP: ip}
}
