// Package hubapi is the seam between the brain plugin and the CircleXO hub
// integration (internal/circlexo in the harness). The brain plugin is its own
// module and never imports the harness, so the harness publishes an
// implementation on the kernel under Key and the plugin consults it. With no
// implementation published (the integration is off) nothing here is used.
package hubapi

import "context"

// Key is the kernel service key the harness publishes the Hub under.
const Key = "zekra.hub"

// Identity is a verified hub token mapped onto Zekra: who the person is, which
// hub org the call is for, and the brains that org owns. The brain plugin still
// re-checks the person's CURRENT brain membership on every call.
type Identity struct {
	UserID     string   // the Zekra user the hub subject is linked to
	OrgID      string   // the hub org named by the token
	Subject    string   // the hub user id (token sub)
	Namespaces []string // the brains attributed to the org
	Write      bool     // the token may write (tool scopes or an agent token)
	Actors     []string // the delegation chain (act claim), for the activity trail
	AgentID    string   // the agent the hub gateway issued the token for, if any
}

// Refusal is a hub token that is valid but may not act (an unlinked user, an
// org that is not connected, a plan without the feature, an empty wallet).
type Refusal struct {
	Status  int
	Message string
}

func (r *Refusal) Error() string { return r.Message }

// Hub is what the harness publishes when the integration is on.
type Hub interface {
	// Authenticate verifies a bearer token issued by the hub. (nil, nil) means it
	// is not a valid hub token and the caller falls through to Zekra's own
	// credentials; a *Refusal means it is one but may not proceed.
	Authenticate(ctx context.Context, token string) (*Identity, error)
	// Meter records one billable request for the identity's org (the `requests`
	// meter) before the work runs. A *Refusal (402) means the org is out of
	// allowance or balance.
	Meter(ctx context.Context, id *Identity) error
	// BeforeNewBrain is asked before a signed-in user creates a brain. A *Refusal
	// (402) means the user's hub org has no room under its plan.
	BeforeNewBrain(ctx context.Context, userID, namespace string) error
	// BrainCreated records that the user created the brain (attributes it to the
	// org that is billed for it).
	BrainCreated(ctx context.Context, userID, namespace string)
	// BrainDeleted releases the brain from its org.
	BrainDeleted(ctx context.Context, namespace string)
}
