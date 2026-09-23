package brain

/*
The notification center: a persisted per-user inbox (MH-360).

Every notification goes through Service.notify, which

 1. records it in the recipient's inbox (table `notifications`) — ALWAYS, so the
    inbox is complete even when FCM is not configured or the user has no device;
 2. tells the user's open clients over the realtime stream (hub.publishUser →
    event "notification" on GET /api/brain/events, that user's streams only);
 3. pushes it to the user's devices (pusher.notifyUser, async; a no-op when push
    is off), with data.notificationId so tapping it can mark the item read.

Text. A row keeps every language it was written in (`texts`, {"en":{title,body},
"ar":{...}}) plus title/body in the recipient's language at send time (the locale
of their most recently seen device, else English) — the same choice the push
makes per device. A reader may ask for another language (?locale=), which is how
an Arabic console shows an Arabic inbox to someone whose phone is in English.

Triggers (kept deliberately few — each one is a message someone wants):
  - a user is added to a brain                → the new member,  /brain/<ns>
  - a presentation share link is opened by
    someone other than its owner, first time  → the owner,       /presentation/<id>
  - a file is first downloaded from a
    presentation share link (same rules)      → the owner,       /presentation/<id>

Knowledge gaps are deliberately NOT a trigger: a gap opens on every empty recall
(an agent's normal traffic), which would turn the inbox into a log.

The inbox is capped at notificationKeep rows per user; the oldest go.
*/

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/togo-framework/brain/presentations"
)

// notificationKeep caps one user's inbox; older rows are dropped on insert.
const notificationKeep = 500

// Notification is one inbox item as its owner sees it.
type Notification struct {
	ID        string            `json:"id"`
	Kind      string            `json:"kind"`
	Title     string            `json:"title"`
	Body      string            `json:"body"`
	Route     string            `json:"route"`
	Data      map[string]string `json:"data"`
	CreatedAt time.Time         `json:"createdAt"`
	ReadAt    *time.Time        `json:"readAt"`
}

// withData returns a copy of m with key=value added to its data block.
func (m pushMessage) withData(key, value string) pushMessage {
	d := make(map[string]string, len(m.Data)+1)
	for k, v := range m.Data {
		d[k] = v
	}
	d[key] = value
	m.Data = d
	return m
}

// ---- store ---------------------------------------------------------------------

// recipientLocale is the language of userID's most recently seen device.
func (s *Store) recipientLocale(ctx context.Context, userID string) string {
	db, err := s.db(ctx)
	if err != nil {
		return "en"
	}
	var l string
	if err := db.QueryRowContext(ctx, `SELECT locale FROM device_tokens WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 1`, userID).Scan(&l); err != nil {
		return "en"
	}
	return normalizePushLocale(l)
}

// insertNotification records msg in userID's inbox. The kind is data["type"],
// the route data["route"]; the rest of data is kept as the item's data.
func (s *Store) insertNotification(ctx context.Context, userID string, msg pushMessage) (*Notification, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	kind := strings.TrimSpace(msg.Data["type"])
	if kind == "" {
		kind = "info"
	}
	if len(kind) > 64 {
		kind = kind[:64]
	}
	data := map[string]string{}
	for k, v := range msg.Data {
		if k != "type" && k != "route" {
			data[k] = v
		}
	}
	texts := map[string]map[string]string{}
	for l, t := range msg.Text {
		texts[l] = map[string]string{"title": t.Title, "body": t.Body}
	}
	txt := msg.textFor(s.recipientLocale(ctx, userID))
	textsJSON, _ := json.Marshal(texts)
	dataJSON, _ := json.Marshal(data)
	n := &Notification{Kind: kind, Title: txt.Title, Body: txt.Body, Route: msg.Data["route"], Data: data}
	err = db.QueryRowContext(ctx, `
		INSERT INTO brain_notifications (user_id, kind, title, body, texts, route, data)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
		RETURNING id, created_at`,
		userID, kind, n.Title, n.Body, string(textsJSON), n.Route, string(dataJSON)).Scan(&n.ID, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	_, _ = db.ExecContext(ctx, `
		DELETE FROM brain_notifications WHERE user_id = $1 AND id IN (
		  SELECT id FROM brain_notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC OFFSET $2)`,
		userID, notificationKeep)
	return n, nil
}

// notificationCursor is the keyset position after the last item of a page.
type notificationCursor struct {
	at time.Time
	id string
}

func encodeNotificationCursor(n Notification) string {
	return base64.RawURLEncoding.EncodeToString([]byte(n.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + n.ID))
}

func decodeNotificationCursor(raw string) (*notificationCursor, error) {
	if raw == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, ErrInvalidInput
	}
	at, id, ok := strings.Cut(string(b), "|")
	if !ok || id == "" {
		return nil, ErrInvalidInput
	}
	t, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		return nil, ErrInvalidInput
	}
	return &notificationCursor{at: t, id: id}, nil
}

