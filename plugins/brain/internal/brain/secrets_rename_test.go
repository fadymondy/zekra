package brain

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"io"
	"testing"
)

// A secret stored before the rename was encrypted under a key derived with the
// legacy label. Renaming the label must not strand it.
func TestSecretFromBeforeTheRenameStillDecrypts(t *testing.T) {
	t.Setenv("ZEKRA_SECRETS_KEY", "")
	t.Setenv("AUTH_SECRET", "a-sufficiently-long-auth-secret-for-the-test")

	legacy := sha256.Sum256([]byte(legacySecretKDFLabel + "a-sufficiently-long-auth-secret-for-the-test"))
	block, _ := aes.NewCipher(legacy[:])
	gcm, _ := cipher.NewGCM(block)
	nonce := make([]byte, gcm.NonceSize())
	_, _ = io.ReadFull(rand.Reader, nonce)
	old := gcm.Seal(nonce, nonce, []byte("ghp_old"), nil)

	got, err := decryptSecret(old)
	if err != nil || got != "ghp_old" {
		t.Fatalf("legacy secret: %q, %v", got, err)
	}

	// New writes use the new label, and round-trip.
	enc, err := encryptSecret("ghp_new")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := decryptSecret(enc); err != nil || got != "ghp_new" {
		t.Fatalf("new secret: %q, %v", got, err)
	}
	// ...and are NOT readable under the legacy key alone, i.e. the label really
	// changed rather than the fallback masking a no-op.
	if _, err := gcm.Open(nil, enc[:gcm.NonceSize()], enc[gcm.NonceSize():], nil); err == nil {
		t.Fatal("new secret opened with the legacy key — the label did not change")
	}
}

func TestExplicitSecretsKeyIgnoresTheLabels(t *testing.T) {
	t.Setenv("ZEKRA_SECRETS_KEY", "ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab"+"ab")
	keys, err := secretKeys()
	if err != nil || len(keys) != 1 {
		t.Fatalf("explicit key should be the only key: %d, %v", len(keys), err)
	}
}
