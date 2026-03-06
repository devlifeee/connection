package tests

import (
	"os"
	"testing"
)

// Placeholder for end-to-end tests.
// Skips by default; run with NHEX_E2E=1 to enable in CI or locally.
func TestE2ESmoke(t *testing.T) {
	if os.Getenv("NHEX_E2E") != "1" {
		t.Skip("set NHEX_E2E=1 to run e2e smoke tests")
	}
	// Future: spin up two runtimes, send chat via HTTP, assert /chat/history, test outbox and relay.
}

