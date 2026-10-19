package brain

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
)

/*
What a deleted account leaves behind in the brain plugin (App Store 5.1.1(v),
Google Play account deletion). The account service (internal/account) calls
these through the kernel service published under Name ("brain"), structurally,
so neither module imports the other.

  - RevokeUserDevices runs when a deletion is SCHEDULED: push tokens, camera
    pairings and MCP connections are credentials, so they go at once and no push
    reaches an account that asked to be deleted.
  - PurgeUserData runs when the grace period ends:
      1. Every brain where the account is the ONLY owner is deleted with all it
         holds: memories, graph, gaps, events, notes and their versions, media
         and note images (rows and stored files), presentations and their share
         links and domains, secrets, data sources, ACL grants, profile and
         memberships.
      2. In brains that someone else also owns, the account's membership is
         removed and its id is cleared from what it wrote there (the content
         stays with the brain, which is no longer the account's alone).
      3. Per-account rows: push tokens, notifications, MCP OAuth grants, tokens
         and codes, camera pairings.

Tables that do not exist (an older schema, a test database) are skipped.
*/

// purgeBrainTables are deleted by namespace, children before parents. Constant
// identifiers, never input.
var purgeBrainTables = []string{
	"memories", "memory_gaps", "memory_events", "memory_conflicts",
	"entity_edges", "entities", "entity_types", "edge_types", "communities", "episodes",
	"namespace_grants", "secrets", "datasources",
	"notes",                        // note_versions cascade
	"brain_media", "presentations", // presentation_shares cascade
	"presentation_domains", "note_github_sync", "brain_camera_pass",
	"mcp_oauth_grant_namespaces", "brain_profiles", "brain_members",
}

// blobPrefixes are the storage folders a brain's files live under
// (media.go, note_images.go, profile.go), each followed by safeSegment(ns).
var blobPrefixes = []string{"media/", "notes/", "brains/"}

// RevokeUserDevices removes the credentials a scheduled deletion must stop at
// once. It returns the number of rows removed per table.
func (s *Service) RevokeUserDevices(ctx context.Context, userID string) map[string]int {
	out := map[string]int{}
	if userID == "" {
		return out
	}
	db, err := s.Store.db(ctx)
	if err != nil {
		return out
	}
	for _, t := range []string{"device_tokens", "brain_camera_pass", "mcp_oauth_grants", "mcp_oauth_codes"} {
		if !tableExists(ctx, db, t) {
			continue
		}
		res, err := db.ExecContext(ctx, "DELETE FROM "+t+" WHERE user_id = $1", userID) //#nosec G202 -- constant table names
		if err != nil {
			s.warn("account deletion: could not revoke", "table", t, "err", err)
			continue
		}
		n, _ := res.RowsAffected()
		out[t] = int(n)
	}
	return out
}

