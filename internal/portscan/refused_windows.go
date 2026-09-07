package portscan

import (
	"errors"
	"golang.org/x/sys/windows"
)

func platformConnectionRefused(err error) bool { return errors.Is(err, windows.WSAECONNREFUSED) }
