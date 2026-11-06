package safepromote

import "errors"

var ErrUnsupported = errors.New("filesystem does not support safe atomic promotion")
