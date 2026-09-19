package account

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/togo-framework/auth"
	"golang.org/x/crypto/bcrypt"
)

/*
Email verification and password recovery (fadymondy FM-44).

  - POST /api/auth/register still creates the account through the auth plugin,
    but the session it would hand out is withheld: the account is marked
    unverified, a 6-digit code is mailed, and the answer is 403
    {"error", "code":"email_unverified", "email"}.
  - POST /api/auth/login for an unverified account answers the same 403 and
    mails a fresh code (at most once a minute) instead of a session.
  - POST /api/auth/verify-email {email, code} verifies and signs in.
  - POST /api/auth/verify-email/resend {email} mails a new code.
  - POST /api/auth/password/forgot {email} mails a reset code; same answer
    whether or not the address has an account.
  - POST /api/auth/password/reset {email, code, password} sets the password,
    verifies the address, and signs every earlier session out.

Codes are bcrypt-hashed, live 15 minutes, and die after five wrong tries.
Requests are rate-limited per address and per client.
*/

const (
	purposeVerify = "verify"
	purposeReset  = "reset"
	codeTTL       = 15 * time.Minute
	maxAttempts   = 5
	resendEvery   = time.Minute
)

// Error codes the web branches on.
const (
	CodeEmailUnverified = "email_unverified"
	CodeAccountDisabled = "account_disabled"
)

var (
	signupIPLimit    = newLimiter(20, 10*time.Minute)
	signupEmailLimit = newLimiter(6, time.Hour)
	codeTryLimit     = newLimiter(15, 10*time.Minute)
)

var errBadCode = errors.New("that code is wrong or has expired — request a new one")

func localeOf(r *http.Request, fallback string) string {
	if fallback == "ar" || fallback == "en" {
		return fallback
	}
	if strings.HasPrefix(strings.ToLower(r.Header.Get("Accept-Language")), "ar") {
		return "ar"
	}
	return "en"
}

func unverifiedResponse(w http.ResponseWriter, email, locale string) {
	msg := "Check your inbox: we sent a 6-digit code to " + email + ". Enter it to activate your account, then sign in."
	if locale == "ar" {
		msg = "تحقق من بريدك: أرسلنا رمزًا من 6 أرقام إلى " + email + ". أدخله لتفعيل حسابك ثم سجّل الدخول."
	}
	writeJSON(w, http.StatusForbidden, map[string]string{"error": msg, "code": CodeEmailUnverified, "email": email})
}

func disabledResponse(w http.ResponseWriter) {
	writeJSON(w, http.StatusForbidden, map[string]string{
		"error": "this account has been disabled — contact the administrator", "code": CodeAccountDisabled,
	})
}

/* ------------------------------------------------------------ codes */

func newCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// storeCode writes a fresh code for (email, purpose) and returns it.
func (s *Service) storeCode(ctx context.Context, email, purpose string) (string, time.Time, error) {
	now := s.now().UTC()
	code, err := newCode()
	if err != nil {
		return "", time.Time{}, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		return "", time.Time{}, err
	}
	exp := now.Add(codeTTL)
	if _, err := s.DB.ExecContext(ctx, `
		INSERT INTO account_codes (email, purpose, code_hash, attempts, expires_at, sent_at)
		VALUES ($1,$2,$3,0,$4,$5)
		ON CONFLICT (email, purpose) DO UPDATE SET code_hash = EXCLUDED.code_hash, attempts = 0,
			expires_at = EXCLUDED.expires_at, sent_at = EXCLUDED.sent_at`,
		email, purpose, string(hash), exp, now); err != nil {
		return "", time.Time{}, err
	}
	return code, exp, nil
}

// issueCode stores a fresh code and mails it. With force=false it does nothing
// when a code was sent less than a minute ago.
func (s *Service) issueCode(ctx context.Context, email, purpose, locale string, force bool) error {
	if !force {
		var sent time.Time
		err := s.DB.QueryRowContext(ctx, `SELECT sent_at FROM account_codes WHERE email = $1 AND purpose = $2`, email, purpose).Scan(&sent)
		if err == nil && s.now().UTC().Sub(sent) < resendEvery {
			return nil
		}
	}
	code, _, err := s.storeCode(ctx, email, purpose)
	if err != nil {
		return err
	}
	subject, text, htmlBody := CodeEmail(locale, purpose, code)
	if s.Send == nil {
		return errors.New("no mail sender")
	}
	return s.Send(ctx, Message{To: email, Subject: subject, Text: text, HTML: htmlBody})
}

