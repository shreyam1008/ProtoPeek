package netpath

// NewNativeBackend returns the built-in backend for the running operating
// system. Unsupported platforms report unavailable capabilities; ProtoPeek
// never shells out, installs a tool, or requests elevation.
func NewNativeBackend() Backend {
	return newPlatformBackend()
}
