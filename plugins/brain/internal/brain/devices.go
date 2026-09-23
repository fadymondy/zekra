package brain

/*
Device tokens and push notifications (MH-373).

A signed-in user's phone registers its FCM token (POST /api/me/device_tokens,
devices_handlers.go). A token is ONE device: when a second account registers a
token another account holds, the row moves to the new account rather than being
copied — the device has since signed in as someone else, and the old account
must stop receiving pushes there.

Sends go through pusher.notifyUser: asynchronous, bounded by a timeout, and a
no-op (logged once) when FCM is not configured, so a trigger can never slow or
fail the request that caused it. Tokens FCM reports dead are pruned on the spot.

Triggers do not call the pusher directly: they go through Service.notify
(notifications.go, MH-360), which records the notification in the recipient's
inbox first — whether or not push is configured — and then pushes it here.
The triggers themselves live in notifications.go.
*/

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// maxDevicesPerUser caps the rows one account keeps; the least recently seen go.
const maxDevicesPerUser = 20

// pushSendTimeout bounds one asynchronous fan-out to a user's devices.
const pushSendTimeout = 30 * time.Second

// DeviceToken is a registered device as its owner sees it: never the full token.
type DeviceToken struct {
	ID         string    `json:"id"`
	Platform   string    `json:"platform"`
	UserAgent  string    `json:"user_agent"`
	Locale     string    `json:"locale"`
	TokenHint  string    `json:"token_hint"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

// deviceTarget is what a send needs: the token and the text language.
type deviceTarget struct {
	token  string
	locale string
}

var validDevicePlatform = map[string]bool{"ios": true, "android": true}

// maskDeviceToken keeps enough of a token to tell two devices apart.
func maskDeviceToken(t string) string {
	if len(t) <= 12 {
		return "…"
	}
	return t[:6] + "…" + t[len(t)-4:]
}

// normalizePushLocale maps a device locale ("ar-EG", "en_US") to a text language.
func normalizePushLocale(l string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(l)), "ar") {
		return "ar"
	}
	return "en"
}

// UpsertDeviceToken registers token for userID, moving it from any other account.
func (s *Store) UpsertDeviceToken(ctx context.Context, userID, token, platform, userAgent, locale string) (*DeviceToken, error) {
	token = strings.TrimSpace(token)
	if userID == "" || token == "" || len(token) > 4096 || strings.ContainsAny(token, " \t\r\n") || !validDevicePlatform[platform] {
		return nil, ErrInvalidInput
	}
	if r := []rune(userAgent); len(r) > 300 {
		userAgent = string(r[:300])
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	d := DeviceToken{Platform: platform, UserAgent: userAgent, Locale: normalizePushLocale(locale), TokenHint: maskDeviceToken(token)}
	err = db.QueryRowContext(ctx, `
		INSERT INTO device_tokens (user_id, token, platform, user_agent, locale)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (token) DO UPDATE SET
		  user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, user_agent = EXCLUDED.user_agent,
		  locale = EXCLUDED.locale, updated_at = now(), last_seen_at = now()
		RETURNING id, created_at, updated_at, last_seen_at`,
		userID, token, platform, userAgent, d.Locale).Scan(&d.ID, &d.CreatedAt, &d.UpdatedAt, &d.LastSeenAt)
	if err != nil {
		return nil, err
	}
	_, _ = db.ExecContext(ctx, `
		DELETE FROM device_tokens WHERE user_id = $1 AND id NOT IN (
		  SELECT id FROM device_tokens WHERE user_id = $1 ORDER BY last_seen_at DESC, id LIMIT $2)`,
		userID, maxDevicesPerUser)
	return &d, nil
}

// UnregisterDeviceToken removes token only when it belongs to userID.
func (s *Store) UnregisterDeviceToken(ctx context.Context, userID, token string) (bool, error) {
	token = strings.TrimSpace(token)
	if userID == "" || token == "" {
		return false, ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return false, err
	}
	res, err := db.ExecContext(ctx, `DELETE FROM device_tokens WHERE token = $1 AND user_id = $2`, token, userID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// DeviceTokens lists userID's devices, most recently seen first, tokens masked.
func (s *Store) DeviceTokens(ctx context.Context, userID string) ([]DeviceToken, error) {
	out := []DeviceToken{}
	if userID == "" {
		return out, nil
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, platform, user_agent, locale, token, created_at, updated_at, last_seen_at
		FROM device_tokens WHERE user_id = $1 ORDER BY last_seen_at DESC, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var d DeviceToken
		var tok string
		if err := rows.Scan(&d.ID, &d.Platform, &d.UserAgent, &d.Locale, &tok, &d.CreatedAt, &d.UpdatedAt, &d.LastSeenAt); err != nil {
			return nil, err
		}
		d.TokenHint = maskDeviceToken(tok)
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) deviceTargets(ctx context.Context, userID string) ([]deviceTarget, error) {
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT token, locale FROM device_tokens WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []deviceTarget
	for rows.Next() {
		var t deviceTarget
		if err := rows.Scan(&t.token, &t.locale); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) pruneDeviceToken(ctx context.Context, token string) error {
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `DELETE FROM device_tokens WHERE token = $1`, token)
	return err
}

// claimPushOnce records key and reports whether this caller was the first: the
// ledger that makes a "first time" notification fire exactly once.
func (s *Store) claimPushOnce(ctx context.Context, key string) (bool, error) {
	db, err := s.db(ctx)
	if err != nil {
		return false, err
	}
	res, err := db.ExecContext(ctx, `INSERT INTO push_once (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, key)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// ---- sending -------------------------------------------------------------------

// pushResult reports one fan-out.
type pushResult struct {
	Configured bool     `json:"configured"`
	Devices    int      `json:"devices"`
	Sent       int      `json:"sent"`
	Failed     int      `json:"failed"`
	Pruned     int      `json:"pruned"`
	Errors     []string `json:"errors,omitempty"`
}

// pusher owns the (optional) deliverer. One per Service, built on first use.
type pusher struct {
	store *Store
	log   *slog.Logger
	d     pushDeliverer // nil = push is off
	wg    sync.WaitGroup
}

// pushers maps *Service → *pusher. A side table rather than a Service field so
// this feature stays in its own files; tests Store() a pusher with a fake.
var pushers sync.Map

func (s *Service) pusher() *pusher {
	if v, ok := pushers.Load(s); ok {
		return v.(*pusher)
	}
	p := &pusher{store: s.Store, log: slog.Default()}
	if s.k != nil && s.k.Log != nil {
		p.log = s.k.Log
	}
	sa, err := loadServiceAccount()
	switch {
	case errors.Is(err, ErrPushNotConfigured):
		p.log.Info("push: FCM is not configured (FCM_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS unset); notifications are off")
	case err != nil:
		p.log.Warn("push: FCM configuration is invalid; notifications are off", "err", err)
	default:
		if snd, err := newFCMSender(sa); err != nil {
			p.log.Warn("push: FCM key is unusable; notifications are off", "err", err)
		} else {
			p.d = snd
			p.log.Info("push: FCM enabled", "project", sa.ProjectID, "dry_run", snd.dryRun)
		}
	}
	actual, _ := pushers.LoadOrStore(s, p)
	return actual.(*pusher)
}

// sendNow delivers msg to every device of userID and prunes dead tokens.
func (p *pusher) sendNow(ctx context.Context, userID string, msg pushMessage) (*pushResult, error) {
	res := &pushResult{Configured: p.d != nil}
	if p.d == nil {
		return res, ErrPushNotConfigured
	}
	targets, err := p.store.deviceTargets(ctx, userID)
	if err != nil {
		return res, err
	}
	res.Devices = len(targets)
	for _, t := range targets {
		err := p.d.Deliver(ctx, t.token, msg.textFor(t.locale), msg.Data)
		switch {
		case err == nil:
			res.Sent++
		case errors.Is(err, errDeadToken):
			res.Failed++
			if p.store.pruneDeviceToken(ctx, t.token) == nil {
				res.Pruned++
			}
		default:
			res.Failed++
			res.Errors = append(res.Errors, err.Error())
		}
	}
	return res, nil
}

// notifyUser sends in the background with a timeout; it never blocks the
// caller and never fails it. A no-op when push is off. Callers wanting the
// inbox as well go through Service.notify (notifications.go).
func (p *pusher) notifyUser(userID string, msg pushMessage) {
	if p == nil || p.d == nil || userID == "" {
		return
	}
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		defer func() { _ = recover() }() // a push bug must never take the server down
		ctx, cancel := context.WithTimeout(context.Background(), pushSendTimeout)
		defer cancel()
		res, err := p.sendNow(ctx, userID, msg)
		if err != nil || (res != nil && len(res.Errors) > 0) {
			p.log.Warn("push: send failed", "user", userID, "err", err, "result", res)
		}
	}()
}