// ListNotifications returns one page of userID's inbox, newest first, and the
// cursor of the next page ("" at the end). locale, when the item was written
// in it, overrides the stored title/body.
func (s *Store) ListNotifications(ctx context.Context, userID, locale, cursor string, limit int) ([]Notification, string, error) {
	out := []Notification{}
	if userID == "" {
		return out, "", nil
	}
	cur, err := decodeNotificationCursor(cursor)
	if err != nil {
		return nil, "", err
	}
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, "", err
	}
	q := `SELECT id, kind, title, body, texts::text, route, data::text, created_at, read_at
		FROM brain_notifications WHERE user_id = $1`
	args := []any{userID}
	if cur != nil {
		q += ` AND (created_at, id) < ($2, $3)`
		args = append(args, cur.at, cur.id)
	}
	q += ` ORDER BY created_at DESC, id DESC LIMIT ` + strconv.Itoa(limit+1)
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	for rows.Next() {
		var n Notification
		var texts, data string
		var readAt *time.Time
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &texts, &n.Route, &data, &n.CreatedAt, &readAt); err != nil {
			return nil, "", err
		}
		n.ReadAt = readAt
		n.Data = map[string]string{}
		_ = json.Unmarshal([]byte(data), &n.Data)
		if locale != "" {
			var tx map[string]struct {
				Title string `json:"title"`
				Body  string `json:"body"`
			}
			if json.Unmarshal([]byte(texts), &tx) == nil {
				if t, ok := tx[locale]; ok && t.Title != "" {
					n.Title, n.Body = t.Title, t.Body
				}
			}
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	next := ""
	if len(out) > limit {
		out = out[:limit]
		next = encodeNotificationCursor(out[len(out)-1])
	}
	return out, next, nil
}

// UnreadNotifications counts userID's unread items.
func (s *Store) UnreadNotifications(ctx context.Context, userID string) (int, error) {
	if userID == "" {
		return 0, nil
	}
	db, err := s.db(ctx)
	if err != nil {
		return 0, err
	}
	var n int
	err = db.QueryRowContext(ctx, `SELECT count(*) FROM brain_notifications WHERE user_id = $1 AND read_at IS NULL`, userID).Scan(&n)
	return n, err
}

// maxMarkIDs bounds one mark-read request.
const maxMarkIDs = 200

