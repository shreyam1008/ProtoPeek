//go:build !windows || !amd64 || !protopeek_lite

package bundledaria2

import "context"

func ManagedDownload() (string, int64, bool) { return "", 0, false }
func InstallManaged(context.Context) error   { return ErrCompanionMissing }
func checkManagedArchive() error             { return nil }
func removeManagedArchive() error            { return nil }
