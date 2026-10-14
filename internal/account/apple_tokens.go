package account

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

/*
Apple refresh tokens, kept so they can be revoked (App Store Review Guideline
5.1.1(v): an app offering Sign in with Apple must revoke the user's Apple tokens
when the account is deleted).

Where a token comes from:
  - the web and app browser flows: the callback trades Apple's authorization
    code at https://appleid.apple.com/auth/token (client_id = the Services ID);
  - the iOS sheet: the app sends its authorizationCode along with the identity
    token, and the server trades it with client_id = the bundle id (the token's
    audience) and no redirect_uri.

The refresh token is sealed with the account vault key (vault.go, AES-256-GCM)
in account_apple_tokens, one row per (Apple subject, client id). It is revoked
at https://appleid.apple.com/auth/revoke — with the client id that obtained it —
when the Apple identity is disconnected and when the account is purged. The
rows are deleted either way.

Every call needs the ES256 client secret (APPLE_TEAM_ID, APPLE_KEY_ID and the
.p8 key). Without them nothing is exchanged or revoked and sign-in works as
before: the trade is best effort and never fails a sign-in.
*/

const appleRevokeURL = "https://appleid.apple.com/auth/revoke"

// appleTokens talks to Apple's token and revoke endpoints (replaceable in tests).
type appleTokens struct {
	cfg                 appleConfig
	tokenURL, revokeURL string
}

func newAppleTokens(cfg appleConfig) *appleTokens {
	return &appleTokens{cfg: cfg, tokenURL: appleTokenURL, revokeURL: appleRevokeURL}
}

// canSign: a client secret can be minted (team, key id and private key).
func (t *appleTokens) canSign() bool {
	return t != nil && t.cfg.teamID != "" && t.cfg.keyID != "" && t.cfg.key != nil
}

// secret is the ES256 client secret for clientID (the Services ID for the web
// flows, the bundle id for the iOS sheet's codes).
func (t *appleTokens) secret(clientID string, now time.Time) (string, error) {
	if !t.canSign() {
		return "", errors.New("apple: no signing key configured")
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss": t.cfg.teamID, "sub": clientID, "aud": appleIssuer,
		"iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
	})
	tok.Header["kid"] = t.cfg.keyID
	return tok.SignedString(t.cfg.key)
}

type appleTokenSet struct {
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
	Error        string `json:"error"`
}

// exchange trades an authorization code. redirectURI is the web flows' callback;
// "" for a code from the iOS sheet (Apple does not want one there).
func (t *appleTokens) exchange(ctx context.Context, clientID, code, redirectURI string, now time.Time) (*appleTokenSet, error) {
	if code == "" {
		return nil, errors.New("missing code")
	}
	secret, err := t.secret(clientID, now)
	if err != nil {
		return nil, err
	}
	form := url.Values{"client_id": {clientID}, "client_secret": {secret}, "code": {code}, "grant_type": {"authorization_code"}}
	if redirectURI != "" {
		form.Set("redirect_uri", redirectURI)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, t.tokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := oauthHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out appleTokenSet
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&out); err != nil || resp.StatusCode != http.StatusOK || out.IDToken == "" {
		return nil, fmt.Errorf("apple token exchange failed (%d %s)", resp.StatusCode, out.Error)
	}
	return &out, nil
}

// revoke invalidates a refresh token (and with it the user's authorization of
// the app). Apple answers 200 with an empty body, also for a token it no
// longer knows.
func (t *appleTokens) revoke(ctx context.Context, clientID, refreshToken string, now time.Time) error {
	secret, err := t.secret(clientID, now)
	if err != nil {
		return err
	}
	form := url.Values{"client_id": {clientID}, "client_secret": {secret}, "token": {refreshToken}, "token_type_hint": {"refresh_token"}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, t.revokeURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := oauthHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("apple revoke failed (%d)", resp.StatusCode)
	}
	return nil
}

// unverifiedSubject reads the sub claim of an ID token received straight from
// Apple's token endpoint over TLS (so not re-verified): used to make sure a
// native authorization code belongs to the same Apple ID as the identity token.
func unverifiedSubject(raw string) string {
	var c jwt.RegisteredClaims
	if _, _, err := jwt.NewParser().ParseUnverified(raw, &c); err != nil {
		return ""
	}
	return c.Subject
}

// appleTok returns the token client: the one mountApple set up, else one from
// the environment (e.g. the admin purge in a process that never mounted Apple).
func (s *Service) appleTok() *appleTokens {
	if s.appleTokens != nil {
		return s.appleTokens
	}
	cfg, _ := loadAppleConfig()
	return newAppleTokens(cfg)
}

// keepProviderToken stores the refresh token an Apple sign-in or link produced
// for userID. Best effort: without a vault key it is dropped (and logged).
func (s *Service) keepProviderToken(ctx context.Context, userID string, pid ssoIdentity) {
	if pid.Provider != "apple" || pid.RefreshToken == "" || pid.TokenClient == "" || userID == "" || !s.ready() {
		return
	}
	sealed, err := vaultSeal(pid.RefreshToken)
	if err != nil {
		s.log().Warn("apple: refresh token not stored (no vault key)", "err", err)
		return
	}
	now := s.now().UTC()
	if _, err := s.DB.ExecContext(ctx, `
		INSERT INTO account_apple_tokens (user_id, subject, client_id, refresh_token, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$5)
		ON CONFLICT (subject, client_id) DO UPDATE SET user_id = EXCLUDED.user_id,
			refresh_token = EXCLUDED.refresh_token, updated_at = EXCLUDED.updated_at`,
		userID, pid.Subject, pid.TokenClient, sealed, now); err != nil {
		s.log().Warn("apple: refresh token not stored", "err", err)
	}
}

// revokeAppleTokens revokes every Apple refresh token held for userID and
// deletes the rows (also when Apple cannot be reached or is unconfigured: the
// account or the connection is going away). It returns how many Apple accepted.
func (s *Service) revokeAppleTokens(ctx context.Context, userID string) int {
	if !s.ready() || userID == "" || !s.tableExists(ctx, "account_apple_tokens") {
		return 0
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT client_id, refresh_token FROM account_apple_tokens WHERE user_id = $1`, userID)
	if err != nil {
		s.log().Warn("apple: could not read refresh tokens", "err", err)
		return 0
	}
	type held struct{ client, sealed string }
	var list []held
	for rows.Next() {
		var h held
		if rows.Scan(&h.client, &h.sealed) == nil {
			list = append(list, h)
		}
	}
	rows.Close()
	tok := s.appleTok()
	revoked := 0
	for _, h := range list {
		refresh, err := vaultOpen(h.sealed)
		if err == nil {
			err = tok.revoke(ctx, h.client, refresh, s.now())
		}
		if err != nil {
			s.log().Warn("apple: token not revoked", "client", h.client, "err", err)
			continue
		}
		revoked++
	}
	_, _ = s.DB.ExecContext(ctx, `DELETE FROM account_apple_tokens WHERE user_id = $1`, userID)
	return revoked
}
