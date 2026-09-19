package account

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //#nosec G505 -- RFC 6238 TOTP is defined over HMAC-SHA1; every authenticator app expects it
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/togo-framework/auth"
	"rsc.io/qr"
)

/*
Passwordless sign-in by emailed code, and authenticator-app two-factor
(fadymondy FM-45).

  - POST /api/auth/code/request {email} mails a sign-in code (same answer for
    any address); POST /api/auth/code/verify {email, code} signs in. The code
    also proves the inbox, so it verifies an unverified account.
  - Every sign-in path finishing through complete() — password, emailed code,
    verification code — answers an account with two-factor on with 401
    {"error","code":"2fa_required","challenge"}; POST /api/auth/2fa/challenge
    {challenge, code | recovery_code} finishes it.
  - /api/me/2fa (signed in): status, enroll (secret + QR), confirm (turns it on
    and returns ten recovery codes, once), disable, and new recovery codes.

A code is accepted for the current 30-second step and one either side, and
never twice (last_step). Recovery codes are single-use. As in fadymondy, Google /
Apple / GitHub sign-ins do not pass through complete(): the provider carries its
own second factor.
*/

const (
	purposeLogin    = "login"
	challengeTTL    = 5 * time.Minute
	totpStep        = 30
	recoveryCount   = 10
	Code2FARequired = "2fa_required"
)

var totpEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

/* ------------------------------------------------------------ TOTP */

func newTOTPSecret() (string, error) {
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return totpEncoding.EncodeToString(raw), nil
}

// totpCode is RFC 6238's code for one 30-second step.
func totpCode(secret string, step int64) (string, error) {
	key, err := totpEncoding.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", err
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(step)) //#nosec G115 -- step derives from a post-1970 Unix time
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	v := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", v%1000000), nil
}

// matchTOTP returns the step a code belongs to (now, or one either side) that is
// newer than after, or 0.
func matchTOTP(secret, code string, now time.Time, after int64) int64 {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return 0
	}
	cur := now.Unix() / totpStep
	for _, step := range []int64{cur, cur - 1, cur + 1} {
		if step <= after {
			continue
		}
		want, err := totpCode(secret, step)
		if err == nil && subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return step
		}
	}
	return 0
}

func totpIssuer() string {
	if v := firstEnv("TOTP_ISSUER"); v != "" {
		return v
	}
	return brand
}

func otpauthURL(email, secret string) string {
	issuer := totpIssuer()
	return "otpauth://totp/" + url.PathEscape(issuer+":"+email) +
		"?secret=" + secret + "&issuer=" + url.QueryEscape(issuer) + "&algorithm=SHA1&digits=6&period=30"
}

func qrDataURL(text string) (string, error) {
	code, err := qr.Encode(text, qr.M)
	if err != nil {
		return "", err
	}
	code.Scale = 6
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(code.PNG()), nil
}

func hashRecovery(code string) string {
	c := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	sum := sha256.Sum256([]byte(c))
	return hex.EncodeToString(sum[:])
}

func newRecoveryCode() (string, error) {
	raw := make([]byte, 5)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	s := strings.ToLower(totpEncoding.EncodeToString(raw)) // 8 chars
	return s[:4] + "-" + s[4:8], nil
}

/* ------------------------------------------------------------ storage */

type totpState struct {
	Secret   string
	Enabled  bool
	LastStep int64
}

func (s *Service) totp(ctx context.Context, userID string) (*totpState, error) {
	var sealed string
	var st totpState
	err := s.DB.QueryRowContext(ctx, `SELECT secret_sealed, enabled, last_step FROM account_totp WHERE user_id = $1`, userID).
		Scan(&sealed, &st.Enabled, &st.LastStep)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if st.Secret, err = vaultOpen(sealed); err != nil {
		return nil, fmt.Errorf("could not open the two-factor secret: %w", err)
	}
	return &st, nil
}

func (s *Service) twoFactorOn(ctx context.Context, userID string) bool {
	var on bool
	_ = s.DB.QueryRowContext(ctx, `SELECT enabled FROM account_totp WHERE user_id = $1`, userID).Scan(&on)
	return on
}

