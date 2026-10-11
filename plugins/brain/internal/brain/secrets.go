package brain

// Per-brain secrets vault (namespace-scoped, encrypted at rest, ACL-gated).
//
// Why it exists: retained content (a session, a .env dump, a chat log) often
// carries live secrets — API keys, passwords, connection strings, private keys.
// Storing those verbatim in `memories.content` would (a) embed them into the
// vector index and (b) leak them to anyone who can recall. Instead, on retain we
// DETECT secrets, move each value into this vault (AES-256-GCM), and REDACT the
// content to a `[secret:<name>]` reference. The memory stays useful and
// searchable; the raw value lives only in the vault and is revealed only to a
// caller with write/admin on that brain. Secrets persist across sessions.
//
// Storage lives in the `zekra_auth` schema (created + isolated for this app),
// so `secrets` resolves there via search_path and never collides with anything
// in `public`.

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

// --- encryption ---------------------------------------------------------------

// secretKDFLabel domain-separates the vault key derived from AUTH_SECRET.
const secretKDFLabel = "zekra-secrets-v1:"

// legacySecretKDFLabel is the label from before the product was renamed. It is a
// key-derivation input, not a name: every secret stored under a derived key was
// encrypted with it, so it stays readable (decrypt only) until those rows have
// been re-encrypted. Deployments with an explicit ZEKRA_SECRETS_KEY never use it.
const legacySecretKDFLabel = "cabrain-secrets-v1:"

// secretKeys resolves the AES keys: the first encrypts, all of them decrypt.
// Preference: ZEKRA_SECRETS_KEY (64 hex chars) → derived from AUTH_SECRET →
// error (fail closed; never store plaintext).
func secretKeys() ([][]byte, error) {
	if h := strings.TrimSpace(os.Getenv("ZEKRA_SECRETS_KEY")); h != "" {
		b, err := hex.DecodeString(h)
		if err == nil && len(b) == 32 {
			return [][]byte{b}, nil
		}
		return nil, errors.New("ZEKRA_SECRETS_KEY must be 64 hex chars (32 bytes)")
	}
	if s := strings.TrimSpace(os.Getenv("AUTH_SECRET")); s != "" {
		current := sha256.Sum256([]byte(secretKDFLabel + s))
		legacy := sha256.Sum256([]byte(legacySecretKDFLabel + s))
		return [][]byte{current[:], legacy[:]}, nil
	}
	return nil, errors.New("secrets vault has no key: set ZEKRA_SECRETS_KEY (64 hex) or AUTH_SECRET")
}

func secretKey() ([]byte, error) {
	keys, err := secretKeys()
	if err != nil {
		return nil, err
	}
	return keys[0], nil
}

