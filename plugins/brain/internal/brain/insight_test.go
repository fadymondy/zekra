package brain

import (
	"testing"
	"time"
)

func TestParseSince(t *testing.T) {
	now := time.Now()
	for in, want := range map[string]time.Duration{"7d": 7 * 24 * time.Hour, "36h": 36 * time.Hour} {
		got := parseSince(in)
		if got == nil || now.Sub(*got)-want > time.Minute || want-now.Sub(*got) > time.Minute {
			t.Fatalf("parseSince(%q) = %v", in, got)
		}
	}
	if got := parseSince("2026-10-01T00:00:00Z"); got == nil || got.Day() != 1 {
		t.Fatalf("RFC3339 = %v", got)
	}
	if parseSince("") != nil || parseSince("soon") != nil {
		t.Fatal("bad input should be ignored")
	}
}
