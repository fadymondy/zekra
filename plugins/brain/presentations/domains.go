package presentations

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"net"
	"net/url"
	"os"
	"strings"
	"time"
)

/*
Custom share domains.

A brain can link its own domain or subdomain (deck.acme.com) so its share links
read https://deck.acme.com/{locale}/p/{token} instead of the built-in origin.

  - A host is claimed by adding it, then proven by two DNS facts: a TXT record at
    _zekra-verify.<host> holding the row's verify token (ownership), and the host
    itself reaching this server (a CNAME to PRESENTATIONS_DOMAIN_TARGET, or the
    same A/AAAA addresses as that target).
  - A VERIFIED host belongs to exactly one brain (partial unique index). Unverified
    claims do not block anyone: only the brain that can publish the TXT wins.
  - A request that arrives on a custom host only opens tokens of the brain that
    owns the host (resolve); the built-in host opens any token. So a brand's
    domain can never serve another brain's document.
  - Deleting a domain keeps its links: their URL falls back to the brain's default
    verified domain, else the built-in base.
*/

// DefaultDomainTarget is what a custom host must point at.
const DefaultDomainTarget = "domains.zekra.dev"

// VerifyPrefix is the TXT label a host's ownership record lives under.
const VerifyPrefix = "_zekra-verify."

// ErrDomainTaken: the host is verified for another brain.
var ErrDomainTaken = errors.New("this domain is already linked to another brain")

// DomainTarget is the CNAME target: PRESENTATIONS_DOMAIN_TARGET, else DefaultDomainTarget.
func DomainTarget() string {
	if v := strings.ToLower(strings.Trim(strings.TrimSpace(os.Getenv("PRESENTATIONS_DOMAIN_TARGET")), ".")); v != "" {
		return v
	}
	return DefaultDomainTarget
}

// Resolver is the DNS the verification needs; *net.Resolver satisfies it.
type Resolver interface {
	LookupTXT(ctx context.Context, name string) ([]string, error)
	LookupCNAME(ctx context.Context, host string) (string, error)
	LookupHost(ctx context.Context, host string) ([]string, error)
}

// Domain is one linked host, as the brain's members see it.
type Domain struct {
	ID           string       `json:"id"`
	Namespace    string       `json:"namespace"`
	Host         string       `json:"host"`
	Verified     bool         `json:"verified"`
	Default      bool         `json:"default"`
	VerifyRecord DomainRecord `json:"verifyRecord"`
	CNAME        DomainCNAME  `json:"cname"`
	LastError    string       `json:"lastError"`
	VerifiedAt   *time.Time   `json:"verifiedAt"`
	LastChecked  *time.Time   `json:"lastCheckedAt"`
	CreatedAt    time.Time    `json:"createdAt"`
}

// DomainRecord is the TXT record to publish.
type DomainRecord struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

// DomainCNAME is the routing record to publish.
type DomainCNAME struct {
	Name   string `json:"name"`
	Target string `json:"target"`
}

// BuiltinHost is the host of the built-in share origin.
func BuiltinHost() string { return hostOfURL(BaseURL()) }

func hostOfURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// CleanRequestHost lowercases a Host / X-Forwarded-Host value and drops the
// port, a trailing dot and any further comma-separated hops.
func CleanRequestHost(raw string) string {
	h := strings.ToLower(strings.TrimSpace(strings.Split(raw, ",")[0]))
	if strings.HasPrefix(h, "[") { // [::1]:8080
		if i := strings.Index(h, "]"); i > 0 {
			return h[1:i]
		}
	}
	if i := strings.LastIndex(h, ":"); i >= 0 && strings.Count(h, ":") == 1 {
		h = h[:i]
	}
	return strings.TrimSuffix(h, ".")
}

