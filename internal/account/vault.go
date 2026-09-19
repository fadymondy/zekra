package account

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
)

/*
Sealing TOTP secrets at rest (AES-256-GCM), as fadymondy's internal/vault does.

The key, in order:
  - VAULT_KEY          32 bytes, base64 or hex (fadymondy's name);
  - ZEKRA_SECRETS_KEY  the brain plugin's secrets-vault key (64 hex chars);
  - derived from AUTH_SECRET (SHA-256 with a domain label), matching how the
    brain's secrets vault derives its key when ZEKRA_SECRETS_KEY is unset.

fadymondy refuses to enrol two-factor without VAULT_KEY. Zekra always has an
AUTH_SECRET (cmd/api's ensureAuthSecret persists one), so two-factor is available
unless neither is set; rotating AUTH_SECRET without a VAULT_KEY invalidates
enrolled authenticators, so set VAULT_KEY in production.
*/

const vaultPrefix = "vault:v1:"

var errNoVaultKey = errors.New("two-factor needs VAULT_KEY (or AUTH_SECRET) on the server")

func vaultKey() ([]byte, error) {
	for _, name := range []string{"VAULT_KEY", "ZEKRA_SECRETS_KEY"} {
		raw := strings.TrimSpace(os.Getenv(name))
		if raw == "" {
			continue
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
			return nil, fmt.Errorf("%s is neither valid base64 nor hex", name)
		}
		if len(b) != 32 {
			return nil, fmt.Errorf("%s decodes to %d bytes, expected 32", name, len(b))
		}
		return b, nil
	}
	if s := firstEnv("AUTH_SECRET", "JWT_SECRET"); s != "" {
		sum := sha256.Sum256([]byte("zekra/account-vault/v1\x00" + s))
		return sum[:], nil
	}
	return nil, errNoVaultKey
}

func vaultConfigured() bool {
	_, err := vaultKey()
	return err == nil
}

func vaultSeal(plaintext string) (string, error) {
	k, err := vaultKey()
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(k)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return vaultPrefix + base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plaintext), nil)), nil
}

func vaultOpen(sealed string) (string, error) {
	if !strings.HasPrefix(sealed, vaultPrefix) {
		return "", errors.New("not sealed")
	}
	k, err := vaultKey()
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(sealed, vaultPrefix))
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(k)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("sealed value is truncated")
	}
	pt, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("could not decrypt: wrong key, or the value was altered")
	}
	return string(pt), nil
}

func newGCM(k []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
