package publishsession

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestPublicErrorMessagePreservesProviderGuidanceWithoutNativeDetails(t *testing.T) {
	s, starts := fixture(t)
	s.find = func(string) (string, error) {
		return "", errors.New("private native lookup diagnostic C:\\Users\\secret\\cloudflared.exe")
	}
	_, err := s.Preview(context.Background(), request("quick"))
	message, ok := PublicErrorMessage(fmt.Errorf("private wrapper: %w", err))
	if !ok || message != "cloudflared is unavailable; install the official client and review again" || starts.Load() != 0 {
		t.Fatalf("public guidance=%q allowed=%v starts=%d", message, ok, starts.Load())
	}
	if strings.Contains(message, "private") {
		t.Fatal("native details entered public guidance")
	}
	if message, ok := PublicErrorMessage(errors.New("raw process output with secret")); ok || message != "" {
		t.Fatal("unmarked implementation error was exposed")
	}
}
