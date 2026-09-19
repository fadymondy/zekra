package presentations

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"strings"
)

/*
Sealing share tokens (token_sealed).

A share token is matched only by its SHA-256 (token_hash). The token itself is
kept sealed so the owner can copy the link again later. The envelope is the one
fadymondy.com's internal/vault writes, byte for byte:

	vault:v1:<base64(nonce(12) || AES-256-GCM ciphertext+tag)>

so rows imported from fadymondy.com (zekractl presentations-import) keep
reopening, provided the key they were sealed with is configured here.

Keys, in order (the first one seals; every one is tried when opening, GCM's tag
tells a wrong key from a right one):

 1. VAULT_KEY: 32 bytes, 64 hex or base64 (fadymondy.com's exact rule). Set it
    to fadymondy.com's VAULT_KEY to keep imported links copyable.
 2. ZEKRA_SECRETS_KEY: 64 hex, the brain secrets-vault key.
 3. sha256("zekra-presentations-v1:" + AUTH_SECRET): derived, like the secrets
    vault's AUTH_SECRET fallback (with its own label, so a presentation token
    and a brain secret never share a key).

No key at all: tokens are not sealed (token_sealed = ''), the link is shown
once at creation and never again, exactly as on fadymondy.com without VAULT_KEY.
The public view never needs the key: it hashes the presented token.
*/

// SealPrefix marks a sealed token.
const SealPrefix = "vault:v1:"

// Sealer seals and opens share tokens.
type Sealer interface {
	Configured() bool
	Seal(plain string) (string, error)
	Open(sealed string) (string, error)
}

// ErrNoSealKey means no sealing key is configured.
var ErrNoSealKey = errors.New("no sealing key: set VAULT_KEY, ZEKRA_SECRETS_KEY or AUTH_SECRET")

// KeySealer is a Sealer over explicit keys (the first seals; all open).
type KeySealer struct{ Keys [][]byte }

// DefaultSealer reads the keys from the environment on every call, so a key
// rotated into the environment is picked up without a restart.
func DefaultSealer() Sealer { return KeySealer{Keys: EnvSealKeys()} }

// EnvSealKeys resolves VAULT_KEY, ZEKRA_SECRETS_KEY and AUTH_SECRET (in that
// order), skipping unset or malformed ones.
func EnvSealKeys() [][]byte {
	var keys [][]byte
	if k, err := DecodeVaultKey(os.Getenv("VAULT_KEY")); err == nil {
		keys = append(keys, k)
	}
	if h := strings.TrimSpace(os.Getenv("ZEKRA_SECRETS_KEY")); h != "" {
		if b, err := hex.DecodeString(h); err == nil && len(b) == 32 {
			keys = append(keys, b)
		}
	}
	if sec := strings.TrimSpace(os.Getenv("AUTH_SECRET")); sec != "" {
		sum := sha256.Sum256([]byte("zekra-presentations-v1:" + sec))
		keys = append(keys, sum[:])
	}
	return keys
}

// DecodeVaultKey decodes a 32-byte key given as 64 hex characters or base64
// (std or raw-url), fadymondy.com's VAULT_KEY rule.
func DecodeVaultKey(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, ErrNoSealKey
	}
	if len(raw) == 64 {
		if b, err := hex.DecodeString(raw); err == nil {
			return b, nil
		}
	}
	b, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		b, err = base64.RawURLEncoding.DecodeString(raw)
	}
	if err != nil {
		return nil, errors.New("key is neither valid base64 nor hex")
	}
	if len(b) != 32 {
		return nil, errors.New("key must decode to 32 bytes")
	}
	return b, nil
}

// Configured reports whether a key is present.
func (k KeySealer) Configured() bool { return len(k.Keys) > 0 }

// Seal encrypts a token with the first key.
func (k KeySealer) Seal(plain string) (string, error) {
	if strings.HasPrefix(plain, SealPrefix) {
		return plain, nil
	}
	if len(k.Keys) == 0 {
		return "", ErrNoSealKey
	}
	gcm, err := newGCM(k.Keys[0])
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return SealPrefix + base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

// Open decrypts a sealed token with whichever configured key sealed it.
func (k KeySealer) Open(sealed string) (string, error) {
	if !strings.HasPrefix(sealed, SealPrefix) {
		return "", errors.New("not a sealed token")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(sealed, SealPrefix))
	if err != nil {
		return "", errors.New("sealed token is not base64")
	}
	if len(k.Keys) == 0 {
		return "", ErrNoSealKey
	}
	for _, key := range k.Keys {
		gcm, err := newGCM(key)
		if err != nil || len(raw) < gcm.NonceSize() {
			continue
		}
		if pt, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil); err == nil {
			return string(pt), nil
		}
	}
	return "", errors.New("no configured key opens this token")
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
