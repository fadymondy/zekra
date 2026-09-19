package account

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"strings"
	"time"
)

/*
Download my data (ported from fadymondy's export.go, FM-51): GDPR access and
portability.

 1. Request — one export per account per day; queued, answered immediately.
 2. Build — in the background, the account's data is zipped (data.json,
    data.html, README.txt) and stored on the row with a fresh download token.
    Only the token's SHA-256 is kept; the token goes out once, by email, as a
    link to <AUTH_PUBLIC_URL>/<locale>/account/export?token=… (the console page,
    which calls the download endpoint below).
 3. Download — GET /api/me/account/export/download?token=… for the signed-in
    account: the token alone is not enough. The zip is handed out exactly once.

Never exported: password hashes, sessions and tokens, the TOTP secret, recovery
codes. Zekra's brains are shared namespaces, not personal data of one account,
so memories are not part of the export.
*/

// ExportTTL is how long a download link works (once).
const ExportTTL = 24 * time.Hour

// ExportEvery is the per-account rate limit.
const ExportEvery = 24 * time.Hour

const (
	ExportQueued     = "queued"
	ExportReady      = "ready"
	ExportFailed     = "failed"
	ExportDownloaded = "downloaded"
	ExportExpired    = "expired"
)

var (
	ErrExportTooSoon = errors.New("you can request one export a day")
	ErrExportGone    = errors.New("this download link has already been used or has expired — request a new export from your account")
)

