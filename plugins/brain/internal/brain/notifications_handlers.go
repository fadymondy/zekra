package brain

/*
The notification center for the signed-in account (MH-360; notifications.go).

	GET    /api/me/notifications?cursor=&limit=&locale=  → {items: [...], nextCursor?, unread}
	GET    /api/me/notifications/unread                  → {unread}
	POST   /api/me/notifications/read {ids?: [...], all?: true} → {updated, unread}
	DELETE /api/me/notifications/{id}                    → {deleted: true} | 404

Item: {id, kind, title, body, route, data, createdAt, readAt}. `locale` (en|ar;
default: the Accept-Language, else the language the item was stored in) picks
the text. Caller resolution, CSRF and refusals are the device-token endpoints'
(deviceUser): a signed-in USER only — never an ACL token or an OAuth agent — and
the account always comes from the session, so one user can never read, mark or
delete another's items (foreign ids simply match nothing).

Every change is echoed to the user's other open clients as the realtime event
"notification" {unread} on GET /api/brain/events.
*/

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

// notificationLocale is the language a reader asked for: ?locale=, else the
// first Accept-Language tag, else "" (the stored text).
func notificationLocale(r *http.Request) string {
	l := strings.TrimSpace(r.URL.Query().Get("locale"))
	if l == "" {
		l = strings.TrimSpace(strings.Split(r.Header.Get("Accept-Language"), ",")[0])
	}
	if l == "" {
		return ""
	}
	return normalizePushLocale(l)
}

// ListNotifications — GET /api/me/notifications
func (s *Service) ListNotifications(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.deviceUser(w, r, false)
	if !ok {
		return
	}
	limit := 30
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "limit must be a positive integer"))
			return
		}
		limit = n
	}
	items, next, err := s.Store.ListNotifications(r.Context(), uid, notificationLocale(r), r.URL.Query().Get("cursor"), limit)
	if errors.Is(err, ErrInvalidInput) {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad cursor"))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	unread, err := s.Store.UnreadNotifications(r.Context(), uid)
	if err != nil {
		writeErr(w, err)
		return
	}
	out := map[string]any{"items": items, "unread": unread}
	if next != "" {
		out["nextCursor"] = next
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}

// UnreadNotificationCount — GET /api/me/notifications/unread
func (s *Service) UnreadNotificationCount(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.deviceUser(w, r, false)
	if !ok {
		return
	}
	n, err := s.Store.UnreadNotifications(r.Context(), uid)
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"unread": n})
}

// MarkNotificationsRead — POST /api/me/notifications/read {ids?, all?}
func (s *Service) MarkNotificationsRead(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.deviceUser(w, r, true)
	if !ok {
		return
	}
	var in struct {
		IDs []string `json:"ids"`
		All bool     `json:"all"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	if !in.All && len(in.IDs) == 0 {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "send ids or all: true"))
		return
	}
	n, err := s.Store.MarkNotificationsRead(r.Context(), uid, in.IDs, in.All)
	if errors.Is(err, ErrInvalidInput) {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "at most 200 ids per request"))
		return
	}
	if err != nil {
		writeErr(w, err)
		return
	}
	unread, _ := s.Store.UnreadNotifications(r.Context(), uid)
	if n > 0 {
		s.hub.publishUser(uid, "notification", map[string]any{"unread": unread})
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": n, "unread": unread})
}

// DeleteNotification — DELETE /api/me/notifications/{id}
func (s *Service) DeleteNotification(w http.ResponseWriter, r *http.Request) {
	uid, ok := s.deviceUser(w, r, true)
	if !ok {
		return
	}
	deleted, err := s.Store.DeleteNotification(r.Context(), uid, chi.URLParam(r, "id"))
	if err != nil && !errors.Is(err, ErrInvalidInput) {
		writeErr(w, err)
		return
	}
	if !deleted {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "no such notification"))
		return
	}
	s.publishUnread(r.Context(), uid, nil)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}
