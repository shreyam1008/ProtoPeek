// Package transfer provides ProtoPeek's host-side transfer service.
//
// A configured aria2c or PATH executable takes precedence. Windows amd64 builds
// include a checksum-pinned companion extracted only when Downloader starts.
// Other platforms still require a separately installed engine.
//
// The aria2 JSON-RPC mapping and parts of the process-lifecycle design are
// adapted from GoBarryGo (github.com/shreyam1008/gobarrygo, commit
// e031ac7fd936c43644a09dfeccba27bd3da74858) under its MIT license. The Wails
// shell and file-deletion behavior are not carried over. Companion extraction
// is implemented separately with checksum verification and atomic writes.
package transfer
