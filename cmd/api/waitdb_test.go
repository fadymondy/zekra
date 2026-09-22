package main

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// MH-325: the readiness probe tested ZEKRA_DATABASE_URL while the kernel used
// DATABASE_URL, so a stale alias stalled every boot for 90s.
func TestReadinessProbesTheKernelsDSN(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://app@db:5432/zekra")
	t.Setenv("ZEKRA_DATABASE_URL", "postgres://stale@db:5432/zekra")
	if got := readinessDSN(); got != "postgres://app@db:5432/zekra" {
		t.Fatalf("probe uses %q, want the kernel's DATABASE_URL", got)
	}
}

func TestFatalDBErrorsAreNotRetried(t *testing.T) {
	for code, fatal := range map[string]bool{
		"28P01": true,  // invalid_password
		"28000": true,  // invalid_authorization_specification
		"3D000": true,  // invalid_catalog_name (database does not exist)
		"57P03": false, // cannot_connect_now (still starting) — worth waiting for
		"53300": false, // too_many_connections — transient
	} {
		err := fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: code})
		if got := fatalDBError(err); got != fatal {
			t.Errorf("%s: fatal=%v, want %v", code, got, fatal)
		}
	}
	if fatalDBError(errors.New("dial tcp: connection refused")) {
		t.Error("a network error must stay retryable")
	}
}

// Against a real server: a wrong password must end the wait at once, not after 90s.
func TestWrongPasswordDoesNotStallTheBoot(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL")
	}
	u, err := url.Parse(dsn)
	if err != nil || u.User == nil {
		t.Skip("TEST_DATABASE_URL has no user")
	}
	u.User = url.UserPassword(u.User.Username(), "definitely-not-the-password")
	t.Setenv("DATABASE_URL", u.String())
	start := time.Now()
	waitForDatabase()
	if el := time.Since(start); el > 10*time.Second {
		t.Fatalf("waited %v on an authentication failure", el)
	}
}
