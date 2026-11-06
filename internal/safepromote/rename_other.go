//go:build !windows && !darwin && !linux

package safepromote

func Rename(string, string) error {
	return ErrUnsupported
}
