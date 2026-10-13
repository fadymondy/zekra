package brain

import (
	"errors"
	"strings"
	"testing"
)

// All credentials below are fake. They are assembled at runtime so no literal in
// this file looks like a credential to secret scanners (GitGuardian) — the
// assembled strings are exactly the inputs the tests exercise.
func fakeSecret(parts ...string) string { return strings.Join(parts, "") }

var (
	fakePass9182   = fakeSecret("Fake-", "Pass-", "9182")
	fakePass4471   = fakeSecret("Fake-", "Pass-", "4471")
	fakePass1111   = fakeSecret("Fake-", "Pass-", "1111")
	fakePass2222   = fakeSecret("Fake-", "Pass-", "2222")
	fakePass3333   = fakeSecret("Fake-", "Pass-", "3333")
	fakePass4444   = fakeSecret("Fake-", "Pass-", "4444")
	fakeMailPass   = fakeSecret("fake-", "mail-", "pass-", "123")
	fakeAppKey     = fakeSecret("fake-", "app-", "key-", "for-", "tests")
	fakeWhsec      = fakeSecret("whsec", "_", "fakefakefake123")
	fakeGhToken    = fakeSecret("ghp", "_", "FAKEfakeFAKEfake1234")
	fakeDBPass     = fakeSecret("fake", "pw99")
	fakeOldValue   = fakeSecret("Fake-", "Old-Value")
	fakeRealAdmin  = fakeSecret("Fake-", "Real-Admin")
	fakeNewValue   = fakeSecret("Fake-", "New-Value")
	fakeCollides   = fakeSecret("Fake-", "Collides")
	fakeBrandNew   = fakeSecret("Fake-", "Brand-New")
	fakeOtherAdmin = fakeSecret("Fake-", "Other-Admin")
	fakeValue77    = fakeSecret("Fake-", "Value-77")
	fakeValue88    = fakeSecret("Fake-", "Value-88")
	fakeToken      = fakeSecret("Fake-", "Token-", "xyz9")
	fakeSMTPHost   = fakeSecret("smtp", ".example", ".test")
	fakeDBURL      = fakeSecret("postgres", "://", "app", ":", fakeDBPass, "@", "db.acme.test:5432/app")
)

// Bug 1: a body that already holds vault references must come out unchanged —
// before, the `secret:` inside `[secret:name]` was read as a credential label and
// the reference was rewritten to `[secret:[secret:secret]`.
func TestExtractSecretsLeavesVaultReferencesAlone(t *testing.T) {
	content := "## Moharrik\n" +
		"Admin password: [secret:moharrik-admin-password]\n" +
		"secret: [secret:stripe-webhook-secret]\n" +
		"API key = [secret:openai-key]\n" +
		"MAIL_PASSWORD=[secret:MAIL_PASSWORD]\n" +
		"See [secret:moharrik-admin-password] above."
	red, found := extractSecrets(content)
	if red != content {
		t.Fatalf("references were rewritten:\n%s", red)
	}
	if len(found) != 0 {
		t.Fatalf("captured a reference as a secret: %+v", found)
	}
}

func TestExtractSecretsRedactsNewSecretsNextToReferences(t *testing.T) {
	content := "Old password: [secret:old-admin-password]\nNew admin password: " + fakePass9182
	red, found := extractSecrets(content)
	if !strings.Contains(red, "[secret:old-admin-password]") {
		t.Fatalf("existing reference lost:\n%s", red)
	}
	if strings.Contains(red, fakePass9182) || len(found) != 1 || found[0].Value != fakePass9182 {
		t.Fatalf("new secret not captured cleanly: %q %+v", red, found)
	}
	if strings.Count(red, "[secret:") != 2 || strings.Contains(red, "[secret:[") {
		t.Fatalf("mangled output:\n%s", red)
	}
}

// Bug 2: plain config, hosts, emails and usernames are not secrets.
func TestExtractSecretsSkipsNonSecrets(t *testing.T) {
	content := strings.Join([]string{
		"MAIL_MAILER=smtp",
		"MAIL_HOST=" + fakeSMTPHost,
		"MAIL_PORT=587",
		"MAIL_USERNAME=owner@acme.test",
		"MAIL_FROM_ADDRESS=hello@acme.test",
		"MAIL_FROM_NAME=AcmeCorp",
		"APP_URL=https://app.acme.test",
		"AWS_REGION=eu-central-1",
		"Email: owner@acme.test",
		"Username: acme-owner",
	}, "\n")
	red, found := extractSecrets(content)
	if len(found) != 0 || red != content {
		t.Fatalf("over-redacted non-secrets: %+v\n%s", found, red)
	}
}

