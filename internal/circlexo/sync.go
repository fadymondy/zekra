package circlexo

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"

	circlexo "github.com/circlexo/circlexo-go"
)

/*
Org -> brain, and member sync.

Zekra has no organisation or workspace: the unit of sharing is the brain (a namespace), and
brain_members says who may use it (owner | editor | viewer). So a hub org maps to a PRIMARY BRAIN
(circlexo_org_links.primary_namespace, which is the tenant id the hub is told), its people are that
brain's members, and every further brain an org member creates is attributed to the org
(circlexo_org_brains) so the org's `brains` limit can be counted and a hub token for the org can
reach them.

Install (the org.app_installed webhook, or the provision endpoint; both land in Provision) creates
the primary brain or reuses the one already linked, adds the hub's members, and confirms the tenant
to the hub. Nothing here deletes anything: removing the app marks the link inactive, removing a
member removes their membership of the primary brain, and the hub can undo both.

Roles. The hub knows owner, admin, billing and member; a brain has owner, editor and viewer:

	hub owner, hub admin -> owner      hub member -> editor      hub billing -> viewer

applied to the org's primary brain only (the members of the brains they created themselves are
theirs to manage), and the last owner of a brain is never demoted or removed by a sync.
*/

// brainRole is the brain role a hub role asks for.
func brainRole(hubRole string) string {
	switch strings.ToLower(strings.TrimSpace(hubRole)) {
	case "owner", "admin":
		return "owner"
	case "billing":
		return "viewer"
	}
	return "editor"
}

