package account

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type fakePurger struct {
	revoked, purged []string
	err             error
}

func (f *fakePurger) RevokeUserDevices(_ context.Context, userID string) map[string]int {
	f.revoked = append(f.revoked, userID)
	return map[string]int{"device_tokens": 1}
}

func (f *fakePurger) PurgeUserData(_ context.Context, userID string) (map[string]int, error) {
	f.purged = append(f.purged, userID)
	if f.err != nil {
		return map[string]int{"brains_deleted": 0}, f.err
	}
	return map[string]int{"brains_deleted": 2}, nil
}

// PurgeUser deletes the account's brain data (and its avatar file) before the
// user row; when the brain purge fails the account stays, so the next run retries.
func TestFlowPurgeDeletesUserData(t *testing.T) {
	s, _, _ := testService(t)
	ctx := context.Background()
	stamp := time.Now().Format("150405.000000")
	email, userID := "zk-purge-"+stamp+"@example.test", "zk-purge-"+stamp
	if _, err := s.DB.Exec(`INSERT INTO users (id, email, roles, permissions, created_at) VALUES ($1,$2,'','',$3)`,
		userID, email, time.Now().UTC().Format(time.RFC3339)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.UserData = nil; _, _ = s.PurgeUser(context.Background(), userID, email) })

	dir := t.TempDir()
	s.Blobs = dirBlobs{root: dir}
	avatar := filepath.Join(dir, "avatars", userID, "abc.png")
	if err := os.MkdirAll(filepath.Dir(avatar), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(avatar, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`INSERT INTO account_profiles (user_id, avatar) VALUES ($1,$2)`, userID, avatarPrefix+userID+"/abc.png"); err != nil {
		t.Fatal(err)
	}

	// A failing brain purge keeps the account.
	p := &fakePurger{err: errors.New("database went away")}
	s.UserData = func() UserDataPurger { return p }
	if _, err := s.PurgeUser(ctx, userID, email); err == nil {
		t.Fatal("PurgeUser succeeded although the brain purge failed")
	}
	var n int
	_ = s.DB.QueryRow(`SELECT count(*) FROM users WHERE id = $1`, userID).Scan(&n)
	if n != 1 {
		t.Fatalf("the user row went although the brain purge failed")
	}

	p.err = nil
	summary, err := s.PurgeUser(ctx, userID, email)
	if err != nil {
		t.Fatal(err)
	}
	if summary["brain.brains_deleted"] != 2 || summary["users"] != 1 || summary["avatar_files"] != 1 {
		t.Fatalf("summary = %v", summary)
	}
	if len(p.revoked) == 0 || p.purged[len(p.purged)-1] != userID {
		t.Fatalf("purger calls: revoked %v, purged %v", p.revoked, p.purged)
	}
	if _, err := os.Stat(avatar); !os.IsNotExist(err) {
		t.Fatalf("the avatar file survived: %v", err)
	}
}

// Without the brain plugin (nil resolver, or nothing on the kernel) a purge still works.
func TestUserDataNilResolver(t *testing.T) {
	s := &Service{}
	if s.userData() != nil {
		t.Fatal("want nil without a resolver")
	}
	if kernelUserData(nil)() != nil {
		t.Fatal("want nil without a kernel")
	}
}