// IsBuiltinHost reports whether a (cleaned) request host is one of ours, where
// any token opens: "", localhost, IP literals, zekra.dev and its subdomains, the
// hosts of PRESENTATIONS_SHARE_BASE / AUTH_PUBLIC_URL / API_ORIGIN, and
// the comma-separated PRESENTATIONS_BUILTIN_HOSTS.
func IsBuiltinHost(host string) bool {
	if host == "" || host == "localhost" || net.ParseIP(host) != nil || !strings.Contains(host, ".") {
		return true
	}
	if host == "zekra.dev" || strings.HasSuffix(host, ".zekra.dev") || host == hostOfURL(DefaultShareBase) {
		return true
	}
	for _, k := range []string{"PRESENTATIONS_SHARE_BASE", "AUTH_PUBLIC_URL", "API_ORIGIN"} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" && hostOfURL(v) == host {
			return true
		}
	}
	for _, h := range strings.Split(os.Getenv("PRESENTATIONS_BUILTIN_HOSTS"), ",") {
		if CleanRequestHost(h) == host {
			return true
		}
	}
	return false
}

// NormalizeHost validates a hostname a brain wants to link and returns it
// lowercase. No scheme, path, port, wildcard or IP; at least two labels;
// letters, digits and hyphens (punycode xn-- labels are fine); at most 253
// characters; never zekra.dev, one of its subdomains, or a built-in host.
func NormalizeHost(raw string) (string, error) {
	h := strings.ToLower(strings.TrimSpace(raw))
	h = strings.TrimSuffix(h, ".")
	switch {
	case h == "":
		return "", InvalidError{"host is required, e.g. deck.example.com"}
	case strings.Contains(h, "://"):
		return "", InvalidError{"host must be a bare hostname, without http:// or https://"}
	case strings.ContainsAny(h, "/?#@\\"):
		return "", InvalidError{"host must be a bare hostname, without a path"}
	case strings.Contains(h, ":"):
		return "", InvalidError{"host must be a bare hostname, without a port"}
	case len(h) > 253:
		return "", InvalidError{"host is at most 253 characters"}
	case net.ParseIP(h) != nil:
		return "", InvalidError{"host must be a domain name, not an IP address"}
	}
	labels := strings.Split(h, ".")
	if len(labels) < 2 {
		return "", InvalidError{"host must be a full domain name, e.g. deck.example.com"}
	}
	for _, l := range labels {
		if l == "" || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' {
			return "", InvalidError{"host is not a valid domain name (use the punycode xn-- form for non-ASCII names)"}
		}
		for _, c := range l {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return "", InvalidError{"host is not a valid domain name (use the punycode xn-- form for non-ASCII names)"}
			}
		}
	}
	tld := labels[len(labels)-1]
	if strings.Trim(tld, "0123456789") == "" {
		return "", InvalidError{"host must be a domain name, not an IP address"}
	}
	if tld == "localhost" || tld == "local" || tld == "internal" || IsBuiltinHost(h) || h == DomainTarget() {
		return "", InvalidError{"this host is reserved; link your own domain or subdomain"}
	}
	return h, nil
}

func (s *Store) resolver() Resolver {
	if s.Resolver != nil {
		return s.Resolver
	}
	return net.DefaultResolver
}

const domainCols = `id, namespace, host, verify_token, verified_at, is_default, created_at, last_checked_at, last_error`

type rowScanner interface{ Scan(...any) error }

func scanDomain(r rowScanner) (*Domain, error) {
	var d Domain
	var token string
	var verified, checked sql.NullTime
	if err := r.Scan(&d.ID, &d.Namespace, &d.Host, &token, &verified, &d.Default, &d.CreatedAt, &checked, &d.LastError); err != nil {
		return nil, err
	}
	if verified.Valid {
		d.Verified, d.VerifiedAt = true, &verified.Time
	}
	if checked.Valid {
		d.LastChecked = &checked.Time
	}
	d.VerifyRecord = DomainRecord{Type: "TXT", Name: VerifyPrefix + d.Host, Value: token}
	d.CNAME = DomainCNAME{Name: d.Host, Target: DomainTarget()}
	return &d, nil
}

// ListDomains lists a brain's linked hosts, default first, then oldest first.
func (s *Store) ListDomains(ctx context.Context, namespace string) ([]Domain, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := d.QueryContext(ctx, `SELECT `+domainCols+` FROM presentation_domains
		WHERE namespace = $1 ORDER BY is_default DESC, created_at, id`, namespace)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Domain{}
	for rows.Next() {
		dom, err := scanDomain(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *dom)
	}
	return out, rows.Err()
}