// namespaceRE is the shape of a brain name (plugins/brain: namespaceRE).
var namespaceRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,62}$`)

var nonNamespace = regexp.MustCompile(`[^a-z0-9_.-]+`)

// namespaceFor is the brain name for an org slug (or name).
func namespaceFor(slug string) string {
	ns := strings.Trim(nonNamespace.ReplaceAllString(strings.ToLower(strings.TrimSpace(slug)), "-"), "-_.")
	if len(ns) > 40 {
		ns = strings.Trim(ns[:40], "-_.")
	}
	if !namespaceRE.MatchString(ns) {
		return "org"
	}
	return ns
}

func randomSuffix() string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ProvisionInput is what an install carries. The org's own details and members are read from the
// hub (Client.Org); the event's copies are the fallback.
type ProvisionInput struct {
	OrgID string
	Slug  string
	Name  string
}

// Provision is idempotent: any number of calls for one org leave one link, one primary brain and
// the current members, and always end by confirming the tenant.
func (s *Service) Provision(ctx context.Context, in ProvisionInput) (*OrgLink, error) {
	if in.OrgID == "" {
		return nil, errors.New("circlexo: an org id is required")
	}
	org, err := s.Client.Org(ctx, in.OrgID)
	if err != nil {
		return nil, fmt.Errorf("circlexo: reading the org from the hub: %w", err)
	}
	in.Slug = firstNonEmpty(org.Slug, in.Slug)
	in.Name = firstNonEmpty(org.Name, in.Name)

	link, err := s.OrgByID(ctx, in.OrgID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		owner, err := s.ownerFor(ctx, org.Members)
		if err != nil {
			return nil, err
		}
		if link, err = s.createLinked(ctx, in, owner); err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	case !link.Active || (in.Slug != "" && link.OrgSlug != in.Slug):
		slug := firstNonEmpty(in.Slug, link.OrgSlug)
		if _, err := s.DB.ExecContext(ctx, `UPDATE circlexo_org_links SET status = 'active', org_slug = $2, updated_at = now() WHERE org_id = $1`, in.OrgID, slug); err != nil {
			return nil, err
		}
		link.Active, link.OrgSlug = true, slug
	}

	if err := s.syncMembers(ctx, link, org.Members); err != nil {
		return nil, err
	}
	if _, err := s.Client.ConfirmTenant(ctx, in.OrgID, link.PrimaryNamespace, link.PrimaryNamespace); err != nil {
		return nil, fmt.Errorf("circlexo: confirming the tenant: %w", err)
	}
	s.Ents.Invalidate(in.OrgID, 0)
	return link, nil
}

// Deprovision marks an org's link inactive. The brains, their members and data stay; they just
// stop being governed by the hub. An unknown org is a success (idempotent).
func (s *Service) Deprovision(ctx context.Context, orgID string) error {
	res, err := s.DB.ExecContext(ctx, `UPDATE circlexo_org_links SET status = 'inactive', updated_at = now() WHERE org_id = $1`, orgID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		s.Ents.Invalidate(orgID, 0)
	}
	return nil
}

// ownerFor picks the Zekra user who owns a new org's primary brain: the first hub owner, else the
// first admin, else the first member. A person with no Zekra account yet gets a passwordless one
// (the account they land in when they sign in with CircleXO).
func (s *Service) ownerFor(ctx context.Context, members []circlexo.Member) (string, error) {
	pick := func(role string) *circlexo.Member {
		for i := range members {
			if strings.EqualFold(members[i].Role, role) {
				return &members[i]
			}
		}
		return nil
	}
	m := pick("owner")
	if m == nil {
		m = pick("admin")
	}
	if m == nil && len(members) > 0 {
		m = &members[0]
	}
	if m == nil {
		return "", errors.New("circlexo: the org has no members to own its brain")
	}
	id, ok, err := s.resolveMember(ctx, *m, true)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", errors.New("circlexo: the owner's Zekra account cannot be used automatically (unconfirmed address with a password)")
	}
	return id, nil
}

const brainExistsSQL = `
	SELECT EXISTS (SELECT 1 FROM brain_members WHERE namespace = $1)
	    OR EXISTS (SELECT 1 FROM memories WHERE namespace = $1 AND invalid_at IS NULL)
	    OR EXISTS (SELECT 1 FROM notes WHERE namespace = $1)`

// createLinked makes the org's primary brain and its link in one transaction, under an advisory lock
// on the org, so two concurrent installs of one org cannot make two brains.
func (s *Service) createLinked(ctx context.Context, in ProvisionInput, ownerID string) (*OrgLink, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "circlexo:org:"+in.OrgID); err != nil {
		return nil, err
	}
	var existing string
	err = tx.QueryRowContext(ctx, `SELECT org_id FROM circlexo_org_links WHERE org_id = $1`, in.OrgID).Scan(&existing)
	if err == nil {
		_ = tx.Rollback()
		return s.OrgByID(ctx, in.OrgID) // another request won: reuse its brain
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	// Brain names are global. The advisory lock above is per org, so serialise the name check on a
	// global key too: two orgs with the same slug must not both take it.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('circlexo:namespaces'))`); err != nil {
		return nil, err
	}
	base := namespaceFor(firstNonEmpty(in.Slug, in.Name))
	ns := base
	for i := 0; ; i++ {
		var taken bool
		if err := tx.QueryRowContext(ctx, brainExistsSQL, ns).Scan(&taken); err != nil {
			return nil, err
		}
		if !taken {
			break
		}
		if i > 20 {
			return nil, errors.New("circlexo: no free brain name for the org")
		}
		ns = strings.Trim(base[:min(len(base), 50)], "-_.") + "-" + randomSuffix()
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO brain_members (namespace, user_id, role, created_by) VALUES ($1, $2, 'owner', 'circlexo')`, ns, ownerID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO circlexo_org_brains (namespace, org_id, created_by) VALUES ($1, $2, $3)`, ns, in.OrgID, ownerID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO circlexo_org_links (org_id, org_slug, primary_namespace, status) VALUES ($1, $2, $3, 'active')`, in.OrgID, in.Slug, ns); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO circlexo_org_members (org_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, in.OrgID, ownerID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.OrgByID(ctx, in.OrgID)
}

// resolveMember finds the Zekra user for a hub member: by the CircleXO link, else by e-mail (see
// userByEmail for when an address alone is enough), else, with create, a new passwordless account.
// ok is false when the member cannot be placed automatically; they are picked up when they sign in
// with CircleXO. Resolving by e-mail does NOT create the link: that needs the person to prove the
// address by signing in.
func (s *Service) resolveMember(ctx context.Context, m circlexo.Member, create bool) (userID string, ok bool, err error) {
	if m.UserID != "" {
		id, err := s.UserBySubject(ctx, m.UserID)
		if err == nil {
			return id, true, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", false, err
		}
	}
	email := norm(m.Email)
	if email == "" {
		return "", false, nil
	}
	id, usable, err := s.userByEmail(ctx, email)
	switch {
	case err == nil:
		return id, usable, nil
	case !errors.Is(err, sql.ErrNoRows):
		return "", false, err
	case !create:
		return "", false, nil
	}
	ident, err := s.Acct.Auth.FindOrCreateByEmail(ctx, email)
	if err != nil {
		return "", false, err
	}
	return ident.ID, true, nil
}

// syncMembers adds every hub member the integration can place and applies the role mapping. It
// never removes anyone (a member added in Zekra alone stays); removal is member.removed.
func (s *Service) syncMembers(ctx context.Context, link *OrgLink, members []circlexo.Member) error {
	var first error
	for _, m := range members {
		id, ok, err := s.resolveMember(ctx, m, true)
		if err == nil && ok {
			err = s.setMember(ctx, link, id, m.Role)
		}
		if err != nil {
			s.Log.Error("circlexo: member sync", "org", link.OrgID, "err", err)
			if first == nil {
				first = err
			}
		}
	}
	return first
}

// setMember makes userID a member of the org with the hub role, and of the org's primary brain with
// the role that maps to, never demoting the brain's last owner.
func (s *Service) setMember(ctx context.Context, link *OrgLink, userID, hubRole string) error {
	target := brainRole(hubRole)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "circlexo:members:"+link.PrimaryNamespace); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO circlexo_org_members (org_id, user_id, role) VALUES ($1, $2, $3)
		ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`, link.OrgID, userID, strings.ToLower(hubRole)); err != nil {
		return err
	}
	var cur string
	err = tx.QueryRowContext(ctx, `SELECT role FROM brain_members WHERE namespace = $1 AND user_id = $2`, link.PrimaryNamespace, userID).Scan(&cur)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if cur == "owner" && target != "owner" {
		var others int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM brain_members WHERE namespace = $1 AND role = 'owner' AND user_id <> $2`, link.PrimaryNamespace, userID).Scan(&others); err != nil {
			return err
		}
		if others == 0 {
			target = "owner" // never leave a brain without an owner
		}
	}
	if cur != target {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO brain_members (namespace, user_id, role, created_by) VALUES ($1, $2, $3, 'circlexo')
			ON CONFLICT (namespace, user_id) DO UPDATE SET role = EXCLUDED.role`, link.PrimaryNamespace, userID, target); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// removeMember drops a hub member from the org and from its primary brain (their data stays), except
// the brain's last owner, who keeps the brain (an org with no owner is worse than a stale one).
func (s *Service) removeMember(ctx context.Context, link *OrgLink, userID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "circlexo:members:"+link.PrimaryNamespace); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM circlexo_org_members WHERE org_id = $1 AND user_id = $2`, link.OrgID, userID); err != nil {
		return err
	}
	var role string
	err = tx.QueryRowContext(ctx, `SELECT role FROM brain_members WHERE namespace = $1 AND user_id = $2`, link.PrimaryNamespace, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return tx.Commit()
	}
	if err != nil {
		return err
	}
	if role == "owner" {
		var others int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM brain_members WHERE namespace = $1 AND role = 'owner' AND user_id <> $2`, link.PrimaryNamespace, userID).Scan(&others); err != nil {
			return err
		}
		if others == 0 {
			s.Log.Warn("circlexo: not removing the last owner of an org's brain", "org", link.OrgID)
			return tx.Commit()
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM brain_members WHERE namespace = $1 AND user_id = $2`, link.PrimaryNamespace, userID); err != nil {
		return err
	}
	return tx.Commit()
}