func TestExtractSecretsStillCapturesRealSecrets(t *testing.T) {
	content := strings.Join([]string{
		"MAIL_HOST=" + fakeSMTPHost,
		"MAIL_PASSWORD=" + fakeMailPass,
		"APP_KEY=base64:" + fakeAppKey,
		"STRIPE_WEBHOOK_SECRET=" + fakeWhsec,
		"GITHUB_TOKEN=" + fakeGhToken,
		"DATABASE_URL=" + fakeDBURL,
		"Password: " + fakePass4471,
	}, "\n")
	red, found := extractSecrets(content)
	for _, v := range []string{fakeMailPass, fakeAppKey, fakeWhsec,
		fakeGhToken, fakeDBPass, fakePass4471} {
		if strings.Contains(red, v) {
			t.Errorf("secret %q left in content", v)
		}
	}
	if !strings.Contains(red, "MAIL_HOST="+fakeSMTPHost) {
		t.Errorf("non-secret redacted:\n%s", red)
	}
	if len(found) != 6 {
		t.Errorf("want 6 secrets, got %d: %+v", len(found), found)
	}
}

// Bug 3a: names come from the surrounding label/context, and two different
// values in one body never share a name.
func TestExtractSecretsNamesFromContext(t *testing.T) {
	content := "## Moharrik\nAdmin password: " + fakePass1111 + "\n\n## Sada\nPassword: " + fakePass2222 + "\n"
	_, found := extractSecrets(content)
	if len(found) != 2 {
		t.Fatalf("want 2, got %+v", found)
	}
	if found[0].Name != "moharrik-admin-password" {
		t.Errorf("first name = %q, want moharrik-admin-password", found[0].Name)
	}
	if found[1].Name != "sada-password" {
		t.Errorf("second name = %q, want sada-password", found[1].Name)
	}

	_, found = extractSecrets("Password: " + fakePass3333 + "\nPassword: " + fakePass4444)
	if len(found) != 2 || found[0].Name == found[1].Name {
		t.Fatalf("two values share a name: %+v", found)
	}
}

// Bug 3b: a capture must not overwrite a vault entry that holds another value.
func TestPlanSecretCaptureNeverOverwritesADifferentValue(t *testing.T) {
	vault := map[string]string{
		"password":                fakeOldValue,
		"MAIL_PASSWORD":           fakeMailPass,
		"moharrik-admin-password": fakeRealAdmin,
		"sada-password-" + shortHash(fakeNewValue): fakeCollides,
	}
	lookup := func(name string) (string, bool, error) {
		v, ok := vault[name]
		return v, ok, nil
	}
	plan, skipped := planSecretCapture([]detectedSecret{
		{Name: "password", Value: fakeNewValue, Kind: "credential"},
		{Name: "MAIL_PASSWORD", Value: fakeMailPass, Kind: "env"},
		{Name: "sada-password", Value: fakeBrandNew, Kind: "credential"},
		{Name: "moharrik-admin-password", Value: fakeOtherAdmin, Kind: "credential"},
	}, lookup)

	byVal := map[string]plannedSecret{}
	for _, p := range plan {
		byVal[p.Value] = p
	}
	if p := byVal[fakeNewValue]; p.Name == "password" || !p.Store {
		t.Errorf("clashing name reused: %+v", p)
	}
	if p := byVal[fakeMailPass]; p.Name != "MAIL_PASSWORD" || p.Store {
		t.Errorf("identical value should reuse the entry without a write: %+v", p)
	}
	if p := byVal[fakeBrandNew]; p.Name != "sada-password" || !p.Store {
		t.Errorf("free name should be used as-is: %+v", p)
	}
	if p := byVal[fakeOtherAdmin]; p.Name != "moharrik-admin-password-"+shortHash(fakeOtherAdmin) {
		t.Errorf("want hash-suffixed name, got %+v", p)
	}
	if len(skipped) != 0 {
		t.Errorf("unexpected skips: %v", skipped)
	}
	for name, v := range map[string]string{"password": fakeOldValue, "moharrik-admin-password": fakeRealAdmin} {
		for _, p := range plan {
			if p.Store && p.Name == name && p.Value != v {
				t.Errorf("would overwrite %s", name)
			}
		}
	}
}

func TestPlanSecretCaptureSkipsWhenNoFreeName(t *testing.T) {
	val := fakeValue77
	lookup := func(name string) (string, bool, error) { return "something-else", true, nil }
	plan, skipped := planSecretCapture([]detectedSecret{{Name: "password", Value: val, Kind: "credential"}}, lookup)
	if len(plan) != 0 || len(skipped) != 1 {
		t.Fatalf("want skip, got plan=%+v skipped=%v", plan, skipped)
	}
}

func TestPlanSecretCaptureTreatsLookupErrorAsTaken(t *testing.T) {
	lookup := func(name string) (string, bool, error) {
		if name == "password" {
			return "", false, errors.New("decrypt failed")
		}
		return "", false, nil
	}
	plan, _ := planSecretCapture([]detectedSecret{{Name: "password", Value: fakeValue88, Kind: "credential"}}, lookup)
	if len(plan) != 1 || plan[0].Name == "password" {
		t.Fatalf("unreadable entry must not be overwritten: %+v", plan)
	}
}

// Redacting with the planned names keeps references intact and never touches
// a value that only occurs inside a reference.
func TestRedactSecretsOutsideReferences(t *testing.T) {
	content := "token: " + fakeToken + " and [secret:" + fakeToken + "-note]"
	got := redactSecrets(content, []plannedSecret{{detectedSecret: detectedSecret{Name: "api-token", Value: fakeToken}}})
	want := "token: [secret:api-token] and [secret:" + fakeToken + "-note]"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