// GetDomain loads one linked host by id.
func (s *Store) GetDomain(ctx context.Context, id string) (*Domain, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	dom, err := scanDomain(d.QueryRowContext(ctx, `SELECT `+domainCols+` FROM presentation_domains WHERE id = $1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return dom, err
}

// AddDomain claims a host for a brain (unverified). Adding the same host to the
// same brain again returns the existing row, so the TXT value stays stable.
func (s *Store) AddDomain(ctx context.Context, namespace, rawHost, by string) (*Domain, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(namespace) == "" {
		return nil, InvalidError{"namespace is required"}
	}
	host, err := NormalizeHost(rawHost)
	if err != nil {
		return nil, err
	}
	var owner string
	err = d.QueryRowContext(ctx, `SELECT namespace FROM presentation_domains WHERE host = $1 AND verified_at IS NOT NULL`, host).Scan(&owner)
	if err == nil && owner != namespace {
		return nil, ErrDomainTaken
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	id := newID()
	if _, err := d.ExecContext(ctx, `INSERT INTO presentation_domains (id, namespace, host, verify_token, created_by)
		VALUES ($1,$2,$3,$4,$5) ON CONFLICT (namespace, host) DO NOTHING`,
		id, namespace, host, "zekra-verify="+hex.EncodeToString(b), by); err != nil {
		return nil, err
	}
	dom, err := scanDomain(d.QueryRowContext(ctx, `SELECT `+domainCols+` FROM presentation_domains WHERE namespace = $1 AND host = $2`, namespace, host))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return dom, err
}

func cleanName(s string) string {
	return strings.ToLower(strings.TrimSuffix(strings.TrimSpace(s), "."))
}

func notFoundDNS(err error) bool {
	var de *net.DNSError
	return errors.As(err, &de) && de.IsNotFound
}

// checkDNS returns "" when both records are right, else what is wrong. transient
// is true when DNS itself failed (timeouts, SERVFAIL): nothing was disproved.
func (s *Store) checkDNS(ctx context.Context, dom *Domain) (problem string, transient bool) {
	res := s.resolver()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	txts, err := res.LookupTXT(ctx, dom.VerifyRecord.Name)
	if err != nil && !notFoundDNS(err) {
		return "DNS lookup of the TXT record failed; try again shortly", true
	}
	found := false
	for _, t := range txts {
		if strings.TrimSpace(strings.Trim(strings.TrimSpace(t), `"`)) == dom.VerifyRecord.Value {
			found = true
		}
	}
	if !found {
		if len(txts) == 0 {
			return "no TXT record found at " + dom.VerifyRecord.Name, false
		}
		return "the TXT record at " + dom.VerifyRecord.Name + " does not hold the expected value", false
	}

	target := DomainTarget()
	cname, cerr := res.LookupCNAME(ctx, dom.Host)
	if cerr == nil && cleanName(cname) == target {
		return "", false
	}
	hostIPs, herr := res.LookupHost(ctx, dom.Host)
	if herr != nil && !notFoundDNS(herr) {
		return "DNS lookup of " + dom.Host + " failed; try again shortly", true
	}
	targetIPs, terr := res.LookupHost(ctx, target)
	if terr != nil {
		return "DNS lookup of " + target + " failed; try again shortly", true
	}
	want := map[string]bool{}
	for _, ip := range targetIPs {
		want[ip] = true
	}
	for _, ip := range hostIPs {
		if want[ip] {
			return "", false
		}
	}
	if c := cleanName(cname); cerr == nil && c != "" && c != dom.Host {
		return dom.Host + " is a CNAME to " + c + "; it must point to " + target, false
	}
	return dom.Host + " does not point to " + target + " (add a CNAME record)", false
}

