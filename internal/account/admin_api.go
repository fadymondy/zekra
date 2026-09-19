package account

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"
)

/*
Admin control panel API: every account, and Zekra-wide stats. Admin tier only —
RequireSession answers 403 unless the caller's CURRENT roles (read from the users
table, not the token) include admin or owner. Every write needs the CSRF token
for cookie callers and is written to account_audit. Errors carry both `error`
and `detail` (see apiError).

Brain-level administration (brains, brain tokens, grants, secrets, datasources)
already lives under /api/brain/* and is not duplicated here.

	GET    /api/admin/stats                         flat {metric: number}
	GET    /api/admin/users?q=&page=&per_page=      {users, total, page, per_page}
	GET    /api/admin/users/{id}                    {user, details}
	PUT    /api/admin/users/{id}/roles              {roles: ["admin"|"owner"|"member"]} -> {user}
	POST   /api/admin/users/{id}/disable            {reason?} -> {user}; also signs out everywhere
	POST   /api/admin/users/{id}/enable             -> {user}
	DELETE /api/admin/users/{id}                    204; the account and its account-area data, now
	POST   /api/admin/users/{id}/resend-verification -> {status: "sent"}
	POST   /api/admin/users/{id}/verify             -> {status: "verified"}
	POST   /api/admin/users/{id}/2fa-reset          -> {status: "reset"}
	GET    /api/admin/users/{id}/sessions           server-side sessions (SESSION_DRIVER=database)
	POST   /api/admin/users/{id}/sessions/revoke    {id?} one session, or all (works for stateless JWTs too)

Self-protection is enforced here, not only hidden in the UI: an admin cannot
demote, disable or delete themselves, and the last admin/owner cannot be
demoted, disabled or deleted.
*/

// grantableRoles are the roles the console may set.
var grantableRoles = map[string]bool{"admin": true, "owner": true, "member": true}

var (
	errNoAccount  = errors.New("user not found")
	errOwnAccount = errors.New("you cannot do this to your own account")
	errLastAdmin  = errors.New("this is the last admin account")
)