// checkCode consumes a code: right -> deleted; wrong -> counted.
func (s *Service) checkCode(ctx context.Context, email, purpose, code string) error {
	var hash string
	var attempts int
	var expires time.Time
	err := s.DB.QueryRowContext(ctx,
		`SELECT code_hash, attempts, expires_at FROM account_codes WHERE email = $1 AND purpose = $2`, email, purpose).
		Scan(&hash, &attempts, &expires)
	if err != nil {
		return errBadCode
	}
	if attempts >= maxAttempts || s.now().After(expires) {
		_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_codes WHERE email = $1 AND purpose = $2`, email, purpose)
		return errBadCode
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(strings.TrimSpace(code))) != nil {
		_, _ = s.DB.ExecContext(ctx, `UPDATE account_codes SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2`, email, purpose)
		return errBadCode
	}
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_codes WHERE email = $1 AND purpose = $2`, email, purpose)
	return nil
}

func (s *Service) userByEmail(ctx context.Context, email string) (id, roles string, err error) {
	err = s.DB.QueryRowContext(ctx,
		`SELECT id, COALESCE(roles,'') FROM users WHERE lower(email) = $1 ORDER BY created_at LIMIT 1`, email).Scan(&id, &roles)
	return id, roles, err
}

func (s *Service) unverified(ctx context.Context, email string) (bool, error) {
	var n int
	err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM account_unverified WHERE lower(email) = $1`, email).Scan(&n)
	return n > 0, err
}

// Verified reports whether the account has proved its address. No table, or no
// row, means verified (accounts from before verification existed, SSO sign-ups).
func (s *Service) Verified(ctx context.Context, userID string) bool {
	var n int
	if err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM account_unverified WHERE user_id = $1`, userID).Scan(&n); err != nil {
		return true
	}
	return n == 0
}

func (s *Service) disabled(ctx context.Context, userID string) bool {
	var n int
	if err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM account_disabled WHERE user_id = $1`, userID).Scan(&n); err != nil {
		return false // fail open: a missing table must not lock everyone out
	}
	return n > 0
}

/* ------------------------------------------------------------ middleware */

// SignupMiddleware wraps the auth plugin's register and login.
func (s *Service) SignupMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !s.ready() {
			next.ServeHTTP(w, r)
			return
		}
		switch strings.TrimRight(r.URL.Path, "/") {
		case "/api/auth/register":
			s.wrapRegister(next, w, r)
		case "/api/auth/login":
			s.wrapLogin(next, w, r)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

type bodyCreds struct {
	Email  string `json:"email"`
	Locale string `json:"locale"`
}

func readBody(r *http.Request) bodyCreds {
	raw, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(raw))
	var c bodyCreds
	_ = json.Unmarshal(raw, &c)
	return c
}

// setBodyEmail rewrites the request body's "email" before the auth plugin reads
// it. The plugin matches emails exactly (case-sensitive), so Zekra stores new
// addresses lowercased and signs existing ones in by their stored spelling.
func setBodyEmail(r *http.Request, email string) {
	raw, _ := io.ReadAll(r.Body)
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil || m == nil {
		r.Body = io.NopCloser(bytes.NewReader(raw))
		return
	}
	m["email"] = email
	out, _ := json.Marshal(m)
	r.Body = io.NopCloser(bytes.NewReader(out))
	r.ContentLength = int64(len(out))
}

// storedEmail returns the stored spelling of an address (case-insensitive match).
func (s *Service) storedEmail(ctx context.Context, email string) (string, bool) {
	var stored string
	err := s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE lower(email) = $1 ORDER BY created_at LIMIT 1`, email).Scan(&stored)
	return stored, err == nil
}

// captured holds the plugin's answer until it is rewritten.
type captured struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (c *captured) Header() http.Header         { return c.header }
func (c *captured) WriteHeader(status int)      { c.status = status }
func (c *captured) Write(b []byte) (int, error) { return c.body.Write(b) }

func (c *captured) replay(w http.ResponseWriter) {
	for k, v := range c.header {
		w.Header()[k] = v
	}
	w.WriteHeader(c.status)
	_, _ = w.Write(c.body.Bytes())
}