// encryptSecret returns nonce||ciphertext (GCM), safe to store as bytea.
func encryptSecret(plaintext string) ([]byte, error) {
	key, err := secretKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func decryptSecret(enc []byte) (string, error) {
	keys, err := secretKeys()
	if err != nil {
		return "", err
	}
	// GCM authenticates, so a wrong key fails cleanly rather than yielding
	// garbage — trying each key in turn is safe.
	for _, key := range keys {
		block, err := aes.NewCipher(key)
		if err != nil {
			return "", err
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return "", err
		}
		if len(enc) < gcm.NonceSize() {
			return "", errors.New("secret ciphertext too short")
		}
		nonce, ct := enc[:gcm.NonceSize()], enc[gcm.NonceSize():]
		if pt, err := gcm.Open(nil, nonce, ct, nil); err == nil {
			return string(pt), nil
		}
	}
	return "", errors.New("secret decrypt failed (wrong key?)")
}

// maskHint returns a non-reversible preview for listings, e.g. "sk-…a1b2" or "••••".
func maskHint(v string) string {
	v = strings.TrimSpace(v)
	if len(v) <= 4 {
		return "••••"
	}
	head := ""
	if i := strings.IndexAny(v, "-_"); i > 0 && i <= 6 {
		head = v[:i+1]
	}
	return head + "…" + v[len(v)-4:]
}

// --- detection ----------------------------------------------------------------

type detectedSecret struct {
	Name  string
	Value string
	Kind  string
}

// secretMatchers are ordered most-specific-first. Each returns the secret value
// (submatch group `val` or whole match) and a stable name basis.
var secretMatchers = []struct {
	kind string
	re   *regexp.Regexp
	// nameFrom, if set, derives the vault key from a submatch (e.g. the env var name).
	nameGroup int
	valGroup  int
}{
	{kind: "private_key", re: regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`), valGroup: 0},
	{kind: "connection_string", re: regexp.MustCompile(`(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?)://[^\s:@/]+:[^\s@]+@[^\s"'` + "`" + `]+`), valGroup: 0},
	{kind: "aws_key", re: regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`), valGroup: 0},
	{kind: "openai_key", re: regexp.MustCompile(`\bsk-[A-Za-z0-9_\-]{20,}\b`), valGroup: 0},
	{kind: "pat", re: regexp.MustCompile(`\b(?:os_pat_|ghp_|gho_|github_pat_|xoxb-|xoxp-|glpat-)[A-Za-z0-9_\-]{10,}\b`), valGroup: 0},
	{kind: "jwt", re: regexp.MustCompile(`\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b`), valGroup: 0},
	{kind: "bearer", re: regexp.MustCompile(`(?i)\bbearer\s+([A-Za-z0-9._\-]{20,})`), valGroup: 1},
	{kind: "env", re: regexp.MustCompile(`(?m)^\s*([A-Z][A-Z0-9_]{2,})\s*=\s*['"]?([^\s'"]{6,})['"]?\s*$`), nameGroup: 1, valGroup: 2},
	{kind: "credential", re: regexp.MustCompile(`(?i)\b(pass(?:word|wd)?|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"]?([^\s'"]{6,})['"]?`), nameGroup: 1, valGroup: 2},
}

// secretRefRe matches a vault reference left by an earlier capture. References
// are opaque: nothing inside one is ever detected, captured or rewritten.
var secretRefRe = regexp.MustCompile(`\[secret:[^\[\]\s]*\]`)

// secretEnvName / publicEnvName gate the env matcher to variables that hold a
// credential. Hosts, ports, usernames, sender addresses, URLs and IDs are config,
// not secrets.
var (
	secretEnvName = regexp.MustCompile(`PASS|PWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|(?:^|_)KEY$|CREDENTIAL|SALT|DSN`)
	publicEnvName = regexp.MustCompile(`PUBLIC|PUBLISHABLE|_ID$|_USER(?:NAME)?$|_EMAIL$|_ADDRESS$|_HOST$|_URL$|_URI$|_PATH$`)
)

var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$`)

// looksLikePlaceholder skips obvious non-secrets (examples, redaction markers).
func looksLikePlaceholder(v string) bool {
	lv := strings.ToLower(v)
	for _, p := range []string{"example", "changeme", "your_", "xxxx", "****", "…", "redacted", "<", "placeholder", "dummy", "[secret:"} {
		if strings.Contains(lv, p) {
			return true
		}
	}
	return false
}

// extractSecrets scans content, returns the redacted content (secret values
// replaced with `[secret:<name>]`) and the list of detected secrets (deduped by
// value, unique by name). Existing references pass through untouched.
func extractSecrets(content string) (string, []detectedSecret) {
	found := detectSecrets(content)
	plan := make([]plannedSecret, len(found))
	for i, d := range found {
		plan[i] = plannedSecret{detectedSecret: d}
	}
	return redactSecrets(content, plan), found
}

// detectSecrets finds the secret values in content. Names come from the env var,
// or from the credential label plus its context ("Admin password:" under
// "## Moharrik" → moharrik-admin-password), else "<kind>-<8hex of value>". Two
// different values never share a name within one body.
func detectSecrets(content string) []detectedSecret {
	refs := secretRefRe.FindAllStringIndex(content, -1)
	inRef := func(a, b int) bool {
		for _, r := range refs {
			if a < r[1] && b > r[0] {
				return true
			}
		}
		return false
	}
	seen := map[string]bool{}     // value
	nameOf := map[string]string{} // name -> value
	var out []detectedSecret

	for _, m := range secretMatchers {
		for _, loc := range m.re.FindAllStringSubmatchIndex(content, -1) {
			vs, ve := loc[2*m.valGroup], loc[2*m.valGroup+1]
			if vs < 0 || inRef(loc[0], loc[1]) || inRef(vs, ve) {
				continue
			}
			val := strings.TrimSpace(content[vs:ve])
			if len(val) < 6 || seen[val] || looksLikePlaceholder(val) {
				continue
			}
			label := ""
			if m.nameGroup > 0 && loc[2*m.nameGroup] >= 0 {
				label = content[loc[2*m.nameGroup]:loc[2*m.nameGroup+1]]
			}
			var name string
			switch m.kind {
			case "env":
				if !secretEnvName.MatchString(label) || publicEnvName.MatchString(label) || emailRe.MatchString(val) {
					continue
				}
				name = sanitizeSecretName(label)
			case "credential":
				if emailRe.MatchString(val) {
					continue
				}
				name = credentialName(content, loc[0], label)
			default:
				name = m.kind + "-" + shortHash(val)
			}
			if prev, taken := nameOf[name]; taken && prev != val {
				name = sanitizeSecretName(name + "-" + shortHash(val))
			}
			seen[val] = true
			nameOf[name] = val
			out = append(out, detectedSecret{Name: name, Value: val, Kind: m.kind})
		}
	}
	return out
}

// plannedSecret is a detected secret with its final vault name; Store is false
// when the vault already holds this exact value under that name.
type plannedSecret struct {
	detectedSecret
	Store bool
}

// redactSecrets replaces each planned value with its reference, longest value
// first, and only outside existing references.
func redactSecrets(content string, plan []plannedSecret) string {
	sorted := append([]plannedSecret(nil), plan...)
	sort.SliceStable(sorted, func(i, j int) bool { return len(sorted[i].Value) > len(sorted[j].Value) })
	for _, p := range sorted {
		content = replaceOutsideRefs(content, p.Value, "[secret:"+p.Name+"]")
	}
	return content
}

func replaceOutsideRefs(s, old, repl string) string {
	var b strings.Builder
	last := 0
	for _, r := range secretRefRe.FindAllStringIndex(s, -1) {
		b.WriteString(strings.ReplaceAll(s[last:r[0]], old, repl))
		b.WriteString(s[r[0]:r[1]])
		last = r[1]
	}
	b.WriteString(strings.ReplaceAll(s[last:], old, repl))
	return b.String()
}

// planSecretCapture picks a vault name per detected secret without ever
// overwriting an entry that holds a different value: an identical value reuses
// its entry, a clash falls back to "<name>-<8hex of value>", and if that is taken
// too the secret is skipped (left un-redacted) and reported. lookup returns the
// current value under a name; a lookup error counts as taken.
func planSecretCapture(found []detectedSecret, lookup func(name string) (string, bool, error)) ([]plannedSecret, []string) {
	var plan []plannedSecret
	var skipped []string
	for _, d := range found {
		placed := false
		for _, name := range []string{d.Name, sanitizeSecretName(d.Name + "-" + shortHash(d.Value))} {
			cur, ok, err := lookup(name)
			if err != nil {
				continue
			}
			if !ok || cur == d.Value {
				d.Name = name
				plan = append(plan, plannedSecret{detectedSecret: d, Store: !ok})
				placed = true
				break
			}
		}
		if !placed {
			skipped = append(skipped, d.Name)
		}
	}
	return plan, skipped
}

var (
	labelWordRe = regexp.MustCompile(`[A-Za-z0-9]+`)
	headingRe   = regexp.MustCompile(`^\s*(?:#{1,6}\s+(.+?)\s*#*\s*|\*\*([^*]+)\*\*:?|__([^_]+)__:?|([^:=]{1,60}):)\s*$`)
)

// credentialName builds a vault name from a credential label and its context:
// the nearest heading above plus the words before the label on its own line
// ("Admin password:" under "## Moharrik" → moharrik-admin-password).
func credentialName(content string, at int, label string) string {
	base := normalizeCredentialLabel(label)
	lineStart := strings.LastIndexByte(content[:at], '\n') + 1
	ctx := contextWords(content[lineStart:at])
	lines := strings.Split(content[:lineStart], "\n")
	for i, n := len(lines)-1, 0; i >= 0 && n < 20; i-- {
		l := strings.TrimSpace(lines[i])
		if l == "" {
			continue
		}
		n++
		if m := headingRe.FindStringSubmatch(l); m != nil {
			head := contextWords(m[1] + m[2] + m[3] + m[4])
			if !strings.Contains(strings.Join(ctx, "-"), strings.Join(head, "-")) {
				ctx = append(head, ctx...)
			}
			break
		}
	}
	if len(ctx) > 0 && ctx[len(ctx)-1] == base {
		ctx = ctx[:len(ctx)-1]
	}
	if len(ctx) > 5 {
		ctx = ctx[len(ctx)-5:]
	}
	return sanitizeSecretName(strings.Join(append(ctx, base), "-"))
}

func contextWords(s string) []string {
	w := labelWordRe.FindAllString(strings.ToLower(s), -1)
	if len(w) > 4 {
		w = w[len(w)-4:]
	}
	return w
}

func normalizeCredentialLabel(l string) string {
	l = strings.ToLower(l)
	switch {
	case strings.HasPrefix(l, "pass"):
		return "password"
	case strings.HasPrefix(l, "api"):
		return "api-key"
	case strings.HasPrefix(l, "access"):
		return "access-token"
	case strings.HasPrefix(l, "auth"):
		return "auth-token"
	}
	return "secret"
}

func shortHash(v string) string {
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:4])
}

var nameSanitizer = regexp.MustCompile(`[^A-Za-z0-9_.\-]+`)

func sanitizeSecretName(s string) string {
	s = nameSanitizer.ReplaceAllString(strings.TrimSpace(s), "_")
	s = strings.Trim(s, "_")
	if s == "" {
		s = "secret"
	}
	if len(s) > 96 {
		s = s[:96]
	}
	return s
}

// --- store --------------------------------------------------------------------

// SecretMeta is the listing view — never carries the value.
type SecretMeta struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Hint      string `json:"hint"`
	Kind      string `json:"kind"`
	SourceRef string `json:"sourceRef,omitempty"`
	CreatedBy string `json:"createdBy,omitempty"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// PutSecret upserts an encrypted secret under (namespace, name).
func (s *Store) PutSecret(ctx context.Context, ns, name, value, kind, sourceRef, by string) error {
	if ns == "" || name == "" {
		return errors.New("namespace and name required")
	}
	if value == "" {
		return errors.New("empty secret value")
	}
	enc, err := encryptSecret(value)
	if err != nil {
		return err
	}
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO secrets (namespace, name, value_enc, hint, kind, source_ref, created_by, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
		ON CONFLICT (namespace, name) DO UPDATE
		  SET value_enc = EXCLUDED.value_enc, hint = EXCLUDED.hint, kind = EXCLUDED.kind,
		      source_ref = COALESCE(EXCLUDED.source_ref, secrets.source_ref), updated_at = now()`,
		ns, name, enc, maskHint(value), nullStr(kind), nullStr(sourceRef), nullStr(by))
	return err
}

