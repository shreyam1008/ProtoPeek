//go:build windows

package transfer

// Windows does not expose portable directory fsync semantics through os.File.
// Atomic replacement still protects readers from partial files there.
func syncDirectory(string) error {
	return nil
}
