package account

import (
	"context"
	"strings"

	"github.com/togo-framework/togo"
)

// UserDataPurger is what the brain plugin's service (published on the kernel
// as "brain") offers for account deletion. Structural: the brain plugin does
// not import this package, nor this package the plugin's internals.
type UserDataPurger interface {
	// RevokeUserDevices drops push tokens, camera pairings and MCP connections
	// as soon as a deletion is scheduled.
	RevokeUserDevices(ctx context.Context, userID string) map[string]int
	// PurgeUserData deletes the brains the account owns alone (with their
	// notes, memories, files and presentations), leaves shared brains, and
	// deletes the account's push tokens, notifications and MCP grants.
	PurgeUserData(ctx context.Context, userID string) (map[string]int, error)
}

// brainServiceKey is the kernel key the brain plugin publishes its service under.
const brainServiceKey = "brain"

// kernelUserData resolves the brain plugin lazily, so plugin boot order never matters.
func kernelUserData(k *togo.Kernel) func() UserDataPurger {
	return func() UserDataPurger {
		if k == nil {
			return nil
		}
		v, ok := k.Get(brainServiceKey)
		if !ok {
			return nil
		}
		p, _ := v.(UserDataPurger)
		return p
	}
}

func (s *Service) userData() UserDataPurger {
	if s.UserData == nil {
		return nil
	}
	return s.UserData()
}

// purgeAvatar deletes the account's uploaded profile photo, if any.
func (s *Service) purgeAvatar(ctx context.Context, userID string) int {
	if s.Blobs == nil || !s.tableExists(ctx, "account_profiles") {
		return 0
	}
	var u string
	_ = s.DB.QueryRowContext(ctx, `SELECT COALESCE(avatar,'') FROM account_profiles WHERE user_id = $1`, userID).Scan(&u)
	key := avatarKey(u)
	if key == "" || !strings.HasPrefix(key, "avatars/"+userID+"/") {
		return 0
	}
	if err := s.Blobs.Delete(key); err != nil {
		return 0
	}
	return 1
}