// secondFactor checks a TOTP or a recovery code and consumes it.
func (s *Service) secondFactor(ctx context.Context, userID, code, recovery string) bool {
	if strings.TrimSpace(recovery) != "" {
		res, err := s.DB.ExecContext(ctx,
			`UPDATE account_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
			userID, hashRecovery(recovery))
		if err != nil {
			return false
		}
		n, _ := res.RowsAffected()
		return n == 1
	}
	st, err := s.totp(ctx, userID)
	if err != nil || st == nil || !st.Enabled {
		return false
	}
	step := matchTOTP(st.Secret, code, s.now(), st.LastStep)
	if step == 0 {
		return false
	}
	// Only one request can move last_step forward past this step.
	res, err := s.DB.ExecContext(ctx, `UPDATE account_totp SET last_step = $2 WHERE user_id = $1 AND last_step < $2`, userID, step)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

func (s *Service) newRecoveryCodes(ctx context.Context, userID string) ([]string, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, `DELETE FROM account_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	codes := make([]string, 0, recoveryCount)
	for len(codes) < recoveryCount {
		c, err := newRecoveryCode()
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO account_recovery_codes (user_id, code_hash) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, hashRecovery(c)); err != nil {
			return nil, err
		}
		codes = append(codes, c)
	}
	return codes, tx.Commit()
}

/* ------------------------------------------------------------ finishing a sign-in */

func userBody(userID, email, roles string) map[string]any {
	return map[string]any{"id": userID, "email": email, "roles": splitCSV(roles), "permissions": []string{}, "guard": "api"}
}

// complete signs the user in, or asks for the second factor first.
func (s *Service) complete(w http.ResponseWriter, r *http.Request, userID, email, roles string, extra map[string]any) {
	ctx := r.Context()
	if s.disabled(ctx, userID) {
		disabledResponse(w)
		return
	}
	if s.twoFactorOn(ctx, userID) {
		id, err := newChallengeID()
		if err == nil {
			_, err = s.DB.ExecContext(ctx,
				`INSERT INTO account_challenges (id, user_id, expires_at) VALUES ($1,$2,$3)`, id, userID, s.now().UTC().Add(challengeTTL))
		}
		if err != nil {
			writeJSONErr(w, http.StatusInternalServerError, "could not start the second step")
			return
		}
		_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_challenges WHERE expires_at < now()`)
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "Enter the code from your authenticator app.", "code": Code2FARequired, "challenge": id,
		})
		return
	}
	token, err := s.signIn(w, userID, email, roles)
	if err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	body := map[string]any{"token": token, "user": userBody(userID, email, roles)}
	for k, v := range extra {
		body[k] = v
	}
	writeJSON(w, http.StatusOK, body)
}

func newChallengeID() (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

/* ------------------------------------------------------------ endpoints */

// RegisterTwoFactor mounts the sign-in and account endpoints.
func (s *Service) RegisterTwoFactor(post, get func(string, http.HandlerFunc)) {
	post("/api/auth/code/request", s.handleCodeRequest)
	post("/api/auth/code/verify", s.handleCodeVerify)
	post("/api/auth/2fa/challenge", s.handleChallenge)

	get("/api/me/2fa", s.handleStatus)
	post("/api/me/2fa/enroll", s.handleEnroll)
	post("/api/me/2fa/confirm", s.handleConfirm)
	post("/api/me/2fa/disable", s.handleDisable)
	post("/api/me/2fa/recovery", s.handleRecovery)
}

func (s *Service) handleCodeRequest(w http.ResponseWriter, r *http.Request) {
	b, ok := decode(r)
	if !ok {
		writeJSONErr(w, http.StatusBadRequest, "email is required")
		return
	}
	if !signupEmailLimit.allow("code:"+b.Email) || !signupIPLimit.allow("code:"+clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many attempts — try again later")
		return
	}
	if _, _, err := s.userByEmail(r.Context(), b.Email); err == nil {
		if err := s.issueCode(r.Context(), b.Email, purposeLogin, localeOf(r, b.Locale), false); err != nil {
			s.log().Warn("signin: could not send the sign-in code", "error", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (s *Service) handleCodeVerify(w http.ResponseWriter, r *http.Request) {
	b, ok := decode(r)
	if !ok || b.Code == "" {
		writeJSONErr(w, http.StatusBadRequest, "email and code are required")
		return
	}
	if s.limited(w, r, b.Email) {
		return
	}
	ctx := r.Context()
	if err := s.checkCode(ctx, b.Email, purposeLogin, b.Code); err != nil {
		writeJSONErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	id, roles, err := s.userByEmail(ctx, b.Email)
	if err != nil {
		writeJSONErr(w, http.StatusUnprocessableEntity, errBadCode.Error())
		return
	}
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_unverified WHERE user_id = $1`, id) // the code proved the inbox
	s.complete(w, r, id, b.Email, roles, nil)
}

func (s *Service) handleChallenge(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Challenge    string `json:"challenge"`
		Code         string `json:"code"`
		RecoveryCode string `json:"recovery_code"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&b) != nil || b.Challenge == "" || (b.Code == "" && b.RecoveryCode == "") {
		writeJSONErr(w, http.StatusBadRequest, "challenge and code are required")
		return
	}
	if !codeTryLimit.allow("2fa:" + clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many attempts — try again in a few minutes")
		return
	}
	ctx := r.Context()
	expired := func() {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "this sign-in has expired — start again", "code": "challenge_expired"})
	}
	var userID string
	var attempts int
	var expires time.Time
	err := s.DB.QueryRowContext(ctx, `SELECT user_id, attempts, expires_at FROM account_challenges WHERE id = $1`, b.Challenge).
		Scan(&userID, &attempts, &expires)
	if err != nil || s.now().After(expires) || attempts >= maxAttempts {
		_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_challenges WHERE id = $1`, b.Challenge)
		expired()
		return
	}
	if !s.secondFactor(ctx, userID, b.Code, b.RecoveryCode) {
		_, _ = s.DB.ExecContext(ctx, `UPDATE account_challenges SET attempts = attempts + 1 WHERE id = $1`, b.Challenge)
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "that code is not right", "code": "2fa_invalid"})
		return
	}
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_challenges WHERE id = $1`, b.Challenge)
	var email, roles string
	if err := s.DB.QueryRowContext(ctx, `SELECT email, COALESCE(roles,'') FROM users WHERE id = $1`, userID).Scan(&email, &roles); err != nil {
		expired()
		return
	}
	if s.disabled(ctx, userID) {
		disabledResponse(w)
		return
	}
	token, err := s.signIn(w, userID, email, roles)
	if err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not sign in")
		return
	}
	extra := map[string]any{}
	if b.RecoveryCode != "" {
		var left int
		_ = s.DB.QueryRowContext(ctx, `SELECT count(*) FROM account_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, userID).Scan(&left)
		extra["recovery_codes_left"] = left
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "extra": extra, "user": userBody(userID, email, roles)})
}

