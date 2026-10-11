package brain

/*
Hardening for open Dynamic Client Registration (/api/oauth/register).

Registration stays open and unauthenticated — the MCP authorization spec expects
it, and Claude Code, Cursor and other local clients register on first connect —
so the defences sit around it:

  - rate limits: per address (ZEKRA_OAUTH_REGISTER_PER_IP, default 10/hour) and
    for the whole server (ZEKRA_OAUTH_REGISTER_GLOBAL, default 300/hour), both
    answered with 429 + Retry-After;
  - strict redirect URIs: https with a plain DNS or IP host, or http on a
    loopback host (any port, RFC 8252); never a fragment, userinfo, wildcard,
    whitespace/control character, or any other scheme (javascript:, data:, …);
  - a bounded, printable client_name (it is shown on the consent screen, so
    bidi overrides and other invisible formatting characters are refused);
  - pruning: a registered client that never completed a token exchange (it has
    no grant) is deleted once it is older than ZEKRA_OAUTH_CLIENT_PRUNE_DAYS
    (default 30; 0 disables). Metadata-document clients are not touched.
*/

import (
	"context"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	maxRedirectURIs     = 10
	maxRedirectURILen   = 2000
	maxClientNameRunes  = 120
	newClientWindow     = 24 * time.Hour
	clientPruneInterval = time.Hour
)

func envInt(key string, def int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return def
}

// redirectURIProblem returns why raw cannot be registered as a redirect URI, or
// "" when it can.
func redirectURIProblem(raw string) string {
	if raw == "" || len(raw) > maxRedirectURILen {
		return "redirect URIs must be 1-2000 characters"
	}
	for _, r := range raw {
		if r <= 0x20 || r == 0x7f || r == '\\' {
			return "redirect URIs must not contain whitespace, control characters or backslashes"
		}
		if r == '*' {
			return "redirect URIs must not contain wildcards"
		}
	}
	if strings.Contains(raw, "#") {
		return "redirect URIs must not contain a fragment"
	}
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() || u.Opaque != "" || u.Host == "" {
		return "redirect URIs must be absolute https URLs, or http on localhost"
	}
	if u.User != nil {
		return "redirect URIs must not contain credentials"
	}
	host := u.Hostname()
	switch u.Scheme {
	case "https":
		if !validRedirectHost(host) {
			return "redirect URI host is not a valid hostname"
		}
	case "http":
		if !isLoopbackHost(host) {
			return "http redirect URIs are only allowed on localhost, 127.0.0.1 or [::1]"
		}
	default:
		return "redirect URIs must be https, or http on localhost"
	}
	if p := u.Port(); p != "" {
		if n, err := strconv.Atoi(p); err != nil || n < 1 || n > 65535 {
			return "redirect URI port is out of range"
		}
	}
	return ""
}

func isLoopbackHost(h string) bool { return h == "localhost" || h == "127.0.0.1" || h == "::1" }

// validRedirectHost accepts an IP literal or an LDH (letters, digits, hyphen)
// DNS name — no percent-encoding, underscores, wildcards or empty labels.
func validRedirectHost(h string) bool {
	if h == "" || len(h) > 253 {
		return false
	}
	if net.ParseIP(h) != nil {
		return true
	}
	for _, label := range strings.Split(strings.TrimSuffix(h, "."), ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return true
}

// clientNameProblem returns why a client_name cannot be registered, or "".
func clientNameProblem(name string) string {
	if len([]rune(name)) > maxClientNameRunes {
		return "client_name must be at most 120 characters"
	}
	for _, r := range name {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return "client_name must not contain control or formatting characters"
		}
	}
	return ""
}

// registerLimits enforces the per-address and server-wide registration caps.
type registerLimits struct {
	perIP  *ipLimiter
	global *ipLimiter
}

func newRegisterLimits() *registerLimits {
	return &registerLimits{
		perIP:  newIPLimiter(envInt("ZEKRA_OAUTH_REGISTER_PER_IP", 10), time.Hour),
		global: newIPLimiter(envInt("ZEKRA_OAUTH_REGISTER_GLOBAL", 300), time.Hour),
	}
}

// take spends one registration for ip. When refused it says how long until the
// window that refused it resets. The per-address limit is checked first, so a
// single noisy address cannot spend the global budget beyond its own share.
func (l *registerLimits) take(ip string, now time.Time) (bool, time.Duration) {
	if ok, wait := l.perIP.take(ip, now); !ok {
		return false, wait
	}
	return l.global.take("*", now)
}

// retryAfterSeconds renders a wait as a Retry-After delta-seconds value (>= 1).
func retryAfterSeconds(wait time.Duration) string {
	s := int((wait + time.Second - 1) / time.Second)
	if s < 1 {
		s = 1
	}
	return strconv.Itoa(s)
}

// clientPruner deletes stale, never-used dynamically registered clients, at
// most once per clientPruneInterval.
type clientPruner struct {
	mu   sync.Mutex
	last time.Time
}

func (s *oauthServer) maybePruneClients(now time.Time) {
	days := envInt("ZEKRA_OAUTH_CLIENT_PRUNE_DAYS", 30)
	if days == 0 || s.svc == nil {
		return
	}
	s.pruner.mu.Lock()
	if !s.pruner.last.IsZero() && now.Sub(s.pruner.last) < clientPruneInterval {
		s.pruner.mu.Unlock()
		return
	}
	s.pruner.last = now
	s.pruner.mu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		n, err := s.pruneStaleClients(ctx, now.Add(-time.Duration(days)*24*time.Hour))
		if err != nil {
			s.warn("oauth client prune failed", "error", err.Error())
		} else if n > 0 {
			s.warn("oauth stale clients pruned", "count", n)
		}
	}()
}

// pruneStaleClients deletes dynamically registered clients created before
// cutoff that never completed a token exchange (no grant was ever issued).
// Their pending codes go with them (ON DELETE CASCADE).
func (s *oauthServer) pruneStaleClients(ctx context.Context, cutoff time.Time) (int64, error) {
	db, err := s.db(ctx)
	if err != nil {
		return 0, err
	}
	res, err := db.ExecContext(ctx, `
		DELETE FROM mcp_oauth_clients c
		WHERE c.id LIKE $1 AND c.created_at < $2
		  AND NOT EXISTS (SELECT 1 FROM mcp_oauth_grants g WHERE g.client_id = c.id)`,
		strings.ReplaceAll(clientPrefix, "_", `\_`)+"%", cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