// PurgeUserData deletes or detaches everything the brain plugin holds for
// userID. See the comment at the top of this file.
func (s *Service) PurgeUserData(ctx context.Context, userID string) (map[string]int, error) {
	out := map[string]int{}
	if userID == "" {
		return out, fmt.Errorf("purge: empty user id")
	}
	db, err := s.Store.db(ctx)
	if err != nil {
		return out, err
	}
	if !tableExists(ctx, db, "brain_members") {
		for k, v := range s.RevokeUserDevices(ctx, userID) {
			out[k] = v
		}
		return out, nil
	}

	// 1. Brains the account owns alone.
	owned, err := soleOwnedBrains(ctx, db, userID)
	if err != nil {
		return out, fmt.Errorf("purge: list owned brains: %w", err)
	}
	for _, ns := range owned {
		if err := s.purgeBrain(ctx, db, ns, out); err != nil {
			return out, fmt.Errorf("purge brain %s: %w", ns, err)
		}
		out["brains_deleted"]++
	}

	// 2. Shared brains: leave, and clear the account's id from what stays.
	uid, agent := userID, "user:"+userID
	detach := []struct{ table, set, where string }{
		{"notes", "owner_user_id = NULL", "owner_user_id = $1"},
		{"note_versions", "author_user_id = NULL", "author_user_id = $1"},
		{"note_versions", "author_agent = NULL", "author_agent = $2"},
		{"brain_media", "owner_user_id = NULL", "owner_user_id = $1"},
		{"presentations", "owner_user_id = NULL", "owner_user_id = $1"},
		{"presentations", "created_by = ''", "created_by IN ($1, $2)"},
		{"presentation_shares", "created_by = ''", "created_by IN ($1, $2)"},
		{"presentation_domains", "created_by = ''", "created_by IN ($1, $2)"},
		{"secrets", "created_by = NULL", "created_by IN ($1, $2)"},
		{"brain_profiles", "updated_by = NULL", "updated_by IN ($1, $2)"},
		{"note_github_sync", "updated_by = NULL", "updated_by IN ($1, $2)"},
		{"brain_members", "created_by = NULL", "created_by IN ($1, $2)"},
		{"memories", "owner_agent_id = NULL", "owner_agent_id = $2"},
		{"memory_events", "agent_id = NULL", "agent_id = $2"},
	}
	for _, d := range detach {
		if !tableExists(ctx, db, d.table) || !columnExists(ctx, db, d.table, strings.Fields(d.set)[0]) {
			continue
		}
		q := "UPDATE " + d.table + " SET " + d.set + " WHERE " + d.where //#nosec G202 -- constant identifiers
		args := []any{uid, agent}
		if !strings.Contains(d.where, "$2") {
			args = args[:1]
		} else if !strings.Contains(d.where, "$1") {
			q = strings.ReplaceAll(q, "$2", "$1")
			args = []any{agent}
		}
		res, err := db.ExecContext(ctx, q, args...)
		if err != nil {
			return out, fmt.Errorf("purge: detach %s: %w", d.table, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			out["detached_"+d.table] += int(n)
		}
	}
	res, err := db.ExecContext(ctx, `DELETE FROM brain_members WHERE user_id = $1`, userID)
	if err != nil {
		return out, fmt.Errorf("purge: memberships: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		out["memberships_left"] = int(n)
	}

	// 3. Per-account rows.
	for k, v := range s.RevokeUserDevices(ctx, userID) {
		out[k] += v
	}
	if tableExists(ctx, db, "brain_notifications") {
		res, err := db.ExecContext(ctx, `DELETE FROM brain_notifications WHERE user_id = $1`, userID)
		if err != nil {
			return out, fmt.Errorf("purge: notifications: %w", err)
		}
		n, _ := res.RowsAffected()
		out["brain_notifications"] = int(n)
	}
	return out, nil
}

// soleOwnedBrains lists the brains where userID is an owner and nobody else is.
func soleOwnedBrains(ctx context.Context, db *sql.DB, userID string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT m.namespace FROM brain_members m
		 WHERE m.user_id = $1 AND m.role = 'owner'
		   AND NOT EXISTS (SELECT 1 FROM brain_members o
		                    WHERE o.namespace = m.namespace AND o.user_id <> $1 AND o.role = 'owner')
		 ORDER BY m.namespace`, userID)
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

// purgeBrain deletes one brain: its rows in one transaction, then its files.
func (s *Service) purgeBrain(ctx context.Context, db *sql.DB, ns string, out map[string]int) error {
	if ns == "" {
		return ErrInvalidInput
	}
	// Files known by row, read before the rows go.
	var keys []string
	if tableExists(ctx, db, "brain_media") {
		rows, err := db.QueryContext(ctx, `SELECT DISTINCT blob_key FROM brain_media WHERE namespace = $1 AND blob_key <> ''`, ns)
		if err != nil {
			return err
		}
		for rows.Next() {
			var k string
			if rows.Scan(&k) == nil {
				keys = append(keys, k)
			}
		}
		rows.Close()
	}
	if tableExists(ctx, db, "brain_profiles") {
		var img, cover string
		_ = db.QueryRowContext(ctx, `SELECT image_key, cover_key FROM brain_profiles WHERE namespace = $1`, ns).Scan(&img, &cover)
		keys = append(keys, nonEmpty(img, cover)...)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, t := range purgeBrainTables {
		if !tableExists(ctx, db, t) {
			continue
		}
		res, err := tx.ExecContext(ctx, "DELETE FROM "+t+" WHERE namespace = $1", ns) //#nosec G202 -- constant table names
		if err != nil {
			return fmt.Errorf("%s: %w", t, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			out[t] += int(n)
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	// Files: by key (any storage driver), then the brain's folders when the
	// storage is a local directory (note images are not tracked by row).
	blobs := s.blobs()
	for _, k := range keys {
		// A file can be shared by content digest only within this brain's folder,
		// so nothing outside the deleted brain is touched.
		if err := blobs.Delete(k); err == nil {
			out["files_deleted"]++
		}
	}
	if seg := safeSegment(ns); seg != "" && seg != "." && !strings.ContainsAny(seg, `/\`) {
		for _, prefix := range blobPrefixes {
			dir := blobs.Path(prefix + seg)
			if dir == "" {
				continue
			}
			if st, err := os.Stat(dir); err == nil && st.IsDir() {
				if err := os.RemoveAll(dir); err == nil {
					out["folders_deleted"]++
				}
			}
		}
	}

	s.Store.bumpEpoch(ns)
	s.brainDeleted(ctx, ns)
	if s.hub != nil {
		s.hub.publish("brain", map[string]any{"deleted": ns, "namespace": ns})
	}
	return nil
}

func tableExists(ctx context.Context, db *sql.DB, table string) bool {
	var ok bool
	_ = db.QueryRowContext(ctx, `SELECT to_regclass($1) IS NOT NULL`, table).Scan(&ok)
	return ok
}

func columnExists(ctx context.Context, db *sql.DB, table, column string) bool {
	var ok bool
	_ = db.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM pg_attribute
		                WHERE attrelid = to_regclass($1) AND attname = $2 AND NOT attisdropped)`, table, column).Scan(&ok)
	return ok
}

func (s *Service) warn(msg string, args ...any) {
	if s.k != nil && s.k.Log != nil {
		s.k.Log.Warn(msg, args...)
	}
}
