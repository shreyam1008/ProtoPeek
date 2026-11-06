//go:build !protopeek_lite

package bundledaria2

import _ "embed"

// Unmodified upstream aria2 release-1.37.0 / win-64bit-build1 archive.
//
//go:embed assets/aria2-1.37.0-win-64bit-build1.zip
var windowsAMD64Archive []byte

var nativeBundle = bundle{
	archive:    windowsAMD64Archive,
	archiveSHA: windowsArchiveSHA,
	binarySHA:  windowsBinarySHA,
	prefix:     "aria2-1.37.0-win-64bit-build1/",
	binary:     "aria2c.exe",
}

func loadNativeBundle() (bundle, error) { return nativeBundle, nil }