// ExportState is what the account page shows.
type ExportState struct {
	Status       string     `json:"status"`
	RequestedAt  *time.Time `json:"requested_at,omitempty"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	NextAllowed  *time.Time `json:"next_allowed_at,omitempty"`
	DownloadedAt *time.Time `json:"downloaded_at,omitempty"`
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// ExportStatus reports the latest export of an account.
func (s *Service) ExportStatus(ctx context.Context, userID string) (ExportState, error) {
	var st ExportState
	var status string
	var requested time.Time
	var expires, downloaded sql.NullTime
	err := s.DB.QueryRowContext(ctx, `
		SELECT status, requested_at, expires_at, downloaded_at FROM account_exports
		 WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`, userID).Scan(&status, &requested, &expires, &downloaded)
	if errors.Is(err, sql.ErrNoRows) {
		return ExportState{Status: "none"}, nil
	}
	if err != nil {
		return st, err
	}
	now := s.now()
	if status == ExportReady && expires.Valid && !expires.Time.After(now) {
		status = ExportExpired
	}
	st.Status = status
	st.RequestedAt = &requested
	if expires.Valid && status == ExportReady {
		st.ExpiresAt = &expires.Time
	}
	if downloaded.Valid {
		st.DownloadedAt = &downloaded.Time
	}
	if next := requested.Add(ExportEvery); next.After(now) && status != ExportFailed {
		st.NextAllowed = &next
	}
	return st, nil
}

// RequestExport queues an export and builds it in the background.
func (s *Service) RequestExport(ctx context.Context, userID, locale string, sync bool) (ExportState, error) {
	now := s.now().UTC()
	id := randomHex(12)
	res, err := s.DB.ExecContext(ctx, `
		INSERT INTO account_exports (id, user_id, status, locale, requested_at)
		SELECT $1, $2, 'queued', $3, $4
		 WHERE NOT EXISTS (SELECT 1 FROM account_exports
		                    WHERE user_id = $2 AND status <> 'failed' AND requested_at > $5)`,
		id, userID, locale, now, now.Add(-ExportEvery))
	if err != nil {
		return ExportState{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ExportState{}, ErrExportTooSoon
	}
	s.Audit(ctx, Entry{Actor: userID, Action: "account.export.requested", Subject: "user:" + userID, Details: map[string]any{"export_id": id}})
	if sync {
		s.buildExport(ctx, id, userID, locale)
	} else {
		go s.buildExport(context.Background(), id, userID, locale)
	}
	return s.ExportStatus(ctx, userID)
}

func (s *Service) buildExport(ctx context.Context, id, userID, locale string) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	fail := func(err error) {
		s.log().Error("account export failed", "id", id, "err", err)
		_, _ = s.DB.ExecContext(ctx, `UPDATE account_exports SET status = 'failed' WHERE id = $1`, id)
	}
	data, err := s.Collect(ctx, userID)
	if err != nil {
		fail(err)
		return
	}
	zipped, err := Bundle(data, s.now().UTC())
	if err != nil {
		fail(err)
		return
	}
	token := randomHex(32)
	if _, err := s.DB.ExecContext(ctx, `
		UPDATE account_exports SET status = 'ready', payload = $1, token_hash = $2, ready_at = $3, expires_at = $4 WHERE id = $5`,
		zipped, tokenHash(token), s.now().UTC(), s.now().UTC().Add(ExportTTL), id); err != nil {
		fail(err)
		return
	}
	loc := "en"
	if locale == "ar" {
		loc = "ar"
	}
	base := publicURL()
	if base == "" {
		base = "https://app.zekra.dev"
	}
	link := base + "/" + loc + "/account/export?token=" + token
	subject, text, htmlBody := ExportEmail(loc, link, int(ExportTTL.Hours()))
	if s.Send == nil {
		fail(errors.New("no mail sender"))
		return
	}
	if err := s.Send(ctx, Message{To: data.Account.Email, Subject: subject, Text: text, HTML: htmlBody}); err != nil {
		fail(err)
	}
}

// DownloadExport hands the zip out once and forgets it.
func (s *Service) DownloadExport(ctx context.Context, token, userID string) ([]byte, time.Time, error) {
	token = strings.TrimSpace(token)
	if len(token) != 64 || userID == "" {
		return nil, time.Time{}, ErrExportGone
	}
	var payload []byte
	var id string
	var ready time.Time
	now := s.now().UTC()
	// RETURNING sees the new row, so the old payload is read through a self-join.
	err := s.DB.QueryRowContext(ctx, `
		UPDATE account_exports x SET status = 'downloaded', downloaded_at = $2, payload = NULL, token_hash = NULL
		  FROM account_exports old
		 WHERE x.id = old.id AND x.token_hash = $1 AND x.status = 'ready' AND x.expires_at > $2 AND x.user_id = $3
		RETURNING old.payload, x.id, x.ready_at`, tokenHash(token), now, userID).Scan(&payload, &id, &ready)
	if err != nil || len(payload) == 0 {
		return nil, time.Time{}, ErrExportGone
	}
	s.Audit(ctx, Entry{Actor: userID, Action: "account.export.downloaded", Subject: "user:" + userID, Details: map[string]any{"export_id": id}})
	return payload, ready, nil
}

// SweepExports wipes the payload of exports nobody downloaded in time.
func (s *Service) SweepExports(ctx context.Context) (int, error) {
	return s.execCount(ctx, `
		UPDATE account_exports SET status = 'expired', payload = NULL, token_hash = NULL
		 WHERE status IN ('ready', 'queued') AND (expires_at <= $1 OR (status = 'queued' AND requested_at <= $2))`,
		s.now().UTC(), s.now().UTC().Add(-time.Hour))
}

// StartExportSweeper runs SweepExports every interval until ctx ends.
func (s *Service) StartExportSweeper(ctx context.Context, every time.Duration) {
	if !s.ready() || every <= 0 {
		return
	}
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			if n, err := s.SweepExports(ctx); err != nil {
				s.log().Warn("account export sweep", "err", err)
			} else if n > 0 {
				s.log().Info("account export sweep", "expired", n)
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
}

// ---- the data ----------------------------------------------------------------------

// ExportData is data.json. Field names are the contract of the export.
type ExportData struct {
	GeneratedAt time.Time        `json:"generated_at"`
	Account     ExportAccount    `json:"account"`
	Identities  []identityView   `json:"connected_accounts"`
	Tokens      []ExportToken    `json:"api_tokens"`
	Preferences map[string]bool  `json:"notification_preferences"`
	Activity    []ExportActivity `json:"account_activity"`
	Notes       []string         `json:"notes"`
}

type ExportAccount struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	CreatedAt string `json:"created_at"`
	Roles     string `json:"roles"`
	Verified  bool   `json:"email_verified"`
	TwoFactor bool   `json:"two_factor_enabled"`
	Name      string `json:"name,omitempty"`
	Avatar    string `json:"avatar,omitempty"`
	Timezone  string `json:"timezone,omitempty"`
}

type ExportToken struct {
	Name      string `json:"name"`
	Abilities string `json:"abilities"`
	CreatedAt string `json:"created_at"`
	ExpiresAt string `json:"expires_at,omitempty"`
}

type ExportActivity struct {
	Action string    `json:"action"`
	IP     string    `json:"ip"`
	At     time.Time `json:"at"`
}

// Collect gathers everything one account holds.
func (s *Service) Collect(ctx context.Context, userID string) (*ExportData, error) {
	d := &ExportData{GeneratedAt: s.now().UTC(), Identities: []identityView{}, Tokens: []ExportToken{}, Activity: []ExportActivity{}}
	acc := &d.Account
	if err := s.DB.QueryRowContext(ctx, `SELECT id, email, COALESCE(roles,''), COALESCE(created_at,'') FROM users WHERE id = $1`, userID).
		Scan(&acc.ID, &acc.Email, &acc.Roles, &acc.CreatedAt); err != nil {
		return nil, fmt.Errorf("account: %w", err)
	}
	acc.Verified = s.Verified(ctx, userID)
	acc.TwoFactor = s.twoFactorOn(ctx, userID)
	p := s.loadProfile(ctx, userID)
	acc.Name, acc.Avatar, acc.Timezone = p.Name, p.Avatar, p.Timezone
	if ids, err := s.listIdentities(ctx, userID); err == nil {
		d.Identities = ids
	}
	prefs := s.loadPrefs(ctx, userID)
	d.Preferences = map[string]bool{"security_alerts": prefs.SecurityAlerts, "product_updates": prefs.ProductUpdates, "weekly_digest": prefs.WeeklyDigest}
	if s.tableExists(ctx, "personal_access_tokens") {
		if rows, err := s.DB.QueryContext(ctx, `SELECT name, abilities, created_at, COALESCE(expires_at,'') FROM personal_access_tokens WHERE user_id = $1 ORDER BY created_at`, userID); err == nil {
			for rows.Next() {
				var t ExportToken
				if rows.Scan(&t.Name, &t.Abilities, &t.CreatedAt, &t.ExpiresAt) == nil {
					d.Tokens = append(d.Tokens, t)
				}
			}
			rows.Close()
		}
	}
	if rows, err := s.DB.QueryContext(ctx, `SELECT action, ip, created_at FROM account_audit WHERE subject = $1 ORDER BY created_at`, "user:"+userID); err == nil {
		for rows.Next() {
			var a ExportActivity
			if rows.Scan(&a.Action, &a.IP, &a.At) == nil {
				d.Activity = append(d.Activity, a)
			}
		}
		rows.Close()
	}
	d.Notes = []string{
		"Not included, by design: your password hash, sign-in sessions and token secrets, your two-factor secret and recovery codes.",
		"Brains and memories are shared workspaces governed by brain tokens and grants, not personal data of one account, so they are not part of this export.",
	}
	return d, nil
}

const readme = `Your Zekra account data

data.html  — the same information, readable in a browser.
data.json  — machine-readable, for moving it elsewhere.

This link worked once. To get a fresh copy, request a new export from your
account page (one a day).
`

// Bundle zips data.json, data.html and a README.
func Bundle(d *ExportData, at time.Time) ([]byte, error) {
	js, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range []struct {
		name string
		body []byte
	}{{"README.txt", []byte(readme)}, {"data.json", js}, {"data.html", []byte(readable(d))}} {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: f.name, Method: zip.Deflate, Modified: at})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(f.body); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func readable(d *ExportData) string {
	e := html.EscapeString
	var b strings.Builder
	b.WriteString(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Your Zekra data</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#111}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.35rem .5rem;text-align:start}th{background:#f5f5f5}
h2{margin-top:2rem;border-bottom:1px solid #ddd}.muted{color:#666}</style></head><body>`)
	b.WriteString(`<h1>Your Zekra data</h1><p class="muted">Generated ` + e(d.GeneratedAt.Format("2006-01-02 15:04 MST")) + `</p>`)
	yes := func(v bool) string {
		if v {
			return "yes"
		}
		return "no"
	}
	row := func(cells ...string) {
		b.WriteString("<tr>")
		for _, c := range cells {
			b.WriteString("<td>" + e(c) + "</td>")
		}
		b.WriteString("</tr>")
	}
	a := d.Account
	b.WriteString("<h2>Account</h2><table>")
	for _, p := range [][2]string{{"Email", a.Email}, {"Created", a.CreatedAt}, {"Email verified", yes(a.Verified)},
		{"Two-factor sign-in", yes(a.TwoFactor)}, {"Roles", a.Roles}, {"Name", a.Name}, {"Avatar", a.Avatar}, {"Timezone", a.Timezone}} {
		if p[1] != "" {
			row(p[0], p[1])
		}
	}
	b.WriteString("</table>")
	fmt.Fprintf(&b, "<h2>Connected accounts (%d)</h2><table>", len(d.Identities))
	for _, i := range d.Identities {
		row(i.Provider, i.Email, i.CreatedAt)
	}
	fmt.Fprintf(&b, "</table><h2>API tokens (%d)</h2><table>", len(d.Tokens))
	for _, t := range d.Tokens {
		row(t.Name, t.Abilities, t.CreatedAt, t.ExpiresAt)
	}
	fmt.Fprintf(&b, "</table><h2>Account activity (%d)</h2><table>", len(d.Activity))
	for _, x := range d.Activity {
		row(x.At.UTC().Format("2006-01-02 15:04 UTC"), x.Action, x.IP)
	}
	b.WriteString("</table><h2>About this export</h2><ul>")
	for _, n := range d.Notes {
		b.WriteString("<li>" + e(n) + "</li>")
	}
	b.WriteString("</ul></body></html>")
	return b.String()
}