// apiError is a Huma error whose body carries both `error` (what the console
// reads) and `detail` (Huma's problem+json field, what fadymondy's clients read).
type apiError struct {
	Status int    `json:"status"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Err    string `json:"error"`
	Code   string `json:"code,omitempty"`
}

func (e *apiError) Error() string  { return e.Detail }
func (e *apiError) GetStatus() int { return e.Status }

func apiErr(status int, msg, code string) error {
	return &apiError{Status: status, Title: http.StatusText(status), Detail: msg, Err: msg, Code: code}
}

func adminErr(err error) error {
	switch {
	case errors.Is(err, errNoAccount):
		return apiErr(http.StatusNotFound, err.Error(), "user_not_found")
	case errors.Is(err, errOwnAccount):
		return apiErr(http.StatusConflict, err.Error(), "own_account")
	case errors.Is(err, errLastAdmin):
		return apiErr(http.StatusConflict, err.Error(), "last_admin")
	}
	return apiErr(http.StatusInternalServerError, "the request failed", "")
}

var errCSRF = apiErr(http.StatusForbidden, "invalid csrf token", "csrf")

// AdminUser is the console's User.
type AdminUser struct {
	ID            string   `json:"id"`
	Email         string   `json:"email"`
	Name          string   `json:"name"`
	Roles         []string `json:"roles"`
	EmailVerified bool     `json:"email_verified"`
	Disabled      bool     `json:"disabled"`
	TwoFactor     bool     `json:"two_factor"`
	CreatedAt     string   `json:"created_at"`
	LastLoginAt   *string  `json:"last_login_at"`
}

// AdminUserDetails is the extra security state beside the user on the detail view.
type AdminUserDetails struct {
	HasPassword       bool           `json:"has_password"`
	DisabledReason    string         `json:"disabled_reason,omitempty"`
	DisabledAt        *string        `json:"disabled_at,omitempty"`
	LoginCount        int64          `json:"login_count"`
	RecoveryCodesLeft int            `json:"recovery_codes_left"`
	Identities        []identityView `json:"identities"`
	SessionsRevokedAt *string        `json:"sessions_revoked_at"`
	Deletion          string         `json:"deletion" doc:"none | scheduled | cancelled | purged"`
	DeletionScheduled *string        `json:"deletion_scheduled_for,omitempty"`
	Avatar            string         `json:"avatar"`
	Timezone          string         `json:"timezone"`
}

const adminUserSelect = `
	SELECT u.id, u.email, COALESCE(u.roles,''), COALESCE(u.created_at,''),
	       COALESCE(p.name,''),
	       NOT EXISTS (SELECT 1 FROM account_unverified v WHERE v.user_id = u.id),
	       EXISTS (SELECT 1 FROM account_disabled d WHERE d.user_id = u.id),
	       COALESCE((SELECT t.enabled FROM account_totp t WHERE t.user_id = u.id), FALSE),
	       a.last_login_at
	  FROM users u
	  LEFT JOIN account_profiles p ON p.user_id = u.id
	  LEFT JOIN account_activity a ON a.user_id = u.id`

func scanAdminUser(sc interface{ Scan(...any) error }) (AdminUser, error) {
	var u AdminUser
	var roles string
	var last sql.NullTime
	err := sc.Scan(&u.ID, &u.Email, &roles, &u.CreatedAt, &u.Name, &u.EmailVerified, &u.Disabled, &u.TwoFactor, &last)
	u.Roles = splitCSV(roles)
	u.LastLoginAt = fmtTime(last)
	return u, err
}

func (s *Service) adminUser(ctx context.Context, userID string) (*AdminUser, error) {
	u, err := scanAdminUser(s.DB.QueryRowContext(ctx, adminUserSelect+` WHERE u.id = $1`, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNoAccount
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Service) adminDetails(ctx context.Context, userID string) AdminUserDetails {
	d := AdminUserDetails{Identities: []identityView{}, Deletion: StatusNone}
	d.HasPassword, _ = s.hasPassword(ctx, userID)
	var disabledAt sql.NullTime
	_ = s.DB.QueryRowContext(ctx, `SELECT reason, disabled_at FROM account_disabled WHERE user_id = $1`, userID).Scan(&d.DisabledReason, &disabledAt)
	d.DisabledAt = fmtTime(disabledAt)
	_ = s.DB.QueryRowContext(ctx, `SELECT login_count FROM account_activity WHERE user_id = $1`, userID).Scan(&d.LoginCount)
	_ = s.DB.QueryRowContext(ctx, `SELECT count(*) FROM account_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, userID).Scan(&d.RecoveryCodesLeft)
	d.SessionsRevokedAt = fmtTime(s.revokedAt(ctx, userID))
	if latest, err := s.Latest(ctx, userID); err == nil && latest != nil {
		d.Deletion = latest.Status
		if d.Deletion == statusPurging {
			d.Deletion = StatusScheduled
		}
		if d.Deletion == StatusScheduled {
			d.DeletionScheduled = fmtTime(sql.NullTime{Time: latest.ScheduledFor, Valid: true})
		}
	}
	_ = s.DB.QueryRowContext(ctx, `SELECT avatar, timezone FROM account_profiles WHERE user_id = $1`, userID).Scan(&d.Avatar, &d.Timezone)
	if ids, err := s.listIdentities(ctx, userID); err == nil {
		d.Identities = ids
	}
	return d
}

func (s *Service) revokedAt(ctx context.Context, userID string) sql.NullTime {
	var at sql.NullTime
	_ = s.DB.QueryRowContext(ctx, `SELECT GREATEST((SELECT reset_at FROM account_password_resets WHERE user_id = $1),
		(SELECT revoked_at FROM account_session_revocations WHERE user_id = $1))`, userID).Scan(&at)
	return at
}

