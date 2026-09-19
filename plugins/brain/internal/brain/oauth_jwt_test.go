package brain

/*
private_key_jwt clients (ChatGPT's metadata document shape, fetched
2026-09-17 from https://chatgpt.com/oauth/client.json).
*/

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const chatgptLikeID = "https://fm283-chatgpt.example.test/oauth/client.json"
const chatgptRedirect = "https://fm283-chatgpt.example.test/connector_platform_oauth_redirect"
const chatgptJWKS = "https://fm283-chatgpt.example.test/oauth/jwks.json"

type pkjClient struct {
	f       *oauthFix
	rsaKey  *rsa.PrivateKey
	kid     string
	jwks    []jwk
	fetches atomic.Int32
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func rsaJWK(k *rsa.PublicKey, kid string) jwk {
	return jwk{Kty: "RSA", Kid: kid, Use: "sig", Alg: "RS256", N: b64(k.N.Bytes()), E: b64(big.NewInt(int64(k.E)).Bytes())}
}

func newPKJ(t *testing.T) *pkjClient {
	f := newOAuthFix(t)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	p := &pkjClient{f: f, rsaKey: key, kid: "k1"}
	p.jwks = []jwk{rsaJWK(&key.PublicKey, "k1")}
	f.s.fetchCIMD = func(_ context.Context, u string) ([]byte, error) {
		if u != chatgptLikeID {
			return nil, errors.New("unexpected")
		}
		// The shape of ChatGPT's real document.
		return json.Marshal(map[string]any{
			"client_id": chatgptLikeID, "client_uri": "https://fm283-chatgpt.example.test/",
			"redirect_uris":                         []string{chatgptRedirect},
			"token_endpoint_auth_method":            "private_key_jwt",
			"token_endpoint_auth_methods_supported": []string{"none", "private_key_jwt"},
			"grant_types":                           []string{"authorization_code", "refresh_token"},
			"response_types":                        []string{"code"},
			"client_name":                           "FM283 ChatGPT-like",
			"token_endpoint_auth_signing_alg":       "RS256",
			"jwks_uri":                              chatgptJWKS,
		})
	}
	f.s.fetchJWKS = func(_ context.Context, u string) ([]byte, error) {
		if u != chatgptJWKS {
			return nil, errors.New("unexpected jwks fetch")
		}
		p.fetches.Add(1)
		return json.Marshal(jwkSet{Keys: p.jwks})
	}
	return p
}

func signJWT(t *testing.T, alg, kid string, claims map[string]any, sign func(input []byte) []byte) string {
	h := map[string]any{"alg": alg, "typ": "JWT"}
	if kid != "" {
		h["kid"] = kid
	}
	hb, _ := json.Marshal(h)
	cb, _ := json.Marshal(claims)
	input := b64(hb) + "." + b64(cb)
	return input + "." + b64(sign([]byte(input)))
}

func (p *pkjClient) rs256(key *rsa.PrivateKey) func([]byte) []byte {
	return func(in []byte) []byte {
		sum := sha256.Sum256(in)
		sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
		if err != nil {
			panic(err)
		}
		return sig
	}
}

func (p *pkjClient) claims() map[string]any {
	now := p.f.clock
	return map[string]any{
		"iss": chatgptLikeID, "sub": chatgptLikeID, "aud": testIssuer + "/api/oauth/token",
		"iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(), "jti": randomToken(12),
	}
}

func (p *pkjClient) assertion(mutate func(map[string]any)) string {
	c := p.claims()
	if mutate != nil {
		mutate(c)
	}
	return signJWT(p.f.t, "RS256", p.kid, c, p.rs256(p.rsaKey))
}

// code runs consent for the ChatGPT-like client and returns code + verifier.
func (p *pkjClient) code() (string, string) {
	p.f.t.Helper()
	verifier, challenge := pkcePair()
	q := authzQuery(chatgptLikeID, challenge, ScopeRead)
	q.Set("redirect_uri", chatgptRedirect)
	rec := p.f.decide(p.f.owner, q, true, p.f.readNS())
	if rec.Code != http.StatusOK {
		p.f.t.Fatalf("consent: %d %s", rec.Code, rec.Body)
	}
	to, _ := url.Parse(decode(p.f.t, rec)["redirect_to"].(string))
	return to.Query().Get("code"), verifier
}

func (p *pkjClient) exchange(assertion string, extra url.Values) (int, map[string]any) {
	p.f.t.Helper()
	code, verifier := p.code()
	form := url.Values{
		"grant_type": {"authorization_code"}, "client_id": {chatgptLikeID}, "code": {code},
		"redirect_uri": {chatgptRedirect}, "code_verifier": {verifier}, "resource": {testIssuer + "/api/mcp"},
		"client_assertion_type": {clientAssertionType}, "client_assertion": {assertion},
	}
	for k, v := range extra {
		form[k] = v
	}
	rec, body := p.f.token(form)
	return rec.Code, body
}

func (p *pkjClient) consentRequest() {
	p.f.t.Helper()
	_, challenge := pkcePair()
	q := authzQuery(chatgptLikeID, challenge, ScopeRead)
	q.Set("redirect_uri", chatgptRedirect)
	if rec := p.f.authorizeRequest(p.f.owner, q); rec.Code != http.StatusOK {
		p.f.t.Fatalf("consent request: %d %s", rec.Code, rec.Body)
	}
}

func TestOAuthPrivateKeyJWTValidAssertion(t *testing.T) {
	p := newPKJ(t)
	md := decode(t, p.f.do(httptestGet("/.well-known/oauth-authorization-server")))
	if !strings.Contains(string(oauthJSON(md["token_endpoint_auth_methods_supported"])), "private_key_jwt") ||
		!strings.Contains(string(oauthJSON(md["token_endpoint_auth_signing_alg_values_supported"])), "RS256") ||
		!strings.Contains(string(oauthJSON(md["token_endpoint_auth_signing_alg_values_supported"])), "ES256") {
		t.Fatalf("metadata does not advertise private_key_jwt: %v", md)
	}
	p.consentRequest()
	if n := p.f.count(`SELECT count(*) FROM mcp_oauth_clients WHERE id = $1 AND token_endpoint_auth_method = 'private_key_jwt' AND jwks_uri = $2`, chatgptLikeID, chatgptJWKS); n != 1 {
		t.Fatal("client not recorded with its auth method and jwks_uri")
	}

	code, body := p.exchange(p.assertion(nil), nil)
	if code != http.StatusOK || body["access_token"] == nil {
		t.Fatalf("valid assertion: %d %v", code, body)
	}
	if c, _ := p.f.mcp(body["access_token"].(string), "tools/list", nil); c != http.StatusOK {
		t.Fatalf("token from a private_key_jwt client refused: %d", c)
	}
	// Refresh needs an assertion too.
	refresh := body["refresh_token"].(string)
	rec, _ := p.f.token(url.Values{"grant_type": {"refresh_token"}, "client_id": {chatgptLikeID}, "refresh_token": {refresh}})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("refresh without an assertion: %d", rec.Code)
	}
	rec, _ = p.f.token(url.Values{"grant_type": {"refresh_token"}, "client_id": {chatgptLikeID}, "refresh_token": {refresh},
		"client_assertion_type": {clientAssertionType}, "client_assertion": {p.assertion(nil)}})
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh with an assertion: %d %s", rec.Code, rec.Body)
	}
	// aud may be the issuer, and client_id may be omitted (RFC 7523).
	code, _ = p.exchange(p.assertion(func(c map[string]any) { c["aud"] = []string{"x", testIssuer} }), url.Values{"client_id": nil})
	if code != http.StatusOK {
		t.Fatalf("issuer audience / omitted client_id: %d", code)
	}
}

