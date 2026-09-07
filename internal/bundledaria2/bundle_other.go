//go:build !windows || !amd64

package bundledaria2

// Other targets continue to use a configured or PATH engine until their native
// payloads and source-distribution recipes have been validated.
var nativeBundle bundle