// VerifyDomain runs the DNS checks and stores verified_at or last_error. A
// verified host that no longer passes is unverified (its links fall back to
// the default base), unless DNS itself failed.
func (s *Store) VerifyDomain(ctx context.Context, id string) (*Domain, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	dom, err := s.GetDomain(ctx, id)
	if err != nil {
		return nil, err
	}
	problem, transient := s.checkDNS(ctx, dom)
	switch {
	case problem == "":
		_, err = d.ExecContext(ctx, `UPDATE presentation_domains SET verified_at = COALESCE(verified_at, now()),
			last_checked_at = now(), last_error = '' WHERE id = $1`, id)
		if err != nil && strings.Contains(err.Error(), "presentation_domains_verified_host_key") {
			problem = ErrDomainTaken.Error()
			_, err = d.ExecContext(ctx, `UPDATE presentation_domains SET last_checked_at = now(), last_error = $2 WHERE id = $1`, id, problem)
		}
	case transient:
		_, err = d.ExecContext(ctx, `UPDATE presentation_domains SET last_checked_at = now(), last_error = $2 WHERE id = $1`, id, problem)
	default:
		_, err = d.ExecContext(ctx, `UPDATE presentation_domains SET verified_at = NULL, is_default = false,
			last_checked_at = now(), last_error = $2 WHERE id = $1`, id, problem)
	}
	if err != nil {
		return nil, err
	}
	return s.GetDomain(ctx, id)
}

// SetDefaultDomain makes a verified host the brain's default share origin, or
// (false) returns the brain to the built-in one.
func (s *Store) SetDefaultDomain(ctx context.Context, id string, on bool) (*Domain, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	dom, err := s.GetDomain(ctx, id)
	if err != nil {
		return nil, err
	}
	if on && !dom.Verified {
		return nil, InvalidError{"verify the domain before making it the default"}
	}
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `UPDATE presentation_domains SET is_default = false WHERE namespace = $1 AND is_default`, dom.Namespace); err != nil {
		return nil, err
	}
	if on {
		if _, err := tx.ExecContext(ctx, `UPDATE presentation_domains SET is_default = true WHERE id = $1`, id); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetDomain(ctx, id)
}

// DeleteDomain unlinks a host. Its links keep their token (domain_id is set
// NULL by the foreign key) and fall back to the default base.
func (s *Store) DeleteDomain(ctx context.Context, id string) error {
	d, err := s.db(ctx)
	if err != nil {
		return err
	}
	res, err := d.ExecContext(ctx, `DELETE FROM presentation_domains WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// VerifiedHostNamespace is the brain a verified host belongs to.
func (s *Store) VerifiedHostNamespace(ctx context.Context, host string) (string, bool) {
	d, err := s.db(ctx)
	if err != nil {
		return "", false
	}
	var ns string
	if err := d.QueryRowContext(ctx, `SELECT namespace FROM presentation_domains
		WHERE host = $1 AND verified_at IS NOT NULL`, CleanRequestHost(host)).Scan(&ns); err != nil {
		return "", false
	}
	return ns, true
}

// resolveDomainRef turns a share's domain reference (an id or a host) into a
// verified domain of the brain. "" is "no pinned domain".
func (s *Store) resolveDomainRef(ctx context.Context, namespace, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", nil
	}
	d, err := s.db(ctx)
	if err != nil {
		return "", err
	}
	var id string
	var verified sql.NullTime
	err = d.QueryRowContext(ctx, `SELECT id, verified_at FROM presentation_domains
		WHERE namespace = $1 AND (id = $2 OR host = lower($2))`, namespace, ref).Scan(&id, &verified)
	if errors.Is(err, sql.ErrNoRows) {
		return "", InvalidError{"domain is not one of this brain's linked domains"}
	}
	if err != nil {
		return "", err
	}
	if !verified.Valid {
		return "", InvalidError{"the domain is not verified yet; verify it before sharing on it"}
	}
	return id, nil
}

// shareOrigin is the origin a link is built on: https://<host> for a custom
// host, else the built-in base.
func shareOrigin(host string) string {
	if host == "" {
		return BaseURL()
	}
	return "https://" + host
}

// ShareURLOn is ShareURL on a custom host ("" = the built-in base).
func ShareURLOn(host, locale, token string) string {
	if !IsLocale(locale) {
		locale = "en"
	}
	return shareOrigin(host) + "/" + locale + "/p/" + token
}