func (s *Service) wrapLogin(next http.Handler, w http.ResponseWriter, r *http.Request) {
	c := readBody(r)
	email := normEmail(c.Email)
	if email != "" {
		if pending, err := s.unverified(r.Context(), email); err == nil && pending {
			locale := localeOf(r, c.Locale)
			if signupEmailLimit.allow("login:" + email) {
				if err := s.issueCode(r.Context(), email, purposeVerify, locale, false); err != nil {
					s.log().Warn("signup: could not send verification code", "error", err)
				}
			}
			unverifiedResponse(w, email, locale)
			return
		}
		if stored, ok := s.storedEmail(r.Context(), email); ok {
			setBodyEmail(r, stored)
		}
	}

	// A correct password is only the first factor for an account with two-factor
	// on: the plugin's session is withheld and a challenge answered instead.
	rec := &captured{header: http.Header{}, status: http.StatusOK}
	next.ServeHTTP(rec, r)
	var signedIn struct {
		User struct {
			ID    string   `json:"id"`
			Email string   `json:"email"`
			Roles []string `json:"roles"`
		} `json:"user"`
	}
	if rec.status == http.StatusOK && json.Unmarshal(rec.body.Bytes(), &signedIn) == nil && signedIn.User.ID != "" {
		if s.disabled(r.Context(), signedIn.User.ID) || s.twoFactorOn(r.Context(), signedIn.User.ID) {
			http.SetCookie(w, ClearSessionCookie(secureRequest(r)))
			s.complete(w, r, signedIn.User.ID, signedIn.User.Email, strings.Join(signedIn.User.Roles, ","), nil)
			return
		}
	}
	rec.replay(w)
}

func (s *Service) wrapRegister(next http.Handler, w http.ResponseWriter, r *http.Request) {
	if !allowRegistration() {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "registration is closed", "code": "registration_closed"})
		return
	}
	if !signupIPLimit.allow("register:" + clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many attempts — try again in a few minutes"})
		return
	}
	c := readBody(r)
	if email := normEmail(c.Email); email != "" {
		// The plugin's UNIQUE(email) is case-sensitive: refuse a case variant of an
		// existing address with the plugin's own generic answer (no enumeration).
		if _, exists := s.storedEmail(r.Context(), email); exists {
			writeJSONErr(w, http.StatusUnprocessableEntity, "registration failed")
			return
		}
		setBodyEmail(r, email)
	}
	rec := &captured{header: http.Header{}, status: http.StatusOK}
	next.ServeHTTP(rec, r)

	var created struct {
		User struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"user"`
	}
	if rec.status != http.StatusCreated || json.Unmarshal(rec.body.Bytes(), &created) != nil || created.User.ID == "" {
		rec.replay(w) // anything but a created account passes through unchanged
		return
	}

	email := normEmail(created.User.Email)
	locale := localeOf(r, c.Locale)
	ctx := r.Context()
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO account_unverified (user_id, email) VALUES ($1,$2) ON CONFLICT (user_id) DO NOTHING`,
		created.User.ID, email); err != nil {
		s.log().Error("signup: could not mark the account unverified", "error", err)
	}
	if err := s.issueCode(ctx, email, purposeVerify, locale, true); err != nil {
		s.log().Warn("signup: could not send verification code", "error", err)
	}
	// The plugin's session cookie is not passed on; the account cannot be used
	// until the address is verified.
	http.SetCookie(w, ClearSessionCookie(secureRequest(r)))
	unverifiedResponse(w, email, locale)
}

/* ------------------------------------------------------------ endpoints */

// RegisterSignup mounts the four endpoints (public, under /api/auth/).
func (s *Service) RegisterSignup(post func(pattern string, h http.HandlerFunc)) {
	post("/api/auth/verify-email", s.handleVerify)
	post("/api/auth/verify-email/resend", s.handleResend)
	post("/api/auth/password/forgot", s.handleForgot)
	post("/api/auth/password/reset", s.handleReset)
}

type codeBody struct {
	Email    string `json:"email"`
	Code     string `json:"code"`
	Password string `json:"password"`
	Locale   string `json:"locale"`
}

func decode(r *http.Request) (codeBody, bool) {
	var b codeBody
	err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&b)
	b.Email = normEmail(b.Email)
	return b, err == nil && b.Email != "" && strings.Contains(b.Email, "@")
}

func (s *Service) limited(w http.ResponseWriter, r *http.Request, email string) bool {
	if !codeTryLimit.allow("ip:"+clientIP(r)) || !codeTryLimit.allow("email:"+email) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many attempts — try again in a few minutes"})
		return true
	}
	return false
}