// MarkNotificationsRead marks ids (or, with all, every item) of userID read.
// Ids that are not userID's are ignored. Returns how many rows changed.
func (s *Store) MarkNotificationsRead(ctx context.Context, userID string, ids []string, all bool) (int64, error) {
	if userID == "" {
		return 0, ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return 0, err
	}
	if all {
		res, err := db.ExecContext(ctx, `UPDATE brain_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, userID)
		if err != nil {
			return 0, err
		}
		return res.RowsAffected()
	}
	clean := make([]string, 0, len(ids))
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" && len(id) <= 64 {
			clean = append(clean, id)
		}
	}
	if len(clean) == 0 {
		return 0, nil
	}
	if len(clean) > maxMarkIDs {
		return 0, ErrInvalidInput
	}
	idsJSON, _ := json.Marshal(clean)
	res, err := db.ExecContext(ctx, `
		UPDATE brain_notifications SET read_at = now()
		WHERE user_id = $1 AND read_at IS NULL AND id IN (SELECT jsonb_array_elements_text($2::jsonb))`,
		userID, string(idsJSON))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// DeleteNotification removes one of userID's items; false when there is none.
func (s *Store) DeleteNotification(ctx context.Context, userID, id string) (bool, error) {
	if userID == "" || id == "" {
		return false, ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return false, err
	}
	res, err := db.ExecContext(ctx, `DELETE FROM brain_notifications WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ---- sending -------------------------------------------------------------------

// notify is THE way to notify a user: inbox row, live event, then push (async).
// An inbox failure is logged and the push still goes out — a message someone
// wants should not vanish because one of its two channels failed. Returns the
// recorded item (nil when recording failed).
func (s *Service) notify(ctx context.Context, userID string, msg pushMessage) (*Notification, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	p := s.pusher()
	n, err := s.Store.insertNotification(ctx, userID, msg)
	if err != nil {
		p.log.Warn("notify: could not record the notification", "user", userID, "kind", msg.Data["type"], "err", err)
	} else {
		msg = msg.withData("notificationId", n.ID)
		s.publishUnread(ctx, userID, map[string]any{"id": n.ID, "kind": n.Kind})
	}
	p.notifyUser(userID, msg)
	return n, err
}

// publishUnread tells userID's open clients their inbox changed, with the new
// unread count (event "notification").
func (s *Service) publishUnread(ctx context.Context, userID string, payload map[string]any) {
	if payload == nil {
		payload = map[string]any{}
	}
	if unread, err := s.Store.UnreadNotifications(ctx, userID); err == nil {
		payload["unread"] = unread
	}
	s.hub.publishUser(userID, "notification", payload)
}

// notifyLater runs build and the notification it describes in the background,
// so even the lookups a notification needs stay off the request path. build
// returns ok=false to send nothing. Runs whether or not push is configured —
// the inbox is always written. Tracked by the pusher's WaitGroup (tests wait).
func (s *Service) notifyLater(build func(ctx context.Context) (userID string, msg pushMessage, ok bool)) {
	p := s.pusher()
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		defer func() { _ = recover() }() // a notification bug must never take the server down
		ctx, cancel := context.WithTimeout(context.Background(), pushSendTimeout)
		defer cancel()
		userID, msg, ok := build(ctx)
		if !ok || userID == "" {
			return
		}
		_, _ = s.notify(ctx, userID, msg)
	}()
}

// ---- triggers ------------------------------------------------------------------

// notifyBeforeMemberSet snapshots whether userID is already a member of ns, and
// returns the function to call once the membership is saved: it notifies a NEW
// member (not a role change, not someone adding themselves).
func (s *Service) notifyBeforeMemberSet(ctx context.Context, ns, userID, byUserID string) func() {
	if userID == "" || userID == byUserID {
		return func() {}
	}
	if prev, err := s.Store.MemberRole(ctx, ns, userID); err != nil || prev != "" {
		return func() {}
	}
	return func() {
		s.notifyLater(func(ctx context.Context) (string, pushMessage, bool) {
			return userID, brainAccessMessage(ns, s.brainDisplayName(ctx, ns)), true
		})
	}
}

func (s *Service) brainDisplayName(ctx context.Context, ns string) string {
	if prof, err := s.Store.Profile(ctx, ns); err == nil && strings.TrimSpace(prof.DisplayName) != "" {
		return prof.DisplayName
	}
	return ns
}

func brainAccessMessage(ns, name string) pushMessage {
	return pushMessage{
		Text: map[string]pushText{
			"en": {Title: "A brain was shared with you", Body: "You were given access to " + name + "."},
			"ar": {Title: "تمت مشاركة دماغ معك", Body: "حصلت على صلاحية الوصول إلى " + name + "."},
		},
		Data: map[string]string{"type": "brain_access", "route": "/brain/" + url.PathEscape(ns), "namespace": ns},
	}
}

// presentationFirstEventWindow: a link that already had more views (downloads)
// than this when the notification shipped is not "first" news, so it never fires.
const presentationFirstEventWindow = 3

// notifyPresentationEvent is the hook for a recorded share-link event (view or
// download): in the background, it tells the presentation's owner the first time
// one of its links is opened / downloaded from by someone other than the owner.
// token is the raw link token.
func (s *Service) notifyPresentationEvent(r *http.Request, token, event string) {
	if token == "" || (event != presentations.EventView && event != presentations.EventDownload) {
		return
	}
	viewer := s.identify(r).userID
	hash := presentations.HashToken(token)
	s.notifyLater(func(ctx context.Context) (string, pushMessage, bool) {
		return s.presentationEventMessage(ctx, event, hash, viewer)
	})
}

// presentationViewedMessage decides (and claims) the first-view notification.
func (s *Service) presentationViewedMessage(ctx context.Context, tokenHash, viewerUserID string) (string, pushMessage, bool) {
	return s.presentationEventMessage(ctx, presentations.EventView, tokenHash, viewerUserID)
}

// presentationEventMessage decides (and claims) a first-view / first-download
// notification for the share link with tokenHash.
func (s *Service) presentationEventMessage(ctx context.Context, event, tokenHash, viewerUserID string) (string, pushMessage, bool) {
	db, err := s.Store.db(ctx)
	if err != nil {
		return "", pushMessage{}, false
	}
	counter, key := "s.view_count", "presentation_share_viewed:"
	if event == presentations.EventDownload {
		counter, key = "s.download_count", "presentation_share_downloaded:"
	}
	var shareID, docID, ns, owner, title string
	var count int64
	err = db.QueryRowContext(ctx, `
		SELECT s.id, `+counter+`, p.id, COALESCE(p.namespace, ''), COALESCE(p.owner_user_id, ''), p.title
		FROM presentation_shares s JOIN presentations p ON p.id = s.presentation_id
		WHERE s.token_hash = $1`, tokenHash).Scan(&shareID, &count, &docID, &ns, &owner, &title)
	if err != nil {
		return "", pushMessage{}, false
	}
	// The owner previewing their own link is not news.
	if owner == "" || owner == viewerUserID || count > presentationFirstEventWindow {
		return "", pushMessage{}, false
	}
	if first, err := s.Store.claimPushOnce(ctx, key+shareID); err != nil || !first {
		return "", pushMessage{}, false
	}
	msg := presentationViewedPush(docID, title)
	if event == presentations.EventDownload {
		msg = presentationDownloadedPush(docID, title)
	}
	// The web console's presentation route is per brain (/b/<ns>/presentations/<id>).
	return owner, msg.withData("namespace", ns), true
}

func presentationTitle(title string) string {
	if strings.TrimSpace(title) == "" {
		return "Presentation"
	}
	return title
}

func presentationViewedPush(docID, title string) pushMessage {
	title = presentationTitle(title)
	return pushMessage{
		Text: map[string]pushText{
			"en": {Title: "Your presentation was opened", Body: "“" + title + "” was just opened from a share link."},
			"ar": {Title: "تم فتح العرض", Body: "فُتح «" + title + "» للتو من رابط المشاركة."},
		},
		Data: map[string]string{"type": "presentation_viewed", "route": "/presentation/" + url.PathEscape(docID), "presentation_id": docID},
	}
}

func presentationDownloadedPush(docID, title string) pushMessage {
	title = presentationTitle(title)
	return pushMessage{
		Text: map[string]pushText{
			"en": {Title: "Your presentation was downloaded", Body: "“" + title + "” was just downloaded from a share link."},
			"ar": {Title: "تم تنزيل العرض", Body: "نُزِّل «" + title + "» للتو من رابط المشاركة."},
		},
		Data: map[string]string{"type": "presentation_downloaded", "route": "/presentation/" + url.PathEscape(docID), "presentation_id": docID},
	}
}
