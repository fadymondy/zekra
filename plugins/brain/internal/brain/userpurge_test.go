package brain

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// The account service resolves the brain service structurally (internal/account
// userdata.go); this keeps the method set in step.
var _ interface {
	RevokeUserDevices(ctx context.Context, userID string) map[string]int
	PurgeUserData(ctx context.Context, userID string) (map[string]int, error)
} = (*Service)(nil)

func TestPurgeUserData(t *testing.T) {
	f := newFix(t)
	storage := t.TempDir()
	t.Setenv("STORAGE_DIR", storage)
	ctx := context.Background()
	st := f.svc.Store
	alice, bob := f.prefix+"alice", f.prefix+"bob"
	solo, shared, bobs := f.ns("solo"), f.ns("shared"), f.ns("bobs")
	t.Cleanup(func() {
		db, _ := st.db(context.Background())
		for _, q := range []string{
			`DELETE FROM device_tokens WHERE user_id IN ($1,$2)`,
			`DELETE FROM brain_notifications WHERE user_id IN ($1,$2)`,
			`DELETE FROM mcp_oauth_grants WHERE user_id IN ($1,$2)`,
			`DELETE FROM presentations WHERE id LIKE $1 || '%' OR id LIKE $2 || '%'`,
			`DELETE FROM brain_media WHERE owner_user_id IN ($1,$2) OR namespace LIKE $1 || '%'`,
		} {
			_, _ = db.Exec(q, alice, bob)
		}
		_, _ = db.Exec(`DELETE FROM mcp_oauth_clients WHERE id = $1`, f.prefix+"client")
	})

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// solo: alice alone. shared: alice + bob own it. bobs: bob owns, alice edits.
	must(st.ClaimBrain(ctx, solo, alice))
	must(st.ClaimBrain(ctx, shared, alice))
	f.exec(`INSERT INTO brain_members (namespace, user_id, role, created_by) VALUES ($1,$2,'owner',$3)`, shared, bob, alice)
	must(st.ClaimBrain(ctx, bobs, bob))
	f.exec(`INSERT INTO brain_members (namespace, user_id, role, created_by) VALUES ($1,$2,'editor',$3)`, bobs, alice, bob)

	note := func(ns, user, title string) string {
		t.Helper()
		n, err := st.CreateNote(ctx, NoteInput{Namespace: ns, Title: title, Body: title + " body"}, NoteAuthor{UserID: user, Agent: "user:" + user, Source: "web"})
		must(err)
		return n.ID
	}
	note(solo, alice, "alice private")
	sharedNote := note(shared, alice, "alice in shared")
	bobsNote := note(bobs, alice, "alice in bobs")
	bobNote := note(shared, bob, "bob in shared")
	f.seedMemory(solo, "a memory only alice's brain holds")

	// Files: a media upload (tracked by row), a note image and a brain avatar.
	write := func(key string) string {
		t.Helper()
		p := filepath.Join(storage, filepath.FromSlash(key))
		must(os.MkdirAll(filepath.Dir(p), 0o755))
		must(os.WriteFile(p, []byte("x"), 0o644))
		return p
	}
	mediaFile := write("media/" + safeSegment(solo) + "/0123456789abcdef.png")
	noteImage := write("notes/" + safeSegment(solo) + "/0123456789ab.png")
	avatar := write("brains/" + safeSegment(solo) + "/image-1.png")
	bobsFile := write("media/" + safeSegment(bobs) + "/fedcba9876543210.png")
	f.exec(`INSERT INTO brain_media (namespace, owner_user_id, kind, content_type, bytes, digest, blob_key) VALUES ($1,$2,'image','image/png',1,'d1',$3)`,
		solo, alice, "media/"+safeSegment(solo)+"/0123456789abcdef.png")
	f.exec(`INSERT INTO brain_media (namespace, owner_user_id, kind, content_type, bytes, digest, blob_key) VALUES ($1,$2,'image','image/png',1,'d2',$3)`,
		bobs, alice, "media/"+safeSegment(bobs)+"/fedcba9876543210.png")
	f.exec(`INSERT INTO brain_profiles (namespace, image_key) VALUES ($1,$2)`, solo, "brains/"+safeSegment(solo)+"/image-1.png")

	// Presentations: one in alice's brain (with a share link), one she made in bob's.
	f.exec(`INSERT INTO presentations (id, namespace, owner_user_id, kind, created_by) VALUES ($1,$2,$3,'deck',$4)`, alice+"-p1", solo, alice, "user:"+alice)
	f.exec(`INSERT INTO presentation_shares (id, presentation_id, token_hash) VALUES ($1,$2,$3)`, alice+"-s1", alice+"-p1", alice+"-hash")
	f.exec(`INSERT INTO presentations (id, namespace, owner_user_id, kind, created_by) VALUES ($1,$2,$3,'deck',$4)`, alice+"-p2", bobs, alice, "user:"+alice)

	// Per-account rows.
	f.exec(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1,$2,'ios'), ($3,$4,'android')`, alice, alice+"-tok", bob, bob+"-tok")
	f.exec(`INSERT INTO brain_notifications (user_id, kind, title) VALUES ($1,'test','hi'), ($2,'test','hi')`, alice, bob)
	f.exec(`INSERT INTO mcp_oauth_clients (id, client_name) VALUES ($1,'p1 purge')`, f.prefix+"client")
	f.exec(`INSERT INTO mcp_oauth_grants (client_id, user_id) VALUES ($1,$2)`, f.prefix+"client", alice)

	// Scheduling revokes push tokens and connections at once.
	rev := f.svc.RevokeUserDevices(ctx, alice)
	if rev["device_tokens"] != 1 || rev["mcp_oauth_grants"] != 1 {
		t.Fatalf("revoke at scheduling = %v", rev)
	}

	out, err := f.svc.PurgeUserData(ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	if out["brains_deleted"] != 1 {
		t.Fatalf("brains_deleted = %d, want 1 (only the brain alice owns alone): %v", out["brains_deleted"], out)
	}

	// The sole-owned brain is gone, rows and files.
	for _, q := range []string{
		`SELECT count(*) FROM notes WHERE namespace = $1`,
		`SELECT count(*) FROM memories WHERE namespace = $1`,
		`SELECT count(*) FROM brain_media WHERE namespace = $1`,
		`SELECT count(*) FROM presentations WHERE namespace = $1`,
		`SELECT count(*) FROM brain_members WHERE namespace = $1`,
		`SELECT count(*) FROM brain_profiles WHERE namespace = $1`,
	} {
		if n := f.count(q, solo); n != 0 {
			t.Errorf("%s → %d, want 0", q, n)
		}
	}
	if n := f.count(`SELECT count(*) FROM presentation_shares WHERE id = $1`, alice+"-s1"); n != 0 {
		t.Errorf("share link survived")
	}
	for _, p := range []string{mediaFile, noteImage, avatar} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("file %s survived", p)
		}
	}

	// Shared brains stay, without alice.
	if n := f.count(`SELECT count(*) FROM brain_members WHERE user_id = $1`, alice); n != 0 {
		t.Errorf("alice is still a member of %d brains", n)
	}
	if n := f.count(`SELECT count(*) FROM brain_members WHERE namespace IN ($1,$2) AND user_id = $3`, shared, bobs, bob); n != 2 {
		t.Errorf("bob's memberships = %d, want 2", n)
	}
	for _, id := range []string{sharedNote, bobsNote, bobNote} {
		if n := f.count(`SELECT count(*) FROM notes WHERE id = $1`, id); n != 1 {
			t.Errorf("note %s in a shared brain was deleted", id)
		}
	}
	if n := f.count(`SELECT count(*) FROM notes WHERE owner_user_id = $1`, alice); n != 0 {
		t.Errorf("%d notes still carry alice's id", n)
	}
	if n := f.count(`SELECT count(*) FROM note_versions WHERE author_user_id = $1 OR author_agent = $2`, alice, "user:"+alice); n != 0 {
		t.Errorf("%d note versions still carry alice's id", n)
	}
	if n := f.count(`SELECT count(*) FROM notes WHERE id = $1 AND owner_user_id = $2`, bobNote, bob); n != 1 {
		t.Errorf("bob's note lost its owner")
	}
	if n := f.count(`SELECT count(*) FROM presentations WHERE id = $1 AND owner_user_id IS NULL AND created_by = ''`, alice+"-p2"); n != 1 {
		t.Errorf("alice's presentation in bob's brain was not detached")
	}
	if _, err := os.Stat(bobsFile); err != nil {
		t.Errorf("a file in bob's brain was deleted: %v", err)
	}

	// Per-account rows are gone; bob's are not.
	if n := f.count(`SELECT count(*) FROM device_tokens WHERE user_id = $1`, alice); n != 0 {
		t.Errorf("alice's push tokens survived")
	}
	if n := f.count(`SELECT count(*) FROM brain_notifications WHERE user_id = $1`, alice); n != 0 {
		t.Errorf("alice's notifications survived")
	}
	if n := f.count(`SELECT count(*) FROM device_tokens WHERE user_id = $1`, bob); n != 1 {
		t.Errorf("bob's push token was deleted")
	}
	if n := f.count(`SELECT count(*) FROM brain_notifications WHERE user_id = $1`, bob); n != 1 {
		t.Errorf("bob's notification was deleted")
	}

	// A second run finds nothing left to do.
	again, err := f.svc.PurgeUserData(ctx, alice)
	if err != nil || again["brains_deleted"] != 0 {
		t.Fatalf("second purge = %v, %v", again, err)
	}
	// The namespace is free again.
	must(st.ClaimBrain(ctx, solo, bob))
}
