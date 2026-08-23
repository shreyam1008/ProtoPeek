// Package transfer provides ProtoPeek's host-side transfer service.
//
// The package deliberately depends on an aria2c executable installed by the
// user or selected in host configuration. ProtoPeek does not embed or
// redistribute aria2c.
//
// The aria2 JSON-RPC mapping and parts of the process-lifecycle design are
// adapted from GoBarryGo (github.com/shreyam1008/gobarrygo, commit
// e031ac7fd936c43644a09dfeccba27bd3da74858) under its MIT license. The Wails
// shell, bundled executable lookup, and file-deletion behavior are not carried
// over.
package transfer
