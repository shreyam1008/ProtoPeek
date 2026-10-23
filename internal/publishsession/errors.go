package publishsession

import "errors"

// publicError contains only fixed user guidance, never native output, paths or
// request values. Keep construction private to this package.
type publicError string

func (err publicError) Error() string { return string(err) }

// PublicErrorMessage exposes reviewed publishing guidance while unexpected
// implementation or injected-provider errors remain private to the host.
func PublicErrorMessage(err error) (string, bool) {
	var safe publicError
	if !errors.As(err, &safe) {
		return "", false
	}
	return string(safe), true
}