func (s *Service) signIn(w http.ResponseWriter, userID, email, roles string) (string, error) {
	if s.Auth == nil {
		return "", ErrUnavailable
	}
	return s.Auth.IssueSession(w, auth.Identity{ID: userID, Email: email, Roles: splitCSV(roles), Guard: "api"})
}

func (s *Service) handleVerify(w http.ResponseWriter, r *http.Request) {
	b, ok := decode(r)
	if !ok || b.Code == "" {
		writeJSONErr(w, http.StatusBadRequest, "email and code are required")
		return
	}
	if s.limited(w, r, b.Email) {
		return
	}
	ctx := r.Context()
	if err := s.checkCode(ctx, b.Email, purposeVerify, b.Code); err != nil {
		writeJSONErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	id, roles, err := s.userByEmail(ctx, b.Email)
	if err != nil {
		writeJSONErr(w, http.StatusUnprocessableEntity, errBadCode.Error())
		return
	}
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_unverified WHERE user_id = $1`, id)
	s.complete(w, r, id, b.Email, roles, map[string]any{"status": "verified"})
}

func (s *Service) handleResend(w http.ResponseWriter, r *http.Request) {
	b, ok := decode(r)
	if !ok {
		writeJSONErr(w, http.StatusBadRequest, "email is required")
		return
	}
	if !signupEmailLimit.allow("resend:"+b.Email) || !signupIPLimit.allow("resend:"+clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many attempts — try again later")
		return
	}
	// Only unverified accounts get a code; the answer is the same either way.
	if pending, err := s.unverified(r.Context(), b.Email); err == nil && pending {
		if err := s.issueCode(r.Context(), b.Email, purposeVerify, localeOf(r, b.Locale), false); err != nil {
			s.log().Warn("signup: could not resend verification code", "error", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (s *Service) handleForgot(w http.ResponseWriter, r *http.Request) {
	b, ok := decode(r)
	if !ok {
		writeJSONErr(w, http.StatusBadRequest, "email is required")
		return
	}
	if !signupEmailLimit.allow("forgot:"+b.Email) || !signupIPLimit.allow("forgot:"+clientIP(r)) {
		writeJSONErr(w, http.StatusTooManyRequests, "too many attempts — try again later")
		return
	}
	if _, _, err := s.userByEmail(r.Context(), b.Email); err == nil {
		if err := s.issueCode(r.Context(), b.Email, purposeReset, localeOf(r, b.Locale), false); err != nil {
			s.log().Warn("signup: could not send reset code", "error", err)
		}
	}
	// Same answer whether or not the address has an account.
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (s *Service) handleReset(w http.ResponseWriter, r *http.Request) {
	b, ok := decode(r)
	if !ok || b.Code == "" {
		writeJSONErr(w, http.StatusBadRequest, "email, code and password are required")
		return
	}
	if len(b.Password) < minPassword() || len(b.Password) > 72 {
		writeJSONErr(w, http.StatusUnprocessableEntity, fmt.Sprintf("the password must be %d to 72 characters", minPassword()))
		return
	}
	if s.limited(w, r, b.Email) {
		return
	}
	ctx := r.Context()
	if err := s.checkCode(ctx, b.Email, purposeReset, b.Code); err != nil {
		writeJSONErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	id, _, err := s.userByEmail(ctx, b.Email)
	if err != nil {
		writeJSONErr(w, http.StatusUnprocessableEntity, errBadCode.Error())
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(b.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not set the password")
		return
	}
	if _, err := s.DB.ExecContext(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, string(hash), id); err != nil {
		writeJSONErr(w, http.StatusInternalServerError, "could not set the password")
		return
	}
	// Every session issued until now is signed out; the inbox is proved.
	_, _ = s.DB.ExecContext(ctx, `
		INSERT INTO account_password_resets (user_id, reset_at) VALUES ($1,$2)
		ON CONFLICT (user_id) DO UPDATE SET reset_at = EXCLUDED.reset_at`, id, s.now().UTC())
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_unverified WHERE user_id = $1`, id)
	s.Audit(ctx, Entry{Actor: id, Action: "account.password.reset", Subject: "user:" + id, Meta: metaOf(r)})
	writeJSON(w, http.StatusOK, map[string]string{"status": "reset"})
}
