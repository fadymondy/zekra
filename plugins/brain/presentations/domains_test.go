package presentations

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"
)

func TestNormalizeHost(t *testing.T) {
	t.Setenv("PRESENTATIONS_SHARE_BASE", "https://share.builtin.test")
	t.Setenv("PRESENTATIONS_DOMAIN_TARGET", "")
	for in, want := range map[string]string{
		"deck.acme.com":            "deck.acme.com",
		"  Deck.ACME.com. ":        "deck.acme.com",
		"acme.com":                 "acme.com",
		"xn--mgbh0fb.xn--kgbechtv": "xn--mgbh0fb.xn--kgbechtv",
		"a-b.c-d.example.io":       "a-b.c-d.example.io",
	} {
		got, err := NormalizeHost(in)
		if err != nil || got != want {
			t.Errorf("NormalizeHost(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	long := strings.Repeat("a", 60) + "." + strings.Repeat("b", 60) + "." + strings.Repeat("c", 60) + "." +
		strings.Repeat("d", 60) + ".example.com" // 256
	for _, in := range []string{
		"", " ", "https://deck.acme.com", "http://acme.com", "deck.acme.com/p", "deck.acme.com?x=1", "deck.acme.com:8443",
		"user@acme.com", "zekra.dev", "app.zekra.dev", "x.y.zekra.dev", "ZEKRA.dev", "domains.zekra.dev",
		"share.builtin.test", "localhost", "acme", "10.0.0.1", "1.2.3.4.5", "::1", "*.acme.com", "-a.acme.com",
		"a-.acme.com", "a..acme.com", ".acme.com", "ac me.com", "عرض.com", "a_b.acme.com", "deck.local",
		strings.Repeat("a", 64) + ".com", long,
	} {
		if got, err := NormalizeHost(in); err == nil {
			t.Errorf("NormalizeHost(%q) = %q, want an error", in, got)
		} else if !errors.As(err, &InvalidError{}) {
			t.Errorf("NormalizeHost(%q): %T, want InvalidError", in, err)
		}
	}
}

func TestRequestHosts(t *testing.T) {
	t.Setenv("PRESENTATIONS_SHARE_BASE", "https://share.builtin.test")
	t.Setenv("PRESENTATIONS_BUILTIN_HOSTS", "console.example.org, Other.Example.org:443")
	for in, want := range map[string]string{
		"Deck.Acme.com:443": "deck.acme.com", "deck.acme.com, proxy.internal": "deck.acme.com",
		"[::1]:8080": "::1", "deck.acme.com.": "deck.acme.com", "": "",
	} {
		if got := CleanRequestHost(in); got != want {
			t.Errorf("CleanRequestHost(%q) = %q, want %q", in, got, want)
		}
	}
	for h, want := range map[string]bool{
		"": true, "localhost": true, "127.0.0.1": true, "::1": true, "cabrain": true, "app.zekra.dev": true,
		"zekra.dev": true, "share.builtin.test": true, "console.example.org": true, "other.example.org": true,
		"deck.acme.com": false, "notzekra.dev": false, "zekra.dev.evil.com": false,
	} {
		if got := IsBuiltinHost(h); got != want {
			t.Errorf("IsBuiltinHost(%q) = %v, want %v", h, got, want)
		}
	}
}

// fakeDNS is the injectable resolver.
type fakeDNS struct {
	txt   map[string][]string
	cname map[string]string
	ips   map[string][]string
	fail  error // returned by every lookup when set
}

func nx(name string) error { return &net.DNSError{Err: "no such host", Name: name, IsNotFound: true} }

func (f *fakeDNS) LookupTXT(_ context.Context, name string) ([]string, error) {
	if f.fail != nil {
		return nil, f.fail
	}
	if v, ok := f.txt[name]; ok {
		return v, nil
	}
	return nil, nx(name)
}

func (f *fakeDNS) LookupCNAME(_ context.Context, host string) (string, error) {
	if f.fail != nil {
		return "", f.fail
	}
	if v, ok := f.cname[host]; ok {
		return v, nil
	}
	if _, ok := f.ips[host]; ok {
		return host + ".", nil // like net.LookupCNAME for a host without a CNAME
	}
	return "", nx(host)
}

func (f *fakeDNS) LookupHost(_ context.Context, host string) ([]string, error) {
	if f.fail != nil {
		return nil, f.fail
	}
	if v, ok := f.ips[host]; ok {
		return v, nil
	}
	return nil, nx(host)
}

func TestVerifyDomain(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	t.Setenv("PRESENTATIONS_DOMAIN_TARGET", "edge.zekra.test")
	host := "deck." + testNS + ".example.com"
	t.Cleanup(func() { _, _ = testDB.Exec(`DELETE FROM presentation_domains WHERE namespace LIKE $1`, testNS+"%") })

	dom, err := s.AddDomain(ctx, testNS, strings.ToUpper(host), "owner")
	if err != nil {
		t.Fatal(err)
	}
	if dom.Host != host || dom.Verified || dom.Default || dom.VerifyRecord.Type != "TXT" ||
		dom.VerifyRecord.Name != "_zekra-verify."+host || !strings.HasPrefix(dom.VerifyRecord.Value, "zekra-verify=") ||
		dom.CNAME.Name != host || dom.CNAME.Target != "edge.zekra.test" {
		t.Fatalf("added: %+v", dom)
	}
	if again, err := s.AddDomain(ctx, testNS, host, "owner"); err != nil || again.ID != dom.ID || again.VerifyRecord.Value != dom.VerifyRecord.Value {
		t.Fatalf("adding twice must return the same row: %+v %v", again, err)
	}
	token := dom.VerifyRecord.Value
	dns := &fakeDNS{txt: map[string][]string{}, cname: map[string]string{}, ips: map[string][]string{"edge.zekra.test": {"203.0.113.7"}}}
	s.Resolver = dns

	check := func(name string, wantVerified bool, wantErr string) *Domain {
		t.Helper()
		got, err := s.VerifyDomain(ctx, dom.ID)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got.Verified != wantVerified || !strings.Contains(got.LastError, wantErr) || (wantErr == "") != (got.LastError == "") || got.LastChecked == nil {
			t.Fatalf("%s: verified=%v lastError=%q, want %v / %q", name, got.Verified, got.LastError, wantVerified, wantErr)
		}
		return got
	}

	check("no records", false, "no TXT record")
	dns.txt["_zekra-verify."+host] = []string{"zekra-verify=somethingelse"}
	dns.cname[host] = "edge.zekra.test."
	check("wrong TXT", false, "does not hold the expected value")
	if _, err := s.SetDefaultDomain(ctx, dom.ID, true); err == nil {
		t.Fatal("an unverified domain became the default")
	}

	dns.txt["_zekra-verify."+host] = []string{"v=spf1 -all", token}
	dns.cname[host] = "someone-else.example.net."
	dns.ips[host] = []string{"198.51.100.9"}
	check("wrong CNAME", false, "must point to edge.zekra.test")
	delete(dns.cname, host)
	check("wrong A", false, "does not point to edge.zekra.test")

	dns.cname[host] = "EDGE.zekra.test."
	got := check("cname ok", true, "")
	if got.VerifiedAt == nil {
		t.Fatal("verified_at not stored")
	}
	delete(dns.cname, host) // an apex/ALIAS: same address as the target
	dns.ips[host] = []string{"198.51.100.9", "203.0.113.7"}
	check("same A as the target", true, "")

	// DNS itself failing disproves nothing: the domain stays verified.
	dns.fail = &net.DNSError{Err: "server misbehaving", IsTemporary: true}
	check("transient", true, "try again")
	dns.fail = nil

	// A verified host is one brain's: another brain cannot claim or verify it.
	if _, err := s.AddDomain(ctx, testNS+"-other", host, "x"); !errors.Is(err, ErrDomainTaken) {
		t.Fatalf("second brain claimed a verified host: %v", err)
	}
	if ns, ok := s.VerifiedHostNamespace(ctx, strings.ToUpper(host)+":443"); !ok || ns != testNS {
		t.Fatalf("VerifiedHostNamespace = %q %v", ns, ok)
	}

	// Default, then DNS is taken away: unverified, and no longer the default.
	if d, err := s.SetDefaultDomain(ctx, dom.ID, true); err != nil || !d.Default {
		t.Fatalf("default: %+v %v", d, err)
	}
	dns.ips[host] = []string{"198.51.100.9"}
	if got := check("lapsed", false, "does not point"); got.Default {
		t.Fatal("an unverified domain stayed the default")
	}
	if _, ok := s.VerifiedHostNamespace(ctx, host); ok {
		t.Fatal("a lapsed host still counts as verified")
	}
}

func TestShareDomains(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	t.Setenv("PRESENTATIONS_DOMAIN_TARGET", "edge.zekra.test")
	t.Cleanup(func() { _, _ = testDB.Exec(`DELETE FROM presentation_domains WHERE namespace LIKE $1`, testNS+"%") })
	dns := &fakeDNS{txt: map[string][]string{}, cname: map[string]string{}, ips: map[string][]string{"edge.zekra.test": {"203.0.113.7"}}}
	s.Resolver = dns
	link := func(ns, host string, verify bool) *Domain {
		t.Helper()
		d, err := s.AddDomain(ctx, ns, host, "owner")
		if err != nil {
			t.Fatal(err)
		}
		if verify {
			dns.txt[d.VerifyRecord.Name] = []string{d.VerifyRecord.Value}
			dns.cname[host] = "edge.zekra.test."
			if d, err = s.VerifyDomain(ctx, d.ID); err != nil || !d.Verified {
				t.Fatalf("verify %s: %+v %v", host, d, err)
			}
		}
		return d
	}
	hostA, hostB := "a."+testNS+".example.com", "b."+testNS+".example.com"
	a := link(testNS, hostA, true)
	b := link(testNS, hostB, true)
	pending := link(testNS, "pending."+testNS+".example.com", false)
	foreign := link(testNS+"-other", "f."+testNS+".example.com", true)
	doc := create(t, s, KindDeck)

	// No default yet: the built-in base.
	plain, err := s.CreateShare(ctx, doc.ID, PresentationShareInput{}, "owner")
	if err != nil || plain.URL != "https://site.test/en/p/"+plain.Token || plain.Share.Domain != "site.test" || plain.Share.DomainID != "" {
		t.Fatalf("plain: %+v %v", plain, err)
	}
	// Pinned by id, and by host.
	onA, err := s.CreateShare(ctx, doc.ID, PresentationShareInput{DomainID: a.ID, Label: "a", ExpiresInDays: 9}, "owner")
	if err != nil || onA.URL != "https://"+hostA+"/en/p/"+onA.Token || onA.Share.URL != onA.URL || onA.Share.Domain != hostA || onA.Share.DomainID != a.ID {
		t.Fatalf("pinned: %+v %v", onA, err)
	}
	if byHost, err := s.CreateShare(ctx, doc.ID, PresentationShareInput{Domain: strings.ToUpper(hostB)}, "owner"); err != nil || byHost.Share.DomainID != b.ID {
		t.Fatalf("by host: %+v %v", byHost, err)
	}
	for name, id := range map[string]string{"unverified": pending.ID, "another brain's": foreign.ID, "unknown": "nope"} {
		if _, err := s.CreateShare(ctx, doc.ID, PresentationShareInput{DomainID: id}, "owner"); !errors.As(err, &InvalidError{}) {
			t.Errorf("a share on an %s domain: %v", name, err)
		}
	}

	urlOf := func(shareID string) string {
		t.Helper()
		sh, err := s.share(ctx, doc.ID, shareID)
		if err != nil {
			t.Fatal(err)
		}
		if !sh.Recoverable || sh.Hint == "" || sh.Locale != "en" {
			t.Fatalf("share fields: %+v", sh)
		}
		return sh.URL
	}
	// The brain's default applies to unpinned links; pinned ones keep their host.
	if _, err := s.SetDefaultDomain(ctx, b.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := urlOf(plain.Share.ID); got != "https://"+hostB+"/en/p/"+plain.Token {
		t.Errorf("default domain: %s", got)
	}
	if got := urlOf(onA.Share.ID); got != onA.URL {
		t.Errorf("pinned link moved: %s", got)
	}
	if d, _ := s.SetDefaultDomain(ctx, a.ID, true); d == nil || !d.Default {
		t.Fatal("moving the default failed")
	}
	if list, _ := s.ListDomains(ctx, testNS); len(list) != 3 || list[0].ID != a.ID || list[1].Default {
		t.Fatalf("one default, listed first: %+v", list)
	}

	// Deleting a domain keeps its links, which fall back: default, then built-in.
	if err := s.DeleteDomain(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if got := urlOf(onA.Share.ID); got != "https://site.test/en/p/"+onA.Token {
		t.Errorf("after delete: %s", got)
	}
	if _, err := s.OpenShared(ctx, onA.Token, "", ""); err != nil {
		t.Errorf("the link died with its domain: %v", err)
	}

	// Host isolation.
	for host, want := range map[string]bool{
		"": true, "site.test": true, "app.zekra.dev": true, hostB: true, strings.ToUpper(hostB) + ":443": true,
		foreign.Host: false, pending.Host: false, hostA: false, "unknown.example.org": false,
	} {
		_, err := s.OpenSharedOn(ctx, host, plain.Token, "", "")
		if (err == nil) != want {
			t.Errorf("open on %q: %v, want ok=%v", host, err, want)
		}
		if err != nil && !errors.Is(err, ErrLinkUnavailable) {
			t.Errorf("open on %q: %v, want ErrLinkUnavailable", host, err)
		}
	}
}

func TestUpdateAndReissueShare(t *testing.T) {
	s := setup(t)
	ctx := context.Background()
	doc := create(t, s, KindReport)
	made, err := s.CreateShare(ctx, doc.ID, PresentationShareInput{Label: "first", ExpiresInDays: 3}, "owner")
	if err != nil {
		t.Fatal(err)
	}
	str := func(v string) *string { return &v }
	num := func(v int) *int { return &v }

	got, err := s.UpdateShare(ctx, doc.ID, made.Share.ID, PresentationSharePatch{Label: str("  renamed ")})
	if err != nil || got.Label != "renamed" || got.ExpiresAt == nil || got.URL != made.URL {
		t.Fatalf("label: %+v %v", got, err)
	}
	if got, err = s.UpdateShare(ctx, doc.ID, made.Share.ID, PresentationSharePatch{ExpiresInDays: num(0)}); err != nil || got.ExpiresAt != nil || got.Label != "renamed" {
		t.Fatalf("never: %+v %v", got, err)
	}
	at := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Second)
	if got, err = s.UpdateShare(ctx, doc.ID, made.Share.ID, PresentationSharePatch{ExpiresAt: str(at.Format(time.RFC3339))}); err != nil || got.ExpiresAt == nil || !got.ExpiresAt.Equal(at) {
		t.Fatalf("expires_at: %+v %v", got, err)
	}
	for name, p := range map[string]PresentationSharePatch{
		"empty": {}, "past": {ExpiresAt: str("2001-01-01T00:00:00Z")}, "not a time": {ExpiresAt: str("tomorrow")},
		"days": {ExpiresInDays: num(4000)}, "long label": {Label: str(strings.Repeat("x", 81))}, "domain": {DomainID: str("nope")},
	} {
		if _, err := s.UpdateShare(ctx, doc.ID, made.Share.ID, p); !errors.As(err, &InvalidError{}) {
			t.Errorf("%s: %v, want InvalidError", name, err)
		}
	}
	other := create(t, s, KindDeck)
	if _, err := s.UpdateShare(ctx, other.ID, made.Share.ID, PresentationSharePatch{Label: str("x")}); !errors.Is(err, ErrNotFound) {
		t.Errorf("another document's link: %v", err)
	}

	// An imported link: sealed with a key this server does not have.
	if _, err := testDB.Exec(`UPDATE presentation_shares SET token_sealed = 'vault:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' WHERE id = $1`, made.Share.ID); err != nil {
		t.Fatal(err)
	}
	if sh, _ := s.share(ctx, doc.ID, made.Share.ID); sh == nil || sh.Recoverable || sh.URL != "" || !sh.Active {
		t.Fatalf("an unopenable link must be active, not recoverable, without url: %+v", sh)
	}
	re, err := s.ReissueShare(ctx, doc.ID, made.Share.ID, "owner")
	if err != nil {
		t.Fatal(err)
	}
	if re.Token == made.Token || re.Share.ID == made.Share.ID || re.URL != "https://site.test/en/p/"+re.Token || !re.Recoverable ||
		re.Share.Label != "renamed" || re.Share.Locale != "en" || re.Share.ExpiresAt == nil || !re.Share.ExpiresAt.Equal(at) || !re.Share.Active {
		t.Fatalf("reissued: %+v", re)
	}
	if _, err := s.OpenShared(ctx, made.Token, "", ""); !errors.Is(err, ErrLinkUnavailable) {
		t.Errorf("the old token still opens: %v", err)
	}
	if _, err := s.OpenShared(ctx, re.Token, "", ""); err != nil {
		t.Errorf("the new token does not open: %v", err)
	}
	if _, err := s.ReissueShare(ctx, doc.ID, made.Share.ID, "owner"); !errors.As(err, &InvalidError{}) {
		t.Errorf("reissuing a revoked link: %v", err)
	}
	if _, err := s.UpdateShare(ctx, doc.ID, made.Share.ID, PresentationSharePatch{Label: str("x")}); !errors.Is(err, ErrNotFound) {
		t.Errorf("editing a revoked link: %v", err)
	}
	if _, err := s.ReissueShare(ctx, other.ID, re.Share.ID, "owner"); !errors.Is(err, ErrNotFound) {
		t.Errorf("reissue through another document: %v", err)
	}
}
