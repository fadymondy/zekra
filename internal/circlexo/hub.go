package circlexo

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"slices"

	circlexo "github.com/circlexo/circlexo-go"
	"github.com/circlexo/circlexo-go/usage"
	"github.com/togo-framework/brain/hubapi"
)

/*
The brain plugin's view of the hub (hubapi.Hub), published on the kernel by internal/server.

Hub-issued MCP tokens. /api/mcp also accepts an access token the CircleXO hub issued (its MCP
gateway, or a client that got one from the hub's authorization server). It is verified against the
hub's JWKS with the audience set to Zekra's app id (the SDK's Verifier), then mapped:

	token subject -> Zekra user   circlexo_user_links (the person must have signed in with CircleXO
	                              once, or been synced from the org, so a link exists)
	token org_id  -> brains       circlexo_org_brains of an ACTIVE org link, and the person must be
	                              a member of the org (circlexo_org_members)
	membership    -> access       brain_members, re-read by the brain plugin on every call

An unlinked user, an unknown or removed org, or a non-member is refused (403), never guessed; an org
whose plan is not active is refused 402, and one whose entitlements cannot be confirmed 503 (fail
closed). Zekra's own zko_at_ / ACL tokens are handled before this and are unchanged.

Scopes. The hub gateway's scopes (openid, profile, email, org, ...) say nothing about what a tool
may do. A token that names brains:write, or that the gateway exchanged for an agent (it carries an
act chain), may write; any other hub token reads. The plugin then narrows either to the person's
current brain role, so an agent never exceeds its human, and never offers admin or destructive
tools to a hub token (the same rule as for OAuth-connected apps).
*/

func refusal(status int, msg string) *hubapi.Refusal {
	return &hubapi.Refusal{Status: status, Message: msg}
}

// Authenticate implements hubapi.Hub.
func (s *Service) Authenticate(ctx context.Context, token string) (*hubapi.Identity, error) {
	claims, err := s.Verifier.VerifyAccessToken(ctx, token)
	if err != nil || claims.Subject == "" || claims.IsService() {
		return nil, nil // not a hub token: the caller falls through to Zekra's own credentials
	}
	userID, err := s.UserBySubject(ctx, claims.Subject)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, refusal(http.StatusForbidden, "this CircleXO user has not signed in to Zekra yet: sign in with CircleXO once")
	}
	if err != nil {
		return nil, refusal(http.StatusServiceUnavailable, "try again shortly")
	}
	if claims.OrgID == "" {
		return nil, refusal(http.StatusForbidden, "this token names no organization")
	}
	link, err := s.OrgByID(ctx, claims.OrgID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !link.Active) {
		return nil, refusal(http.StatusForbidden, "this organization is not connected to Zekra")
	}
	if err != nil {
		return nil, refusal(http.StatusServiceUnavailable, "try again shortly")
	}
	var member bool
	if err := s.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM circlexo_org_members WHERE org_id = $1 AND user_id = $2)`, link.OrgID, userID).Scan(&member); err != nil {
		return nil, refusal(http.StatusServiceUnavailable, "try again shortly")
	}
	if !member {
		return nil, refusal(http.StatusForbidden, "you are not a member of this organization in Zekra")
	}
	if !s.Acct.UserActive(ctx, userID) {
		return nil, refusal(http.StatusForbidden, "this account is disabled")
	}
	if ref := s.orgUsable(ctx, link.OrgID, claims.EntVersion); ref != nil {
		return nil, ref
	}
	brains, err := s.orgBrains(ctx, link.OrgID)
	if err != nil {
		return nil, refusal(http.StatusServiceUnavailable, "try again shortly")
	}
	id := &hubapi.Identity{
		UserID: userID, OrgID: link.OrgID, Subject: claims.Subject, Namespaces: brains,
		Write:   claims.Actor != nil || slices.Contains(claims.Scopes(), "brains:write"),
		AgentID: claims.AgentID,
	}
	for a := claims.Actor; a != nil; a = a.Actor {
		id.Actors = append(id.Actors, a.Subject)
	}
	return id, nil
}

// orgUsable is nil when the org's plan is active, else the refusal to send. It fails closed: an org
// whose entitlements the hub cannot confirm (and Zekra holds no usable copy of) is refused.
func (s *Service) orgUsable(ctx context.Context, orgID string, entVersion int64) *hubapi.Refusal {
	set, err := s.Ents.Get(ctx, orgID, entVersion)
	if err != nil {
		if circlexo.IsStatus(err, http.StatusNotFound) {
			return refusal(http.StatusPaymentRequired, "this organization does not have Zekra")
		}
		return refusal(http.StatusServiceUnavailable, "the CircleXO hub could not confirm this organization's plan, try again shortly")
	}
	if !set.Active {
		return refusal(http.StatusPaymentRequired, "this organization's Zekra plan is not active")
	}
	return nil
}

func (s *Service) orgBrains(ctx context.Context, orgID string) ([]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT namespace FROM circlexo_org_brains WHERE org_id = $1 ORDER BY namespace`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var ns string
		if err := rows.Scan(&ns); err != nil {
			return nil, err
		}
		out = append(out, ns)
	}
	return out, rows.Err()
}