// ListSecrets returns metadata (no values) for a brain.
func (s *Store) ListSecrets(ctx context.Context, ns string) ([]SecretMeta, error) {
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT namespace, name, COALESCE(hint,''), COALESCE(kind,''), COALESCE(source_ref,''),
		       COALESCE(created_by,''), created_at, updated_at
		FROM secrets WHERE namespace = $1 ORDER BY name`, ns)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SecretMeta
	for rows.Next() {
		var m SecretMeta
		var created, updated time.Time
		if err := rows.Scan(&m.Namespace, &m.Name, &m.Hint, &m.Kind, &m.SourceRef, &m.CreatedBy, &created, &updated); err != nil {
			return nil, err
		}
		m.CreatedAt = created.UTC().Format(time.RFC3339)
		m.UpdatedAt = updated.UTC().Format(time.RFC3339)
		out = append(out, m)
	}
	return out, rows.Err()
}

// RevealSecret decrypts and returns the value for (namespace, name). Caller ACL is
// enforced at the handler; this is the raw read.
func (s *Store) RevealSecret(ctx context.Context, ns, name string) (string, error) {
	db, err := s.db(ctx)
	if err != nil {
		return "", err
	}
	var enc []byte
	err = db.QueryRowContext(ctx, `SELECT value_enc FROM secrets WHERE namespace = $1 AND name = $2`, ns, name).Scan(&enc)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return decryptSecret(enc)
}

// DeleteSecret removes a secret. Returns whether a row was deleted.
func (s *Store) DeleteSecret(ctx context.Context, ns, name string) (bool, error) {
	db, err := s.db(ctx)
	if err != nil {
		return false, err
	}
	res, err := db.ExecContext(ctx, `DELETE FROM secrets WHERE namespace = $1 AND name = $2`, ns, name)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// captureSecrets is the retain-path hook: it extracts secrets from content, stores
// each in the vault, and returns the redacted content plus the captured names.
// Existing vault entries are never overwritten with a different value (see
// planSecretCapture). Best-effort — a vault error must never fail the retain; on
// error it returns the ORIGINAL content unchanged (so nothing is silently
// dropped) and no names.
func (s *Store) captureSecrets(ctx context.Context, ns, content, sourceRef, by string) (string, []string) {
	found := detectSecrets(content)
	if len(found) == 0 {
		return content, nil
	}
	plan, skipped := planSecretCapture(found, func(name string) (string, bool, error) {
		v, err := s.RevealSecret(ctx, ns, name)
		if errors.Is(err, ErrNotFound) {
			return "", false, nil
		}
		return v, err == nil, err
	})
	if len(skipped) > 0 {
		slog.Warn("brain: secret capture skipped, no free vault name", "namespace", ns, "sourceRef", sourceRef, "names", skipped)
	}
	var names []string
	for _, p := range plan {
		if p.Store {
			if err := s.PutSecret(ctx, ns, p.Name, p.Value, p.Kind, sourceRef, by); err != nil {
				// Could not vault it (e.g. no key) — do not redact; keep content intact.
				return content, nil
			}
		}
		names = append(names, p.Name)
	}
	if len(names) == 0 {
		return content, nil
	}
	return redactSecrets(content, plan), names
}
