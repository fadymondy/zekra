package brain

/*
Notification center tests (MH-360). Database-backed, on the same fixtures as the
push tests (devices_test.go: pushFix): TEST_DATABASE_URL runs everything;
PUSH_TEST_DATABASE_URL (plain Postgres) runs the store/handler/notify tests
against just the push + notifications tables, and the trigger tests too when
brain_members/brain_profiles/presentations/presentation_shares exist there.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/togo-framework/brain/presentations"
)

func notificationsSchemaBlock(t *testing.T) string {
	t.Helper()
	start := strings.Index(schemaSQL, "-- ── Notification center: per-user inbox (MH-360)")
	if start < 0 {
		t.Fatal("notifications block not found in schema.sql")
	}
	return schemaSQL[start:]
}

var notifMigrateOnce sync.Once
var notifMigrateErr error

// notifFix is pushFix plus the notifications table (on a plain database).
func notifFix(t *testing.T) (*fix, bool) {
	t.Helper()
	f, full := pushFix(t)
	if os.Getenv("TEST_DATABASE_URL") == "" {
		db, err := f.svc.Store.db(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		notifMigrateOnce.Do(func() { _, notifMigrateErr = db.Exec(notificationsSchemaBlock(t)) })
		if notifMigrateErr != nil {
			t.Fatal(notifMigrateErr)
		}
	}
	clean := func() {
		if db, err := f.svc.Store.db(context.Background()); err == nil {
			_, _ = db.Exec(`DELETE FROM brain_notifications WHERE user_id LIKE $1`, f.prefix+"%")
		}
	}
	clean()
	t.Cleanup(clean)
	return f, full
}

func testMessage(kind, en string) pushMessage {
	return pushMessage{
		Text: map[string]pushText{"en": {Title: en, Body: en + " body"}, "ar": {Title: "ع " + en, Body: "نص"}},
		Data: map[string]string{"type": kind, "route": "/note/" + kind, "note_id": kind},
	}
}

func TestNotificationStore(t *testing.T) {
	f, _ := notifFix(t)
	ctx := context.Background()
	st := f.svc.Store
	alice, bob := f.user("alice"), f.user("bob")

	var aliceIDs []string
	for i := 0; i < 5; i++ {
		n, err := st.insertNotification(ctx, alice, testMessage("k"+string(rune('a'+i)), "hello"))
		if err != nil {
			t.Fatal(err)
		}
		if n.ID == "" || n.Kind != "k"+string(rune('a'+i)) || n.Route != "/note/"+n.Kind || n.Data["note_id"] != n.Kind || n.Data["type"] != "" {
			t.Fatalf("inserted = %+v", n)
		}
		aliceIDs = append(aliceIDs, n.ID)
	}
	bobN, err := st.insertNotification(ctx, bob, testMessage("x", "for bob"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.insertNotification(ctx, "", testMessage("x", "nobody")); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty user accepted: %v", err)
	}

	// Paging: 2 + 2 + 1, newest first, no overlap, bob's never included.
	seen := map[string]bool{}
	cursor, pages := "", 0
	var last time.Time
	for {
		items, next, err := st.ListNotifications(ctx, alice, "", cursor, 2)
		if err != nil {
			t.Fatal(err)
		}
		pages++
		for _, n := range items {
			if seen[n.ID] || n.ID == bobN.ID {
				t.Fatalf("duplicate or foreign item %s", n.ID)
			}
			if !last.IsZero() && n.CreatedAt.After(last) {
				t.Fatal("not newest first")
			}
			last = n.CreatedAt
			seen[n.ID] = true
			if n.Title != "hello" || n.ReadAt != nil {
				t.Fatalf("item = %+v", n)
			}
		}
		if next == "" {
			break
		}
		cursor = next
	}
	if len(seen) != 5 || pages != 3 {
		t.Fatalf("paged %d items in %d pages", len(seen), pages)
	}
	if _, _, err := st.ListNotifications(ctx, alice, "", "%%not-a-cursor", 2); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("bad cursor: %v", err)
	}
	// A reader's locale picks the stored translation.
	if items, _, _ := st.ListNotifications(ctx, alice, "ar", "", 1); len(items) != 1 || items[0].Title != "ع hello" {
		t.Fatalf("ar = %+v", items)
	}

	if n, _ := st.UnreadNotifications(ctx, alice); n != 5 {
		t.Fatalf("unread = %d", n)
	}
	// Marking by id ignores ids that are not the caller's.
	if n, err := st.MarkNotificationsRead(ctx, alice, []string{aliceIDs[0], bobN.ID, "no-such-id"}, false); err != nil || n != 1 {
		t.Fatalf("mark = %d %v", n, err)
	}
	if n, _ := st.UnreadNotifications(ctx, bob); n != 1 {
		t.Fatalf("bob unread = %d (alice marked bob's item)", n)
	}
	if n, _ := st.MarkNotificationsRead(ctx, alice, []string{aliceIDs[0]}, false); n != 0 {
		t.Fatalf("re-marking counted %d", n)
	}
	if n, _ := st.MarkNotificationsRead(ctx, alice, nil, true); n != 4 {
		t.Fatalf("mark all = %d", n)
	}
	if n, _ := st.UnreadNotifications(ctx, alice); n != 0 {
		t.Fatalf("unread after all = %d", n)
	}
	if items, _, _ := st.ListNotifications(ctx, alice, "", "", 10); items[0].ReadAt == nil {
		t.Fatal("readAt not set")
	}
	many := make([]string, maxMarkIDs+1)
	for i := range many {
		many[i] = "id"
	}
	if _, err := st.MarkNotificationsRead(ctx, alice, many, false); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("too many ids: %v", err)
	}

	// Delete: only your own.
	if ok, _ := st.DeleteNotification(ctx, alice, bobN.ID); ok {
		t.Fatal("alice deleted bob's item")
	}
	if ok, _ := st.DeleteNotification(ctx, alice, aliceIDs[2]); !ok {
		t.Fatal("alice could not delete her item")
	}
	if items, _, _ := st.ListNotifications(ctx, alice, "", "", 10); len(items) != 4 {
		t.Fatalf("after delete: %d", len(items))
	}
}

func TestNotificationHandlers(t *testing.T) {
	f, _ := notifFix(t)
	ctx := context.Background()
	alice, bob := f.user("alice"), f.user("bob")
	a1, _ := f.svc.Store.insertNotification(ctx, alice, testMessage("brain_access", "one"))
	a2, _ := f.svc.Store.insertNotification(ctx, alice, testMessage("brain_access", "two"))

	for _, r := range []req{
		{method: "GET", path: "/api/me/notifications"},
		{method: "GET", path: "/api/me/notifications/unread"},
		{method: "POST", path: "/api/me/notifications/read", body: map[string]any{"all": true}},
		{method: "DELETE", path: "/api/me/notifications/" + a1.ID},
	} {
		if rec := f.do(r); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s anonymous = %d %s", r.method, r.path, rec.Code, rec.Body)
		}
	}

	rec := f.do(req{method: "GET", path: "/api/me/notifications?limit=1&locale=ar", user: alice})
	var page struct {
		Items      []Notification `json:"items"`
		NextCursor string         `json:"nextCursor"`
		Unread     int            `json:"unread"`
	}
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &page) != nil {
		t.Fatalf("list = %d %s", rec.Code, rec.Body)
	}
	if len(page.Items) != 1 || page.NextCursor == "" || page.Unread != 2 || page.Items[0].Title != "ع two" {
		t.Fatalf("page = %+v", page)
	}
	if !strings.Contains(rec.Body.String(), `"createdAt"`) || !strings.Contains(rec.Body.String(), `"readAt":null`) {
		t.Fatalf("wire shape = %s", rec.Body)
	}
	rec = f.do(req{method: "GET", path: "/api/me/notifications?cursor=" + url.QueryEscape(page.NextCursor), user: alice})
	page.NextCursor = "" // absent on the last page
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || len(page.Items) != 1 || page.Items[0].ID != a1.ID || page.NextCursor != "" {
		t.Fatalf("page 2 = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(req{method: "GET", path: "/api/me/notifications?cursor=bogus!", user: alice}); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad cursor = %d", rec.Code)
	}
	if rec := f.do(req{method: "GET", path: "/api/me/notifications/unread", user: bob}); rec.Code != http.StatusOK || decodeMap(t, rec)["unread"] != float64(0) {
		t.Fatalf("bob unread = %d %s", rec.Code, rec.Body)
	}

	// A cookie-style form post without CSRF is refused.
	if rec := f.do(req{method: "POST", path: "/api/me/notifications/read", user: alice, body: "all=true",
		headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"}}); rec.Code != http.StatusForbidden {
		t.Fatalf("form post without csrf = %d", rec.Code)
	}
	if rec := f.do(req{method: "POST", path: "/api/me/notifications/read", user: alice, body: map[string]any{}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty read = %d", rec.Code)
	}
	// Bob cannot mark or delete alice's items.
	rec = f.do(req{method: "POST", path: "/api/me/notifications/read", user: bob, body: map[string]any{"ids": []string{a1.ID, a2.ID}}})
	if rec.Code != http.StatusOK || decodeMap(t, rec)["updated"] != float64(0) {
		t.Fatalf("bob mark = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(req{method: "DELETE", path: "/api/me/notifications/" + a1.ID, user: bob}); rec.Code != http.StatusNotFound {
		t.Fatalf("bob delete = %d", rec.Code)
	}
	if n, _ := f.svc.Store.UnreadNotifications(ctx, alice); n != 2 {
		t.Fatalf("alice unread after bob = %d", n)
	}
	// Alice marks one read (bearer JSON, as the app calls), then deletes the other.
	rec = f.do(req{method: "POST", path: "/api/me/notifications/read", user: alice, body: map[string]any{"ids": []string{a1.ID}},
		headers: map[string]string{"Authorization": "Bearer session-jwt"}})
	if m := decodeMap(t, rec); rec.Code != http.StatusOK || m["updated"] != float64(1) || m["unread"] != float64(1) {
		t.Fatalf("alice mark = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(req{method: "DELETE", path: "/api/me/notifications/" + a2.ID, user: alice}); rec.Code != http.StatusOK {
		t.Fatalf("alice delete = %d %s", rec.Code, rec.Body)
	}
	if rec := f.do(req{method: "POST", path: "/api/me/notifications/read", user: alice, body: map[string]any{"all": true}}); rec.Code != http.StatusOK || decodeMap(t, rec)["updated"] != float64(0) {
		t.Fatalf("mark all = %d %s", rec.Code, rec.Body)
	}
}

// drainEvents returns the events waiting on sub.
func drainEvents(sub *subscriber) []string {
	var out []string
	for {
		select {
		case m := <-sub.ch:
			out = append(out, m)
		default:
			return out
		}
	}
}

func TestNotifyRecordsInboxWithoutFCM(t *testing.T) {
	f, _ := notifFix(t)
	ctx := context.Background()
	t.Setenv("FCM_SERVICE_ACCOUNT_JSON", "")
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "")
	pushers.Delete(f.svc)
	if f.svc.pusher().d != nil {
		t.Fatal("push configured")
	}
	alice, bob := f.user("alice"), f.user("bob")
	aliceSub := f.svc.hub.subscribeAs(func(string) bool { return true }, alice)
	bobSub := f.svc.hub.subscribeAs(func(string) bool { return true }, bob)
	adminSub := f.svc.hub.subscribe(nil)
	defer f.svc.hub.unsubscribe(aliceSub)
	defer f.svc.hub.unsubscribe(bobSub)
	defer f.svc.hub.unsubscribe(adminSub)

	n, err := f.svc.notify(ctx, alice, brainAccessMessage(f.ns("team"), "Team"))
	if err != nil || n == nil {
		t.Fatalf("notify = %v %v", n, err)
	}
	items, _, _ := f.svc.Store.ListNotifications(ctx, alice, "", "", 10)
	if len(items) != 1 || items[0].Kind != "brain_access" || items[0].Route != "/brain/"+url.PathEscape(f.ns("team")) || items[0].Data["namespace"] != f.ns("team") {
		t.Fatalf("inbox = %+v", items)
	}
	// Live: alice's stream hears it (with the unread count); nobody else's does —
	// not bob's, and not an admin's.
	got := drainEvents(aliceSub)
	if len(got) != 1 || !strings.HasPrefix(got[0], "event: notification\n") || !strings.Contains(got[0], `"unread":1`) || !strings.Contains(got[0], n.ID) {
		t.Fatalf("alice events = %q", got)
	}
	if ev := drainEvents(bobSub); len(ev) != 0 {
		t.Fatalf("bob heard alice's notification: %q", ev)
	}
	if ev := drainEvents(adminSub); len(ev) != 0 {
		t.Fatalf("admin heard alice's notification: %q", ev)
	}
	// Background path (notifyLater) records too.
	f.svc.notifyLater(func(context.Context) (string, pushMessage, bool) {
		return alice, testMessage("later", "later"), true
	})
	f.svc.pusher().wg.Wait()
	if n, _ := f.svc.Store.UnreadNotifications(ctx, alice); n != 2 {
		t.Fatalf("unread after notifyLater = %d", n)
	}
}

func TestNotifyPushCarriesNotificationID(t *testing.T) {
	f, _ := notifFix(t)
	ctx := context.Background()
	alice := f.user("alice")
	if _, err := f.svc.Store.UpsertDeviceToken(ctx, alice, f.prefix+"notif-token-ffffffffff", "android", "", "ar"); err != nil {
		t.Fatal(err)
	}
	d, p := f.fakePush()
	n, err := f.svc.notify(ctx, alice, presentationViewedPush("doc-1", "Q3"))
	if err != nil {
		t.Fatal(err)
	}
	p.wg.Wait()
	if len(d.got) != 1 || d.got[0].data["notificationId"] != n.ID || d.got[0].data["route"] != "/presentation/doc-1" {
		t.Fatalf("push = %+v", d.got)
	}
	// The inbox row is in the recipient's (device) language.
	if n.Title != "تم فتح العرض" {
		t.Fatalf("inbox title = %q", n.Title)
	}
}

func TestNotifyNewMemberRecordsInbox(t *testing.T) {
	f, full := notifFix(t)
	if !full {
		t.Skip("needs the brain_members/brain_profiles tables")
	}
	ctx := context.Background()
	t.Setenv("FCM_SERVICE_ACCOUNT_JSON", "")
	t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "")
	pushers.Delete(f.svc)
	ns := f.ns("inboxbrain")
	owner, alice := f.user("owner"), f.user("alice")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1, $2, 'owner')`, ns, owner)

	rec := f.do(req{method: "POST", path: "/api/brain/members", user: owner, body: map[string]any{"namespace": ns, "userId": alice, "role": "viewer"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("set member = %d %s", rec.Code, rec.Body)
	}
	f.svc.pusher().wg.Wait()
	items, _, _ := f.svc.Store.ListNotifications(ctx, alice, "", "", 10)
	if len(items) != 1 || items[0].Kind != "brain_access" || items[0].Route != "/brain/"+url.PathEscape(ns) {
		t.Fatalf("inbox = %+v", items)
	}
	// A role change is not news.
	f.do(req{method: "POST", path: "/api/brain/members", user: owner, body: map[string]any{"namespace": ns, "userId": alice, "role": "editor"}})
	f.svc.pusher().wg.Wait()
	if n, _ := f.svc.Store.UnreadNotifications(ctx, alice); n != 1 {
		t.Fatalf("role change recorded: unread = %d", n)
	}
}

func TestNotifyPresentationFirstDownload(t *testing.T) {
	f, full := notifFix(t)
	if !full {
		t.Skip("needs the presentations tables")
	}
	ctx := context.Background()
	owner := f.user("dlowner")
	docID, shareID, hash := f.prefix+"dldoc", f.prefix+"dlshare", f.prefix+"dlhash"
	f.exec(`INSERT INTO presentations (id, namespace, owner_user_id, kind, title, content) VALUES ($1, $2, $3, 'deck', 'Q4 plan', '{}')`, docID, f.ns("pres"), owner)
	f.exec(`INSERT INTO presentation_shares (id, presentation_id, token_hash, download_count) VALUES ($1, $2, $3, 1)`, shareID, docID, hash)

	if _, _, ok := f.svc.presentationEventMessage(ctx, presentations.EventDownload, hash, owner); ok {
		t.Fatal("the owner's own download notified")
	}
	uid, msg, ok := f.svc.presentationEventMessage(ctx, presentations.EventDownload, hash, "")
	if !ok || uid != owner || msg.Data["type"] != "presentation_downloaded" || msg.Data["route"] != "/presentation/"+url.PathEscape(docID) || msg.Data["namespace"] != f.ns("pres") {
		t.Fatalf("first download = %v %q %+v", ok, uid, msg)
	}
	if _, _, ok := f.svc.presentationEventMessage(ctx, presentations.EventDownload, hash, ""); ok {
		t.Fatal("second download notified again")
	}
	// Views are claimed separately: the first view still notifies.
	f.exec(`UPDATE presentation_shares SET view_count = 1 WHERE id = $1`, shareID)
	if _, msg, ok := f.svc.presentationViewedMessage(ctx, hash, ""); !ok || msg.Data["type"] != "presentation_viewed" {
		t.Fatal("first view after a download did not notify")
	}
}