func fmtTime(t sql.NullTime) *string {
	if !t.Valid {
		return nil
	}
	v := t.Time.UTC().Format(time.RFC3339)
	return &v
}

const adminRoleCond = `((','||COALESCE(roles,'')||',') LIKE '%,admin,%' OR (','||COALESCE(roles,'')||',') LIKE '%,owner,%')`

func (s *Service) countAdmins(ctx context.Context) int {
	var n int
	_ = s.DB.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE `+adminRoleCond).Scan(&n)
	return n
}

func (s *Service) userRoles(ctx context.Context, userID string) ([]string, error) {
	var roles string
	err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(roles,'') FROM users WHERE id = $1`, userID).Scan(&roles)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNoAccount
	}
	return splitCSV(roles), err
}

// guardAdminLoss refuses an action that would take the admin tier from the caller
// themselves, or from the last admin/owner account.
func (s *Service) guardAdminLoss(ctx context.Context, targetID string, targetRoles []string) error {
	if targetID == actor(ctx) {
		return errOwnAccount
	}
	if hasRole(targetRoles, "admin", "owner") && s.countAdmins(ctx) <= 1 {
		return errLastAdmin
	}
	return nil
}

// revokeAllSessions signs a user out everywhere: every token issued up to now is
// refused, and server-side sessions are deleted.
func (s *Service) revokeAllSessions(ctx context.Context, userID string) (int, error) {
	if _, err := s.DB.ExecContext(ctx, `
		INSERT INTO account_session_revocations (user_id, revoked_at) VALUES ($1,$2)
		ON CONFLICT (user_id) DO UPDATE SET revoked_at = EXCLUDED.revoked_at`, userID, s.now().UTC()); err != nil {
		return 0, err
	}
	return s.sweepSessions(ctx, userID), nil
}

func actor(ctx context.Context) string {
	if id, ok := auth.IdentityFrom(ctx); ok && id != nil {
		return id.ID
	}
	return ""
}

type statusOut struct {
	Body struct {
		Status string `json:"status"`
	}
}

func done(s string) *statusOut {
	out := &statusOut{}
	out.Body.Status = s
	return out
}

type userOut struct {
	Body struct {
		User AdminUser `json:"user"`
	}
}

// AdminAction is the input of an admin write on one account (exported: Huma only
// flattens exported embedded structs).
type AdminAction struct {
	ID string `path:"id"`
	CSRFIn
	ForwardedFor string `header:"X-Forwarded-For"`
}

