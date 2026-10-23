//go:build !linux

package publishsession

func validatePublishingExecutable(path, _ string) (string, error) { return path, nil }
