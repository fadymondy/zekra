package circlexo

import (
	"context"
	"testing"

	"github.com/circlexo/circlexo-go/webhooks"
)

// MH-1149: once the hub's install is active, a missing link means the org was deleted in Zekra.
// A sign-in tells the hub instead of making a new one; installing again from the hub does.
func TestSignInDoesNotRecreateADeletedOrg(t *testing.T) {
	s := boot(t)
	org := "org-" + rnd()
	sub := "own-" + rnd()
	s.install(org, [2]string{sub, "owner"})
	s.entitle(org, true, nil)
	if _, _, err := s.login(sub, sub+"@example.test", true, org, "owner"); err != nil {
		t.Fatalf("first sign-in: %v", err)
	}
	s.link(org)
	if _, err := s.db.Exec(`DELETE FROM circlexo_org_links WHERE org_id = $1`, org); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.login(sub, sub+"@example.test", true, org, "owner"); err != nil {
		t.Fatalf("sign-in after delete: %v", err)
	}
	if _, err := s.svc.OrgByID(context.Background(), org); err == nil {
		t.Fatal("a sign-in re-created the deleted org")
	}
	s.hub.Lock()
	tn, still := s.hub.Tenants[org]
	s.hub.Unlock()
	if still && tn.Status != "removed" {
		t.Fatalf("the hub was not told: %q", tn.Status)
	}
	s.install(org, [2]string{sub, "owner"})
	if _, _, err := s.login(sub, sub+"@example.test", true, org, "owner"); err != nil {
		t.Fatalf("sign-in after reinstall: %v", err)
	}
	s.link(org)
}

// MH-1149: the hub's verified address reaches the linked account, at sign-in and on user.updated;
// an unverified one does not.
func TestHubProfileSync(t *testing.T) {
	s := boot(t)
	tag := rnd()
	sub := "sub-p-" + tag
	if _, _, err := s.login(sub, "first-"+tag+"@example.test", true, "", ""); err != nil {
		t.Fatal(err)
	}
	uid := s.userID("first-" + tag + "@example.test")
	emailOf := func() string {
		t.Helper()
		e, err := s.svc.emailOf(context.Background(), uid)
		if err != nil {
			t.Fatal(err)
		}
		return e
	}
	if _, _, err := s.login(sub, "moved-"+tag+"@example.test", true, "", ""); err != nil {
		t.Fatalf("sign-in with a new address: %v", err)
	}
	if got := emailOf(); got != "moved-"+tag+"@example.test" {
		t.Fatalf("sign-in sync: %q", got)
	}
	user := map[string]any{"id": sub, "email": "again-" + tag + "@example.test", "email_verified": true, "display_name": "X"}
	if got := s.event(webhooks.UserUpdated, "org-any", map[string]any{"user": user}, "ev-"+rnd()); got >= 300 {
		t.Fatalf("user.updated: %d", got)
	}
	if got := emailOf(); got != "again-"+tag+"@example.test" {
		t.Fatalf("user.updated sync: %q", got)
	}
	user["email"], user["email_verified"] = "unv-"+tag+"@example.test", false
	s.event(webhooks.UserUpdated, "org-any", map[string]any{"user": user}, "ev-"+rnd())
	if got := emailOf(); got != "again-"+tag+"@example.test" {
		t.Fatalf("an unverified address replaced the account's: %q", got)
	}
}