// RegisterAdminAPI mounts /api/admin/*. s may be nil when only building OpenAPI.
func RegisterAdminAPI(api huma.API, s *Service) {
	tags := []string{"Admin"}
	audit := func(ctx context.Context, in AdminAction, action string, details map[string]any) {
		s.Audit(ctx, Entry{Actor: actor(ctx), Action: action, Subject: "user:" + in.ID,
			Meta: metaFromHeaders(in.ForwardedFor, ""), Details: details})
	}
	userResp := func(ctx context.Context, id string) (*userOut, error) {
		u, err := s.adminUser(ctx, id)
		if err != nil {
			return nil, adminErr(err)
		}
		out := &userOut{}
		out.Body.User = *u
		return out, nil
	}

	huma.Register(api, huma.Operation{
		OperationID: "admin-stats", Method: http.MethodGet, Path: "/api/admin/stats",
		Summary:     "Zekra-wide overview as a flat {metric: number} object",
		Description: "Keys: users, admins, verified, unverified, disabled, signups7d, active24h, twoFactor, plus pendingDeletion, active7d, brains, memories, brainTokens, brainTokensAdmin, personalAccessTokens, recalls24h, retains24h, and last-activity times as Unix seconds (lastSignInAt, lastMemoryEventAt, lastMemoryWriteAt; 0 = never).",
		Tags:        tags, Errors: []int{401, 403},
	}, func(ctx context.Context, _ *struct{}) (*struct{ Body map[string]int64 }, error) {
		return &struct{ Body map[string]int64 }{Body: s.stats(ctx)}, nil
	})

	type listOut struct {
		Body struct {
			Users   []AdminUser `json:"users"`
			Total   int         `json:"total"`
			Page    int         `json:"page"`
			PerPage int         `json:"per_page"`
		}
	}
	huma.Register(api, huma.Operation{
		OperationID: "admin-users", Method: http.MethodGet, Path: "/api/admin/users",
		Summary: "List users (search + paging), newest first", Tags: tags, Errors: []int{401, 403},
	}, func(ctx context.Context, in *struct {
		Q       string `query:"q" maxLength:"254" doc:"Matches email or name (case-insensitive)."`
		Page    int    `query:"page" default:"1" minimum:"1"`
		PerPage int    `query:"per_page" default:"25" minimum:"1" maximum:"100"`
		Role    string `query:"role" doc:"Optional: admin | owner | member | none (no admin/owner)."`
		Status  string `query:"status" enum:"active,disabled,unverified,two_factor,deleting," doc:"Optional state filter."`
	}) (*listOut, error) {
		where, args := []string{"TRUE"}, []any{}
		if q := strings.TrimSpace(in.Q); q != "" {
			args = append(args, "%"+strings.ToLower(q)+"%")
			where = append(where, "(lower(u.email) LIKE $1 OR lower(COALESCE(p.name,'')) LIKE $1)")
		}
		switch r := strings.ToLower(strings.TrimSpace(in.Role)); {
		case r == "none":
			where = append(where, "NOT "+strings.ReplaceAll(adminRoleCond, "roles", "u.roles"))
		case grantableRoles[r]:
			args = append(args, "%,"+r+",%")
			where = append(where, "(','||COALESCE(u.roles,'')||',') LIKE $"+strconv.Itoa(len(args)))
		}
		switch in.Status {
		case "active":
			where = append(where, "NOT EXISTS (SELECT 1 FROM account_disabled d WHERE d.user_id = u.id)")
		case "disabled":
			where = append(where, "EXISTS (SELECT 1 FROM account_disabled d WHERE d.user_id = u.id)")
		case "unverified":
			where = append(where, "EXISTS (SELECT 1 FROM account_unverified v WHERE v.user_id = u.id)")
		case "two_factor":
			where = append(where, "EXISTS (SELECT 1 FROM account_totp t WHERE t.user_id = u.id AND t.enabled)")
		case "deleting":
			where = append(where, "EXISTS (SELECT 1 FROM account_deletions x WHERE x.user_id = u.id AND x.status IN ('scheduled','purging'))")
		}
		cond := strings.Join(where, " AND ")
		out := &listOut{}
		out.Body.Users, out.Body.Page, out.Body.PerPage = []AdminUser{}, in.Page, in.PerPage
		if err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM users u LEFT JOIN account_profiles p ON p.user_id = u.id WHERE `+cond, args...).
			Scan(&out.Body.Total); err != nil {
			return nil, apiErr(http.StatusInternalServerError, "could not list users", "")
		}
		args = append(args, in.PerPage, (in.Page-1)*in.PerPage)
		rows, err := s.DB.QueryContext(ctx, adminUserSelect+` WHERE `+cond+
			` ORDER BY u.created_at DESC, u.id LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
		if err != nil {
			return nil, apiErr(http.StatusInternalServerError, "could not list users", "")
		}
		defer rows.Close()
		for rows.Next() {
			u, err := scanAdminUser(rows)
			if err != nil {
				return nil, apiErr(http.StatusInternalServerError, "could not list users", "")
			}
			out.Body.Users = append(out.Body.Users, u)
		}
		return out, nil
	})

	type detailOut struct {
		Body struct {
			User    AdminUser        `json:"user"`
			Details AdminUserDetails `json:"details"`
		}
	}
	huma.Register(api, huma.Operation{
		OperationID: "admin-user", Method: http.MethodGet, Path: "/api/admin/users/{id}",
		Summary: "One user, with security details", Tags: tags, Errors: []int{401, 403, 404},
	}, func(ctx context.Context, in *struct {
		ID string `path:"id"`
	}) (*detailOut, error) {
		u, err := s.adminUser(ctx, in.ID)
		if err != nil {
			return nil, adminErr(err)
		}
		out := &detailOut{}
		out.Body.User, out.Body.Details = *u, s.adminDetails(ctx, in.ID)
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "admin-user-roles", Method: http.MethodPut, Path: "/api/admin/users/{id}/roles",
		Summary:     "Set a user's roles (admin | owner | member)",
		Description: "Replaces the roles. Takes effect on the user's next request (roles are read from the users table, not the token).",
		Tags:        tags, Errors: []int{401, 403, 404, 409, 422},
	}, func(ctx context.Context, in *struct {
		AdminAction
		Body struct {
			Roles []string `json:"roles" maxItems:"8"`
		}
	}) (*userOut, error) {
		if !in.ok() {
			return nil, errCSRF
		}
		roles, seen := []string{}, map[string]bool{}
		for _, r := range in.Body.Roles {
			r = strings.ToLower(strings.TrimSpace(r))
			if !grantableRoles[r] {
				return nil, apiErr(http.StatusUnprocessableEntity, `"`+r+`" is not a role (admin, owner or member)`, "bad_role")
			}
			if !seen[r] {
				seen[r] = true
				roles = append(roles, r)
			}
		}
		current, err := s.userRoles(ctx, in.ID)
		if err != nil {
			return nil, adminErr(err)
		}
		if hasRole(current, "admin", "owner") && !hasRole(roles, "admin", "owner") {
			if err := s.guardAdminLoss(ctx, in.ID, current); err != nil {
				return nil, adminErr(err)
			}
		}
		if _, err := s.DB.ExecContext(ctx, `UPDATE users SET roles = $1 WHERE id = $2`, strings.Join(roles, ","), in.ID); err != nil {
			return nil, adminErr(err)
		}
		audit(ctx, in.AdminAction, "admin.user.roles", map[string]any{"from": current, "to": roles})
		return userResp(ctx, in.ID)
	})

	huma.Register(api, huma.Operation{
		OperationID: "admin-user-disable", Method: http.MethodPost, Path: "/api/admin/users/{id}/disable",
		Summary: "Disable a user (and sign them out everywhere)", Tags: tags, Errors: []int{401, 403, 404, 409},
	}, func(ctx context.Context, in *struct {
		AdminAction
		Body *struct {
			Reason string `json:"reason,omitempty" maxLength:"500"`
		}
	}) (*userOut, error) {
		if !in.ok() {
			return nil, errCSRF
		}
		roles, err := s.userRoles(ctx, in.ID)
		if err != nil {
			return nil, adminErr(err)
		}
		if err := s.guardAdminLoss(ctx, in.ID, roles); err != nil {
			return nil, adminErr(err)
		}
		reason := ""
		if in.Body != nil {
			reason = strings.TrimSpace(in.Body.Reason)
		}
		if _, err := s.DB.ExecContext(ctx, `
			INSERT INTO account_disabled (user_id, reason, disabled_by) VALUES ($1,$2,$3)
			ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, disabled_by = EXCLUDED.disabled_by, disabled_at = now()`,
			in.ID, reason, actor(ctx)); err != nil {
			return nil, adminErr(err)
		}
		n, _ := s.revokeAllSessions(ctx, in.ID)
		audit(ctx, in.AdminAction, "admin.user.disabled", map[string]any{"reason": reason, "sessions_deleted": n})
		return userResp(ctx, in.ID)
	})

	huma.Register(api, huma.Operation{
		OperationID: "admin-user-enable", Method: http.MethodPost, Path: "/api/admin/users/{id}/enable",
		Summary: "Re-enable a disabled user", Tags: tags, Errors: []int{401, 403, 404},
	}, func(ctx context.Context, in *AdminAction) (*userOut, error) {
		if !in.ok() {
			return nil, errCSRF
		}
		if _, err := s.userRoles(ctx, in.ID); err != nil {
			return nil, adminErr(err)
		}
		if _, err := s.DB.ExecContext(ctx, `DELETE FROM account_disabled WHERE user_id = $1`, in.ID); err != nil {
			return nil, adminErr(err)
		}
		audit(ctx, *in, "admin.user.enabled", nil)
		return userResp(ctx, in.ID)
	})

	huma.Register(api, huma.Operation{
		OperationID: "admin-user-delete", Method: http.MethodDelete, Path: "/api/admin/users/{id}",
		Summary: "Delete a user now (account, profile, linked accounts, tokens, 2FA)", Tags: tags, Errors: []int{401, 403, 404, 409},
	}, func(ctx context.Context, in *AdminAction) (*struct{}, error) {
		if !in.ok() {
			return nil, errCSRF
		}
		roles, err := s.userRoles(ctx, in.ID)
		if err != nil {
			return nil, adminErr(err)
		}
		if err := s.guardAdminLoss(ctx, in.ID, roles); err != nil {
			return nil, adminErr(err)
		}
		var email string
		_ = s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, in.ID).Scan(&email)
		summary, err := s.PurgeUser(ctx, in.ID, email)
		if err != nil {
			return nil, adminErr(err)
		}
		// A purged request row is what refuses the deleted account's stateless
		// JWTs from now on (RevokedSessions), exactly as after a self-deletion.
		now := s.now().UTC()
		raw, _ := json.Marshal(summary)
		if _, err := s.DB.ExecContext(ctx, `
			INSERT INTO account_deletions (user_id, status, request_id, scheduled_for, revoked_at, purged_at, summary)
			VALUES ($1,$2,$3,$4,$4,$4,$5)`, in.ID, StatusPurged, "admin:"+actor(ctx), now, string(raw)); err != nil {
			s.log().Error("admin delete: could not record the deletion; the account's live sessions stay valid until they expire", "err", err)
		}
		audit(ctx, *in, "admin.user.deleted", map[string]any{"email_sha256": emailHash(email), "summary": summary})
		return &struct{}{}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "admin-user-resend-verification", Method: http.MethodPost, Path: "/api/admin/users/{id}/resend-verification",
		Summary: "Email the user a fresh verification code", Tags: tags, Errors: []int{401, 403, 404, 409, 502},
	}, func(ctx context.Context, in *AdminAction) (*statusOut, error) {
		if !in.ok() {
			return nil, errCSRF
		}
		var email string
		if err := s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, in.ID).Scan(&email); err != nil {
			return nil, adminErr(errNoAccount)
		}
		if s.Verified(ctx, in.ID) {
			return nil, apiErr(http.StatusConflict, "this user's email is already verified", "already_verified")
		}
		if err := s.issueCode(ctx, normEmail(email), purposeVerify, "en", true); err != nil {
			s.log().Warn("admin: could not send verification code", "err", err)
			return nil, apiErr(http.StatusBadGateway, "could not send the email", "mail_failed")
		}
		audit(ctx, *in, "admin.user.verification_sent", nil)
		return done("sent"), nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "admin-user-verify", Method: http.MethodPost, Path: "/api/admin/users/{id}/verify",
		Summary: "Mark a user's email as verified", Tags: tags, Errors: []int{401, 403, 404},
	}, func(ctx context.Context, in *AdminAction) (*statusOut, error) {
		if !in.ok() {
			return nil, errCSRF
		}
		if _, err := s.userRoles(ctx, in.ID); err != nil {
			return nil, adminErr(err)
		}
		_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_unverified WHERE user_id = $1`, in.ID)
		audit(ctx, *in, "admin.user.verified", nil)
		return done("verified"), nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "admin-user-2fa-reset", Method: http.MethodPost, Path: "/api/admin/users/{id}/2fa-reset",
		Summary: "Turn off a user's two-factor sign-in", Tags: tags, Errors: []int{401, 403, 404},
	}, func(ctx context.Context, in *AdminAction) (*statusOut, error) {
		if !in.ok() {
			return nil, errCSRF
		}
		if _, err := s.userRoles(ctx, in.ID); err != nil {
			return nil, adminErr(err)
		}
		for _, q := range []string{`DELETE FROM account_totp WHERE user_id = $1`, `DELETE FROM account_recovery_codes WHERE user_id = $1`,
			`DELETE FROM account_challenges WHERE user_id = $1`} {
			_, _ = s.DB.ExecContext(ctx, q, in.ID)
		}
		audit(ctx, *in, "admin.user.2fa_reset", nil)
		return done("reset"), nil
	})

	type sessionsOut struct {
		Body struct {
			Driver    string        `json:"driver" doc:"SESSION_DRIVER: cookie (stateless) | database | file | redis"`
			Listable  bool          `json:"listable" doc:"true only for SESSION_DRIVER=database; stateless sessions cannot be listed"`
			Sessions  []SessionInfo `json:"sessions"`
			RevokedAt *string       `json:"revoked_at" doc:"Every session issued before this is refused"`
		}
	}
	huma.Register(api, huma.Operation{
		OperationID: "admin-user-sessions", Method: http.MethodGet, Path: "/api/admin/users/{id}/sessions",
		Summary: "A user's server-side sessions", Tags: tags, Errors: []int{401, 403, 404},
	}, func(ctx context.Context, in *struct {
		ID string `path:"id"`
	}) (*sessionsOut, error) {
		if _, err := s.userRoles(ctx, in.ID); err != nil {
			return nil, adminErr(err)
		}
		out := &sessionsOut{}
		out.Body.Driver, out.Body.Sessions = sessionDriver(), []SessionInfo{}
		if out.Body.Driver == "database" && s.tableExists(ctx, "auth_sessions") {
			out.Body.Listable = true
			out.Body.Sessions = append(out.Body.Sessions, s.sessionIDs(ctx, in.ID)...)
		}
		out.Body.RevokedAt = fmtTime(s.revokedAt(ctx, in.ID))
		return out, nil
	})

	type revokeOut struct {
		Body struct {
			Status  string `json:"status"`
			Revoked int    `json:"revoked"`
		}
	}
	huma.Register(api, huma.Operation{
		OperationID: "admin-user-sessions-revoke", Method: http.MethodPost, Path: "/api/admin/users/{id}/sessions/revoke",
		Summary:     "Sign a user out (one session, or everywhere)",
		Description: "Without an id: every token issued until now is refused (works for stateless cookie sessions too) and server-side sessions are deleted.",
		Tags:        tags, Errors: []int{401, 403, 404},
	}, func(ctx context.Context, in *struct {
		AdminAction
		Body *struct {
			ID string `json:"id,omitempty" doc:"A session id from the sessions list; empty = all sessions"`
		}
	}) (*revokeOut, error) {
		if !in.ok() {
			return nil, errCSRF
		}
		if _, err := s.userRoles(ctx, in.ID); err != nil {
			return nil, adminErr(err)
		}
		out := &revokeOut{}
		one := in.Body != nil && in.Body.ID != ""
		if one {
			for _, sess := range s.sessionIDs(ctx, in.ID) {
				if constantEq(sess.ID, in.Body.ID) {
					if _, err := s.DB.ExecContext(ctx, `DELETE FROM auth_sessions WHERE sid = $1`, sess.SID); err == nil {
						out.Body.Revoked = 1
					}
				}
			}
			if out.Body.Revoked == 0 {
				return nil, apiErr(http.StatusNotFound, "no such session", "session_not_found")
			}
		} else {
			n, err := s.revokeAllSessions(ctx, in.ID)
			if err != nil {
				return nil, adminErr(err)
			}
			out.Body.Revoked = n
		}
		audit(ctx, in.AdminAction, "admin.user.sessions_revoked", map[string]any{"one": one})
		out.Body.Status = "revoked"
		return out, nil
	})
}

// stats is the admin overview: a flat {metric: number} object.
func (s *Service) stats(ctx context.Context) map[string]int64 {
	out := map[string]int64{}
	count := func(key, q string, args ...any) {
		var n sql.NullInt64
		_ = s.DB.QueryRowContext(ctx, q, args...).Scan(&n) // best effort: 0 on error (e.g. brain tables absent)
		out[key] = n.Int64
	}
	epoch := func(key, q string) {
		var t sql.NullTime
		_ = s.DB.QueryRowContext(ctx, q).Scan(&t)
		out[key] = 0
		if t.Valid {
			out[key] = t.Time.Unix()
		}
	}
	count("users", `SELECT count(*) FROM users`)
	out["admins"] = int64(s.countAdmins(ctx))
	count("unverified", `SELECT count(*) FROM account_unverified v WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = v.user_id)`)
	out["verified"] = out["users"] - out["unverified"]
	count("disabled", `SELECT count(*) FROM account_disabled`)
	count("twoFactor", `SELECT count(*) FROM account_totp WHERE enabled`)
	// users.created_at is RFC 3339 text (the auth plugin's portable schema).
	count("signups7d", `SELECT count(*) FROM users WHERE created_at >= $1`, time.Now().UTC().Add(-7*24*time.Hour).Format(time.RFC3339))
	count("active24h", `SELECT count(*) FROM account_activity WHERE last_login_at > now() - interval '24 hours'`)
	count("active7d", `SELECT count(*) FROM account_activity WHERE last_login_at > now() - interval '7 days'`)
	count("pendingDeletion", `SELECT count(DISTINCT user_id) FROM account_deletions WHERE status IN ('scheduled','purging')`)
	count("brains", `SELECT count(DISTINCT namespace) FROM memories WHERE invalid_at IS NULL`)
	count("memories", `SELECT count(*) FROM memories WHERE invalid_at IS NULL`)
	count("brainTokens", `SELECT count(*) FROM brain_tokens WHERE revoked_at IS NULL`)
	count("brainTokensAdmin", `SELECT count(*) FROM brain_tokens WHERE revoked_at IS NULL AND is_admin`)
	count("personalAccessTokens", `SELECT count(*) FROM personal_access_tokens`)
	count("recalls24h", `SELECT count(*) FROM memory_events WHERE op = 'recall' AND ts > now() - interval '24 hours'`)
	count("retains24h", `SELECT count(*) FROM memory_events WHERE op = 'retain' AND ts > now() - interval '24 hours'`)
	epoch("lastSignInAt", `SELECT max(last_login_at) FROM account_activity`)
	epoch("lastMemoryEventAt", `SELECT max(ts) FROM memory_events`)
	epoch("lastMemoryWriteAt", `SELECT max(valid_at) FROM memories`)
	return out
}

func sessionDriver() string {
	if d := strings.TrimSpace(os.Getenv("SESSION_DRIVER")); d != "" {
		return d
	}
	return "cookie"
}

// recordLogin is the auth.login hook: last sign-in per account.
func (s *Service) recordLogin(ctx context.Context, payload any) error {
	var userID string
	switch v := payload.(type) {
	case auth.Identity:
		userID = v.ID
	case *auth.Identity:
		if v != nil {
			userID = v.ID
		}
	}
	if userID == "" || !s.ready() {
		return nil
	}
	if _, err := s.DB.ExecContext(context.WithoutCancel(ctx), `
		INSERT INTO account_activity (user_id, last_login_at, login_count) VALUES ($1, now(), 1)
		ON CONFLICT (user_id) DO UPDATE SET last_login_at = now(), login_count = account_activity.login_count + 1`, userID); err != nil {
		s.log().Debug("could not record sign-in", "err", err)
	}
	return nil // never fail a sign-in over bookkeeping
}
