//go:build !windows

package portscan

func platformConnectionRefused(error) bool { return false }
