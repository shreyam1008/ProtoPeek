package standalone

import "testing"

func TestWorkspaceManagerDisconnectRemovesSession(t *testing.T) {
	t.Parallel()

	manager := NewWorkspaceManager(WorkspaceManagerOptions{})
	manager.sessions["session"] = &workspaceSession{id: "session"}
	if !manager.Disconnect("session") {
		t.Fatal("Disconnect returned false for a known session")
	}
	if _, ok := manager.Session("session"); ok {
		t.Fatal("session remains available after disconnect")
	}
	if manager.Disconnect("session") {
		t.Fatal("Disconnect returned true for an unknown session")
	}
}