// Meter implements hubapi.Hub: one billable `requests` unit for the identity's org, reported
// synchronously before the tool runs so an empty wallet or an exhausted allowance stops it (a 402
// from the hub). The idempotency key is per call, so the SDK's own retries of THIS report are
// free, and a client re-sending the request is a new billable request.
func (s *Service) Meter(ctx context.Context, id *hubapi.Identity) error {
	_, err := s.Usage.Send(ctx, circlexo.UsageReport{OrgID: id.OrgID, Feature: meterRequests, Qty: 1, IdempotencyKey: usage.Key()})
	switch {
	case err == nil:
		return nil
	case circlexo.IsStatus(err, http.StatusPaymentRequired):
		return refusal(http.StatusPaymentRequired, "this organization is out of Zekra requests or balance: top up at the CircleXO hub")
	case circlexo.IsStatus(err, http.StatusNotFound):
		return refusal(http.StatusForbidden, "this organization is not connected to Zekra")
	}
	s.Log.Warn("circlexo: metering a request", "org", id.OrgID, "err", err)
	return refusal(http.StatusServiceUnavailable, "usage could not be recorded, try again")
}

// orgOf is the org a user's new brain is billed to: the ONE active org they belong to. A person in
// no org (or in several: there is no way to tell which one they mean) creates unattributed brains,
// which the hub neither limits nor bills.
func (s *Service) orgOf(ctx context.Context, userID string) (string, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT m.org_id FROM circlexo_org_members m
		JOIN circlexo_org_links l ON l.org_id = m.org_id AND l.status = 'active'
		WHERE m.user_id = $1 LIMIT 2`, userID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var orgs []string
	for rows.Next() {
		var o string
		if err := rows.Scan(&o); err != nil {
			return "", err
		}
		orgs = append(orgs, o)
	}
	if err := rows.Err(); err != nil || len(orgs) != 1 {
		return "", err
	}
	return orgs[0], nil
}

// BeforeNewBrain implements hubapi.Hub: the org's `brains` entitlement (plan limit) applied to the
// user's next brain. Fail closed for an org the hub cannot confirm; while the SDK serves a stale
// copy (hub down, grace window) the org may read but not add.
func (s *Service) BeforeNewBrain(ctx context.Context, userID, namespace string) error {
	org, err := s.orgOf(ctx, userID)
	if err != nil {
		return refusal(http.StatusServiceUnavailable, "try again shortly")
	}
	if org == "" {
		return nil
	}
	set, err := s.Ents.Get(ctx, org, 0)
	if err != nil {
		if circlexo.IsStatus(err, http.StatusNotFound) {
			return refusal(http.StatusPaymentRequired, "your organization does not have Zekra")
		}
		return refusal(http.StatusServiceUnavailable, "the CircleXO hub could not confirm your organization's plan, try again shortly")
	}
	switch {
	case !set.Active:
		return refusal(http.StatusPaymentRequired, "your organization's Zekra plan is not active")
	case set.ReadOnly:
		return refusal(http.StatusServiceUnavailable, "the CircleXO hub is unreachable: your organization can read but not add brains until it is back")
	case !set.Has(featBrains):
		return refusal(http.StatusPaymentRequired, "your organization's plan has no brains: upgrade it at the CircleXO hub")
	}
	if limit, ok := set.Limit(featBrains); ok {
		var n int64
		if err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM circlexo_org_brains WHERE org_id = $1`, org).Scan(&n); err != nil {
			return refusal(http.StatusServiceUnavailable, "try again shortly")
		}
		if n >= limit {
			return refusal(http.StatusPaymentRequired, "your organization has reached its brain limit: upgrade its plan at the CircleXO hub")
		}
	}
	return nil
}

// BrainCreated implements hubapi.Hub: attribute the brain to the user's org.
func (s *Service) BrainCreated(ctx context.Context, userID, namespace string) {
	org, err := s.orgOf(ctx, userID)
	if err != nil || org == "" {
		return
	}
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO circlexo_org_brains (namespace, org_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, namespace, org, userID); err != nil {
		s.Log.Error("circlexo: attributing a brain to its org", "namespace", namespace, "org", org, "err", err)
	}
}

// BrainDeleted implements hubapi.Hub: the brain no longer counts against its org.
func (s *Service) BrainDeleted(ctx context.Context, namespace string) {
	if _, err := s.DB.ExecContext(ctx, `DELETE FROM circlexo_org_brains WHERE namespace = $1`, namespace); err != nil {
		s.Log.Error("circlexo: releasing a deleted brain", "namespace", namespace, "err", err)
	}
}
