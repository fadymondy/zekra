package brain

/*
Push registration for the signed-in account (MH-373).

	POST /api/me/device_tokens             {token, platform: ios|android, user_agent?, locale?} → {device}
	POST /api/me/device_tokens/unregister  {token} → {removed}
	GET  /api/me/device_tokens             → {devices: [...], push_configured}   (tokens masked)
	POST /api/me/device_tokens/test        send a test notification to the caller's devices

Only a signed-in USER owns devices: the account comes from the session, never
from the body, so there is nothing to forge. ACL tokens and OAuth-connected
agents are refused. In the app, /api/me/* is additionally behind the harness's
RequireSession (internal/account/sessions.go). Cookie-authenticated POSTs pass
the same CSRF rule as note writes (sessionWriteOK) — a cross-site form must not
be able to attach an attacker's device to the victim's account.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

// deviceUser returns the signed-in user id, or writes the refusal.
func (s *Service) deviceUser(w http.ResponseWriter, r *http.Request, write bool) (string, bool) {
	c := s.identify(r)
	if !c.valid || !c.session || c.userID == "" || c.principal != nil {
		writeJSON(w, http.StatusUnauthorized, apiErr("unauthenticated", "sign in to manage this device's notifications"))
		return "", false
	}
	if write && !s.noteWriteGuard(w, r) {
		return "", false
	}
	return c.userID, true
}

// RegisterDeviceToken — POST /api/me/device_tokens
func (s *Service) RegisterDeviceToken(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.deviceUser(w, r, true)
	if !ok {
		return
	}
	var in struct {
		Token     string `json:"token"`
		Platform  string `json:"platform"`
		UserAgent string `json:"user_agent"`
		Locale    string `json:"locale"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	in.Platform = strings.ToLower(strings.TrimSpace(in.Platform))
	if !validDevicePlatform[in.Platform] {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "platform must be ios or android"))
		return
	}
	d, err := s.Store.UpsertDeviceToken(r.Context(), uid, in.Token, in.Platform, in.UserAgent, in.Locale)
	if errors.Is(err, ErrInvalidInput) {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "token is required (at most 4096 characters, no whitespace)"))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"device": d})
}

// UnregisterDeviceToken — POST /api/me/device_tokens/unregister. Idempotent: an
// unknown token (or one another account holds) answers removed:false.
func (s *Service) UnregisterDeviceToken(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.deviceUser(w, r, true)
	if !ok {
		return
	}
	var in struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in); err != nil || strings.TrimSpace(in.Token) == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "token is required"))
		return
	}
	removed, err := s.Store.UnregisterDeviceToken(r.Context(), uid, in.Token)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": removed})
}

// ListDeviceTokens — GET /api/me/device_tokens
func (s *Service) ListDeviceTokens(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.deviceUser(w, r, false)
	if !ok {
		return
	}
	ds, err := s.Store.DeviceTokens(r.Context(), uid)
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"devices": ds, "push_configured": s.pusher().d != nil})
}

// testPushGap is the minimum time between two test sends for one account.
const testPushGap = 10 * time.Second

var testPushLast sync.Map // userID → time.Time

// TestPush — POST /api/me/device_tokens/test: a test notification to every
// device of the caller, delivered synchronously so the result can be shown.
func (s *Service) TestPush(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.deviceUser(w, r, true)
	if !ok {
		return
	}
	p := s.pusher()
	if p.d == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiErr("push_not_configured", "push notifications are not configured on this server"))
		return
	}
	now := time.Now()
	if v, ok := testPushLast.Load(uid); ok && now.Sub(v.(time.Time)) < testPushGap {
		writeJSON(w, http.StatusTooManyRequests, apiErr("rate_limited", "wait a few seconds before sending another test"))
		return
	}
	testPushLast.Store(uid, now)
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	res, err := p.sendNow(ctx, uid, pushMessage{
		Text: map[string]pushText{
			"en": {Title: "Zekra", Body: "Notifications are working on this device."},
			"ar": {Title: "ذكرة", Body: "الإشعارات تعمل على هذا الجهاز."},
		},
		Data: map[string]string{"type": "test"},
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}