func httptestGet(path string) *http.Request {
	r, _ := http.NewRequest(http.MethodGet, path, nil)
	return r
}

func TestOAuthPrivateKeyJWTRefusals(t *testing.T) {
	p := newPKJ(t)
	// A published key without "alg": only the server allow-list stops HS256/none.
	p.jwks[0].Alg = ""
	p.consentRequest()
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	now := p.f.clock

	cases := map[string]string{
		"wrong signature": signJWT(t, "RS256", "k1", p.claims(), p.rs256(other)),
		"wrong iss":       p.assertion(func(c map[string]any) { c["iss"] = "https://evil.example.test/client.json" }),
		"wrong sub":       p.assertion(func(c map[string]any) { c["sub"] = "someone-else" }),
		"wrong aud":       p.assertion(func(c map[string]any) { c["aud"] = "https://evil.example.test/token" }),
		"no aud":          p.assertion(func(c map[string]any) { delete(c, "aud") }),
		"expired":         p.assertion(func(c map[string]any) { c["exp"] = now.Add(-time.Second).Unix() }),
		"no exp":          p.assertion(func(c map[string]any) { delete(c, "exp") }),
		"too long-lived":  p.assertion(func(c map[string]any) { c["exp"] = now.Add(2 * time.Hour).Unix(); delete(c, "iat") }),
		"iat in future":   p.assertion(func(c map[string]any) { c["iat"] = now.Add(time.Hour).Unix() }),
		"nbf in future":   p.assertion(func(c map[string]any) { c["nbf"] = now.Add(time.Hour).Unix() }),
		"no jti":          p.assertion(func(c map[string]any) { delete(c, "jti") }),
		"alg none":        signJWT(t, "none", "k1", p.claims(), func([]byte) []byte { return nil }),
		"alg HS256 keyed with the public key": signJWT(t, "HS256", "k1", p.claims(), func(in []byte) []byte {
			m := hmac.New(sha256.New, []byte(p.jwks[0].N))
			m.Write(in)
			return m.Sum(nil)
		}),
		"unknown kid":  signJWT(t, "RS256", "k-unknown", p.claims(), p.rs256(p.rsaKey)),
		"malformed":    "not.a.jwt",
		"no assertion": "",
	}
	for name, a := range cases {
		code, body := p.exchange(a, nil)
		if code != http.StatusUnauthorized || body["error"] != "invalid_client" || body["access_token"] != nil {
			t.Errorf("%s: want 401 invalid_client, got %d %v", name, code, body)
		}
	}
	// Wrong assertion type.
	if code, _ := p.exchange(p.assertion(nil), url.Values{"client_assertion_type": {"urn:x"}}); code != http.StatusUnauthorized {
		t.Errorf("wrong assertion type: %d", code)
	}
	// A secret instead of an assertion.
	if code, _ := p.exchange("", url.Values{"client_secret": {"x"}}); code != http.StatusUnauthorized {
		t.Errorf("secret for a private_key_jwt client: %d", code)
	}
	if n := p.f.count(`SELECT count(*) FROM mcp_oauth_grants WHERE client_id = $1`, chatgptLikeID); n != 0 {
		t.Fatalf("a refused assertion created %d grants", n)
	}

	// Replay: the same assertion twice.
	a := p.assertion(nil)
	if code, _ := p.exchange(a, nil); code != http.StatusOK {
		t.Fatalf("first use: %d", code)
	}
	if code, body := p.exchange(a, nil); code != http.StatusUnauthorized || body["error"] != "invalid_client" {
		t.Fatalf("replayed jti: %d %v", code, body)
	}
}

