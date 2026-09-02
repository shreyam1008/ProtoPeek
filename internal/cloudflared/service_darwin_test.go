//go:build darwin

package cloudflared

import (
	"strings"
	"testing"
)

func TestLoadedLaunchdStartGuidanceUsesKickstart(t *testing.T) {
	t.Parallel()
	observed := ServiceObservation{
		actionTarget:   "system/com.cloudflare.cloudflared",
		definitionPath: "/Library/LaunchDaemons/com.cloudflare.cloudflared.plist",
		loaded:         true,
		State:          "stopped",
	}
	command, _ := canonicalManualServiceAction(ServiceActionStart, observed)
	if command != "sudo /bin/launchctl kickstart system/com.cloudflare.cloudflared" {
		t.Fatalf("loaded start guidance=%q", command)
	}
	if strings.Contains(command, "bootstrap") {
		t.Fatalf("loaded target received bootstrap guidance: %q", command)
	}
}

func TestUnloadedLaunchdRestartGuidanceUsesBootstrap(t *testing.T) {
	t.Parallel()
	observed := ServiceObservation{
		actionTarget:   "gui/501/com.cloudflare.cloudflared",
		definitionPath: "/Users/test/Library/LaunchAgents/com.cloudflare.cloudflared.plist",
		loaded:         false,
		State:          "stopped",
	}
	command, _ := canonicalManualServiceAction(ServiceActionRestart, observed)
	if !strings.Contains(command, "/bin/launchctl bootstrap gui/501 ") || strings.Contains(command, "sudo ") {
		t.Fatalf("unloaded restart guidance=%q", command)
	}
}

func TestLaunchdPlistArgumentsRemainStructuredForRedaction(t *testing.T) {
	t.Parallel()
	label, program, arguments, err := parseLaunchdPlist([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Label</key><string>com.cloudflare.cloudflared</string>
<key>Program</key><string>/opt/homebrew/bin/cloudflared</string>
<key>ProgramArguments</key><array><string>/opt/homebrew/bin/cloudflared</string><string>tunnel</string><string>run</string><string>--token</string><string>invalid-secret-token</string></array>
</dict></plist>`))
	if err != nil || label != canonicalLaunchdLabel || program != "/opt/homebrew/bin/cloudflared" || len(arguments) != 5 {
		t.Fatalf("label=%q program=%q arguments=%#v err=%v", label, program, arguments, err)
	}
	observed := observationFromArgs("launchd", canonicalLaunchdLabel, arguments)
	if strings.Contains(observed.CredentialSource, "invalid-secret-token") || observed.CredentialSource != "literal tunnel token (redacted)" {
		t.Fatalf("launchd token was not redacted: %#v", observed)
	}
}
