package brain

/*
CircleXO hub seam (docs/circlexo.md in the harness).

When the harness publishes a hubapi.Hub on the kernel, /api/mcp also accepts an
access token the CircleXO hub issued. It is turned into the SAME Principal an
OAuth-connected app gets, so every scoping rule already in place applies to it:
the brains it may touch are the ones attributed to the token's org, and each
call re-checks the person's CURRENT membership of the brain. A hub token can
therefore never reach further than the person behind it.

With no hub published (the integration is off) every function here is a no-op.
*/

import (
	"context"
	"errors"
	"net/http"

	"github.com/togo-framework/brain/hubapi"
)

func (s *Service) hubImpl() hubapi.Hub {
	if s.k == nil {
		return nil
	}
	v, ok := s.k.Get(hubapi.Key)
	if !ok {
		return nil
	}
	h, _ := v.(hubapi.Hub)
	return h
}

// hubPrincipal is the Principal a verified hub identity stands for.
func hubPrincipal(id *hubapi.Identity) *Principal {
	p := &Principal{
		UserID:     id.UserID,
		ClientID:   "circlexo",
		ClientName: "CircleXO",
		Scopes:     []string{ScopeRead},
		Namespaces: map[string]bool{},
	}
	if id.AgentID != "" {
		p.ClientName = "CircleXO agent " + id.AgentID
	}
	if id.Write {
		p.Scopes = []string{ScopeRead, ScopeWrite}
	}
	for _, ns := range id.Namespaces {
		p.Namespaces[ns] = id.Write
	}
	return p
}

// authenticateHub reports (credential, nil, true) for a valid hub token, a
// refusal for a valid one that may not act, and ok=false when the token is not
// a hub token at all.
func (s *Service) authenticateHub(ctx context.Context, tok string) (*mcpCredential, *hubapi.Refusal, bool) {
	h := s.hubImpl()
	if h == nil {
		return nil, nil, false
	}
	id, err := h.Authenticate(ctx, tok)
	var ref *hubapi.Refusal
	if errors.As(err, &ref) {
		return nil, ref, true
	}
	if err != nil || id == nil {
		return nil, nil, false
	}
	return &mcpCredential{principal: hubPrincipal(id), hub: id}, nil, true
}

// meterHub charges one request to the token's org before a tool runs.
func (s *Service) meterHub(ctx context.Context, id *hubapi.Identity) *hubapi.Refusal {
	h := s.hubImpl()
	if h == nil || id == nil {
		return nil
	}
	var ref *hubapi.Refusal
	if err := h.Meter(ctx, id); errors.As(err, &ref) {
		return ref
	} else if err != nil {
		return &hubapi.Refusal{Status: http.StatusServiceUnavailable, Message: "usage could not be recorded, try again"}
	}
	return nil
}

// claimBrain is Store.ClaimBrain plus the hub's plan check and attribution.
func (s *Service) claimBrain(ctx context.Context, ns, userID string) error {
	h := s.hubImpl()
	if h == nil {
		return s.Store.ClaimBrain(ctx, ns, userID)
	}
	if err := h.BeforeNewBrain(ctx, userID, ns); err != nil {
		return err
	}
	if err := s.Store.ClaimBrain(ctx, ns, userID); err != nil {
		return err
	}
	h.BrainCreated(ctx, userID, ns)
	return nil
}

// brainDeleted releases a deleted brain from its hub org.
func (s *Service) brainDeleted(ctx context.Context, ns string) {
	if h := s.hubImpl(); h != nil {
		h.BrainDeleted(ctx, ns)
	}
}

// refusal extracts a hub refusal from an error.
func refusal(err error) *hubapi.Refusal {
	var ref *hubapi.Refusal
	if errors.As(err, &ref) {
		return ref
	}
	return nil
}

