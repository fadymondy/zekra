package brain

import (
	"context"
	"net/http"
	"testing"

	"github.com/togo-framework/brain/hubapi"
	"github.com/togo-framework/togo"
)

type fakeHub struct {
	id      *hubapi.Identity
	err     error
	metered int
}

func (f *fakeHub) Authenticate(context.Context, string) (*hubapi.Identity, error) { return f.id, f.err }
func (f *fakeHub) Meter(context.Context, *hubapi.Identity) error {
	f.metered++
	return f.err
}
func (f *fakeHub) BeforeNewBrain(context.Context, string, string) error { return f.err }
func (f *fakeHub) BrainCreated(context.Context, string, string)          {}
func (f *fakeHub) BrainDeleted(context.Context, string)                  {}

func TestHubPrincipal(t *testing.T) {
	ro := hubPrincipal(&hubapi.Identity{UserID: "u1", Namespaces: []string{"a", "b"}})
	if len(ro.Scopes) != 1 || ro.Scopes[0] != ScopeRead || ro.Namespaces["a"] {
		t.Fatalf("read-only principal: %+v", ro)
	}
	if _, ok := ro.Namespaces["a"]; !ok {
		t.Fatalf("namespace a missing: %+v", ro.Namespaces)
	}
	rw := hubPrincipal(&hubapi.Identity{UserID: "u1", Namespaces: []string{"a"}, Write: true, AgentID: "ag"})
	if len(rw.Scopes) != 2 || !rw.Namespaces["a"] || rw.UserID != "u1" {
		t.Fatalf("read-write principal: %+v", rw)
	}
}

func TestAuthenticateHubOffAndOn(t *testing.T) {
	k := togo.New()
	t.Cleanup(k.Close)
	s := &Service{k: k}
	// Integration off: nothing is a hub token and nothing is metered.
	if c, ref, ok := s.authenticateHub(context.Background(), "tok"); c != nil || ref != nil || ok {
		t.Fatalf("off: %v %v %v", c, ref, ok)
	}
	if ref := s.meterHub(context.Background(), &hubapi.Identity{}); ref != nil {
		t.Fatalf("off, meter: %v", ref)
	}

	f := &fakeHub{id: &hubapi.Identity{UserID: "u1", OrgID: "o1", Namespaces: []string{"a"}}}
	k.Set(hubapi.Key, f)
	c, ref, ok := s.authenticateHub(context.Background(), "tok")
	if !ok || ref != nil || c == nil || c.hub == nil || c.principal.UserID != "u1" {
		t.Fatalf("valid: %+v %v %v", c, ref, ok)
	}
	if ref := s.meterHub(context.Background(), f.id); ref != nil || f.metered != 1 {
		t.Fatalf("meter: %v %d", ref, f.metered)
	}

	// A valid token that may not act is a refusal with the hub's status; a non-hub token falls through.
	f.id, f.err = nil, &hubapi.Refusal{Status: http.StatusPaymentRequired, Message: "no plan"}
	if _, ref, ok := s.authenticateHub(context.Background(), "tok"); !ok || ref == nil || ref.Status != http.StatusPaymentRequired {
		t.Fatalf("refusal: %v %v", ref, ok)
	}
	if ref := s.meterHub(context.Background(), &hubapi.Identity{}); ref == nil || ref.Status != http.StatusPaymentRequired {
		t.Fatalf("metered refusal: %v", ref)
	}
	f.err = nil
	if _, ref, ok := s.authenticateHub(context.Background(), "tok"); ok || ref != nil {
		t.Fatalf("not a hub token: %v %v", ref, ok)
	}
}