func TestOAuthPrivateKeyJWTKeyRotation(t *testing.T) {
	p := newPKJ(t)
	p.consentRequest()
	before := p.fetches.Load()

	// The client rotates to a new key the server has not cached yet.
	next, _ := rsa.GenerateKey(rand.Reader, 2048)
	p.jwks = append(p.jwks, rsaJWK(&next.PublicKey, "k2"))
	p.f.clock = p.f.clock.Add(jwksMinRefetch + time.Second)
	a := signJWT(t, "RS256", "k2", p.claims(), p.rs256(next))
	if code, body := p.exchange(a, nil); code != http.StatusOK {
		t.Fatalf("rotated key after refetch: %d %v", code, body)
	}
	if p.fetches.Load() <= before {
		t.Fatal("unknown kid did not trigger a refetch")
	}

	// An unknown kid that the refetch does not produce is still refused.
	a = signJWT(t, "RS256", "k9", p.claims(), p.rs256(next))
	if code, _ := p.exchange(a, nil); code != http.StatusUnauthorized {
		t.Fatalf("kid absent after refetch: %d", code)
	}

	// ES256 keys work too.
	ec, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	p.jwks = append(p.jwks, jwk{Kty: "EC", Kid: "e1", Crv: "P-256", Alg: "ES256", X: b64(pad(ec.X.Bytes(), 32)), Y: b64(pad(ec.Y.Bytes(), 32))})
	p.f.clock = p.f.clock.Add(jwksMinRefetch + time.Second)
	a = signJWT(t, "ES256", "e1", p.claims(), func(in []byte) []byte {
		sum := sha256.Sum256(in)
		r, s, _ := ecdsa.Sign(rand.Reader, ec, sum[:])
		return append(pad(r.Bytes(), 32), pad(s.Bytes(), 32)...)
	})
	if code, body := p.exchange(a, nil); code != http.StatusOK {
		t.Fatalf("ES256 assertion: %d %v", code, body)
	}
}

