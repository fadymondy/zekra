package presentations

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// A deck's link opens exactly the pages that deck embeds, and nothing else.
func TestSharedEmbed(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	page := create(t, s, KindPage)
	stranger := create(t, s, KindPage)
	report := create(t, s, KindReport)
	deck, err := s.Create(ctx, PresentationInput{Namespace: testNS, Kind: KindDeck, Customer: customer(), Content: mutate(t, KindDeck, func(m map[string]any) {
		m["slides"] = append(m["slides"].([]any),
			map[string]any{"type": "embed", "document_id": page.ID})
	})}, "owner")
	if err != nil {
		t.Fatal(err)
	}
	dl, _ := s.CreateShare(ctx, deck.ID, PresentationShareInput{}, "")
	pl, _ := s.CreateShare(ctx, page.ID, PresentationShareInput{}, "")

	got, err := s.OpenSharedEmbed(ctx, dl.Token, page.ID, "")
	if err != nil || got.Kind != KindPage || got.Content["title"] == nil || got.Customer != "Sara" {
		t.Fatalf("embedded page: %v %+v", err, got)
	}
	for name, c := range map[string][2]string{
		"a page the deck does not embed": {dl.Token, stranger.ID},
		"a report id":                    {dl.Token, report.ID},
		"a page link used as a deck":     {pl.Token, page.ID},
		"an unknown token":               {strings.Repeat("a", 43), page.ID},
		"an empty id":                    {dl.Token, ""},
	} {
		if _, err := s.OpenSharedEmbed(ctx, c[0], c[1], ""); !errors.Is(err, ErrLinkUnavailable) {
			t.Errorf("%s: %v", name, err)
		}
	}

	// (The HTTP path, /api/p/{token}/embed/{id}, is covered in internal/brain.)

	// Revoking the deck link closes the embed too.
	if err := s.RevokeShare(ctx, deck.ID, dl.Share.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.OpenSharedEmbed(ctx, dl.Token, page.ID, ""); !errors.Is(err, ErrLinkUnavailable) {
		t.Fatalf("revoked deck link still opens its embed: %v", err)
	}
}
