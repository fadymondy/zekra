package schema

import (
	"strings"
	"testing"
)

func TestAddRole(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"", "admin"},
		{"editor", "editor,admin"},
		{"admin", "admin"},
		{"editor, admin", "editor, admin"},
	} {
		if got := AddRole(tc.in, "admin"); got != tc.want {
			t.Errorf("AddRole(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestAdminEmails(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", " Fady@Example.com , ,ops@zekra.dev")
	if got := strings.Join(AdminEmails(), "|"); got != "fady@example.com|ops@zekra.dev" {
		t.Errorf("AdminEmails = %q", got)
	}
}

func TestDDLIsIdempotentAndUnqualified(t *testing.T) {
	for _, stmt := range strings.Split(SQL(), ";") {
		s := strings.TrimSpace(stmt)
		for strings.HasPrefix(s, "--") { // drop leading comment lines
			if i := strings.IndexByte(s, '\n'); i >= 0 {
				s = strings.TrimSpace(s[i+1:])
			} else {
				s = ""
			}
		}
		if s == "" {
			continue
		}
		if !strings.Contains(s, "IF NOT EXISTS") {
			t.Errorf("not idempotent: %.60s", s)
		}
		if strings.Contains(s, "public.") || strings.Contains(s, "zekra_auth.") {
			t.Errorf("schema-qualified (must follow search_path): %.60s", s)
		}
	}
}
