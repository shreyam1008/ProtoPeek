package cli

import (
	runtimeDebug "runtime/debug"
	"strings"
)

const unsetBuildVersion = "dev build <no version set>"

// ResolveBuildVersion keeps release linker metadata authoritative and falls
// back to Go module build information for `go install module/cmd@version`.
func ResolveBuildVersion(linkedVersion string) string {
	moduleVersion := ""
	if info, ok := runtimeDebug.ReadBuildInfo(); ok {
		moduleVersion = info.Main.Version
	}
	return resolveBuildVersion(linkedVersion, moduleVersion)
}

func resolveBuildVersion(linkedVersion, moduleVersion string) string {
	linkedVersion = strings.TrimSpace(linkedVersion)
	if linkedVersion != "" && linkedVersion != unsetBuildVersion {
		return linkedVersion
	}
	moduleVersion = strings.TrimSpace(moduleVersion)
	if moduleVersion != "" && moduleVersion != "(devel)" {
		return moduleVersion
	}
	if linkedVersion != "" {
		return linkedVersion
	}
	return unsetBuildVersion
}
