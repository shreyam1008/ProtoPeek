package bundledaria2

import _ "embed"

// Unmodified upstream aria2 release-1.37.0 / win-64bit-build1 archive.
//
//go:embed assets/aria2-1.37.0-win-64bit-build1.zip
var windowsAMD64Archive []byte

var nativeBundle = bundle{
	archive:    windowsAMD64Archive,
	archiveSHA: "67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288",
	binarySHA:  "be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2",
	prefix:     "aria2-1.37.0-win-64bit-build1/",
	binary:     "aria2c.exe",
}