func pad(b []byte, n int) []byte {
	out := make([]byte, n)
	copy(out[n-len(b):], b)
	return out
}

func TestOAuthPrivateKeyJWTMetadataChecks(t *testing.T) {
	p := newPKJ(t)
	_, challenge := pkcePair()
	q := authzQuery(chatgptLikeID, challenge, ScopeRead)
	q.Set("redirect_uri", chatgptRedirect)

	// jwks_uri on a private address: the real guarded fetcher refuses it, and
	// consent fails with invalid_client.
	p.f.s.fetchJWKS = fetchClientMetadata
	doc := func(jwksURI string) {
		p.f.s.fetchCIMD = func(context.Context, string) ([]byte, error) {
			return json.Marshal(map[string]any{
				"client_id": chatgptLikeID, "client_name": "x", "redirect_uris": []string{chatgptRedirect},
				"token_endpoint_auth_method": "private_key_jwt", "jwks_uri": jwksURI,
			})
		}
	}
	for _, u := range []string{"https://127.0.0.1/jwks.json", "https://10.1.2.3/jwks.json", "https://169.254.169.254/latest"} {
		doc(u)
		rec := p.f.authorizeRequest(p.f.owner, q)
		if rec.Code != http.StatusBadRequest || decode(t, rec)["error"] != "invalid_client" || !strings.Contains(rec.Body.String(), "non-public") {
			t.Errorf("jwks_uri %s accepted: %d %s", u, rec.Code, rec.Body)
		}
	}
	// A non-https jwks_uri is refused before any fetch, even one that would work.
	fake := func(context.Context, string) ([]byte, error) { return json.Marshal(jwkSet{Keys: p.jwks}) }
	p.f.s.fetchJWKS = fake
	doc("http://fm283-chatgpt.example.test/oauth/jwks.json")
	if rec := p.f.authorizeRequest(p.f.owner, q); rec.Code != http.StatusBadRequest {
		t.Errorf("http jwks_uri accepted: %d", rec.Code)
	}
	if n := p.f.count(`SELECT count(*) FROM mcp_oauth_clients WHERE id = $1`, chatgptLikeID); n != 0 {
		t.Fatal("a client with an unusable jwks_uri was stored")
	}

	// Secret methods and missing keys are refused.
	for _, m := range []map[string]any{
		{"token_endpoint_auth_method": "client_secret_post"},
		{"token_endpoint_auth_method": "private_key_jwt"},
		{"token_endpoint_auth_method": "private_key_jwt", "jwks_uri": chatgptJWKS, "token_endpoint_auth_signing_alg": "HS256"},
	} {
		m["client_id"], m["client_name"], m["redirect_uris"] = chatgptLikeID, "x", []string{chatgptRedirect}
		p.f.s.fetchCIMD = func(context.Context, string) ([]byte, error) { return json.Marshal(m) }
		if rec := p.f.authorizeRequest(p.f.owner, q); rec.Code != http.StatusBadRequest {
			t.Errorf("metadata %v accepted: %d", m, rec.Code)
		}
	}

	// Inline jwks works.
	pub := rsaJWK(&p.rsaKey.PublicKey, "k1")
	p.f.s.fetchCIMD = func(context.Context, string) ([]byte, error) {
		return json.Marshal(map[string]any{
			"client_id": chatgptLikeID, "client_name": "inline", "redirect_uris": []string{chatgptRedirect},
			"token_endpoint_auth_method": "private_key_jwt", "jwks": jwkSet{Keys: []jwk{pub}},
		})
	}
	p.consentRequest()
	if code, body := p.exchange(p.assertion(nil), nil); code != http.StatusOK {
		t.Fatalf("inline jwks: %d %v", code, body)
	}
}