// sessionUser returns the signed-in account (not a personal access token),
// enforcing the double-submit CSRF check for cookie requests.
func (s *Service) sessionUser(w http.ResponseWriter, r *http.Request) (*auth.Identity, bool) {
	id, ok := auth.IdentityFrom(r.Context())
	if !ok || id == nil || id.ID == "" {
		id = sessionIdentity(s.Auth, r)
	}
	if id == nil || id.ID == "" || id.Guard == "pat" {
		writeJSONErr(w, http.StatusUnauthorized, "sign in first")
		return nil, false
	}
	if !csrfOK(r) {
		writeJSONErr(w, http.StatusForbidden, "invalid csrf token")
		return nil, false
	}
	return id, true
}

func (s *Service) handleStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := s.sessionUser(w, r)
	if !ok {
		return
	}
	var left int
	_ = s.DB.QueryRowContext(r.Context(), `SELECT count(*) FROM account_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, id.ID).Scan(&left)
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": s.twoFactorOn(r.Context(), id.ID), "recovery_codes_left": left, "available": vaultConfigured(),
	})
}

func (s *Service) handleEnroll(w http.ResponseWriter, r *http.Request) {
	id, ok := s.sessionUser(w, r)
	if !ok {
		return
	}
	if !vaultConfigured() {
		writeJSONErr(w, http.StatusServiceUnavailable, errNoVaultKey.Error())
		return
	}
	ctx := r.Context()
	if s.twoFactorOn(ctx, id.ID) {
		writeJSONErr(w, http.StatusConflict, "two-factor is already on — turn it off first to set it up again")
		return
	}
	secret, err := newTOTPSecret()
	if err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not create a secret")
		return
	}
	sealed, err := vaultSeal(secret)
	if err != nil {
		writeJSONErr(w, http.StatusServiceUnavailable, errNoVaultKey.Error())
		return
	}
	if _, err := s.DB.ExecContext(ctx, `
		INSERT INTO account_totp (user_id, secret_sealed, enabled, last_step) VALUES ($1,$2,FALSE,0)
		ON CONFLICT (user_id) DO UPDATE SET secret_sealed = EXCLUDED.secret_sealed, enabled = FALSE, last_step = 0, created_at = now(), enabled_at = NULL`,
		id.ID, sealed); err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not save the secret")
		return
	}
	email := id.Email
	if email == "" {
		_ = s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, id.ID).Scan(&email)
	}
	link := otpauthURL(email, secret)
	img, err := qrDataURL(link)
	if err != nil {
		img = ""
	}
	writeJSON(w, http.StatusOK, map[string]string{"secret": secret, "otpauth_url": link, "qr": img})
}

func (s *Service) handleConfirm(w http.ResponseWriter, r *http.Request) {
	id, ok := s.sessionUser(w, r)
	if !ok {
		return
	}
	var b struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&b)
	ctx := r.Context()
	if !codeTryLimit.allow("2fa-confirm:" + id.ID) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many attempts — try again in a few minutes")
		return
	}
	st, err := s.totp(ctx, id.ID)
	if err != nil || st == nil {
		writeJSONErr(w, http.StatusConflict, "start the setup first")
		return
	}
	if st.Enabled {
		writeJSONErr(w, http.StatusConflict, "two-factor is already on")
		return
	}
	step := matchTOTP(st.Secret, b.Code, s.now(), 0)
	if step == 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "that code is not right — check the time on your phone", "code": "2fa_invalid"})
		return
	}
	codes, err := s.newRecoveryCodes(ctx, id.ID)
	if err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not create recovery codes")
		return
	}
	if _, err := s.DB.ExecContext(ctx, `UPDATE account_totp SET enabled = TRUE, enabled_at = now(), last_step = $2 WHERE user_id = $1`, id.ID, step); err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not turn two-factor on")
		return
	}
	s.Audit(ctx, Entry{Actor: id.ID, Action: "account.2fa.enabled", Subject: "user:" + id.ID, Meta: metaOf(r)})
	writeJSON(w, http.StatusOK, map[string]any{"enabled": true, "recovery_codes": codes})
}

func (s *Service) handleDisable(w http.ResponseWriter, r *http.Request) {
	id, ok := s.sessionUser(w, r)
	if !ok {
		return
	}
	var b struct {
		Code         string `json:"code"`
		RecoveryCode string `json:"recovery_code"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&b)
	ctx := r.Context()
	if !codeTryLimit.allow("2fa-disable:" + id.ID) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many attempts — try again in a few minutes")
		return
	}
	if s.twoFactorOn(ctx, id.ID) && !s.secondFactor(ctx, id.ID, b.Code, b.RecoveryCode) {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "that code is not right", "code": "2fa_invalid"})
		return
	}
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_totp WHERE user_id = $1`, id.ID)
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_recovery_codes WHERE user_id = $1`, id.ID)
	s.Audit(ctx, Entry{Actor: id.ID, Action: "account.2fa.disabled", Subject: "user:" + id.ID, Meta: metaOf(r)})
	writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
}

func (s *Service) handleRecovery(w http.ResponseWriter, r *http.Request) {
	id, ok := s.sessionUser(w, r)
	if !ok {
		return
	}
	var b struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&b)
	ctx := r.Context()
	if !codeTryLimit.allow("2fa-recovery:" + id.ID) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many attempts — try again in a few minutes")
		return
	}
	if !s.twoFactorOn(ctx, id.ID) || !s.secondFactor(ctx, id.ID, b.Code, "") {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "that code is not right", "code": "2fa_invalid"})
		return
	}
	codes, err := s.newRecoveryCodes(ctx, id.ID)
	if err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not create recovery codes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recovery_codes": codes})
}
