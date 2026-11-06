package main

import (
	"crypto/sha256"
	"fmt"
	"runtime/debug"
	"strings"
	"testing"
)

func TestExtraAssetNeedsOneMatchingChecksum(t *testing.T) {
	const contents = "installer"
	line := fmt.Sprintf("%x  install.sh\n", sha256.Sum256([]byte(contents)))
	for _, test := range []struct {
		manifest string
		valid    bool
	}{{line, true}, {"", false}, {line + line, false}, {strings.Replace(line, "install.sh", "install.ps1", 1), false}, {strings.Repeat("0", 64) + "  install.sh\n", false}} {
		err := verifyExtraChecksum([]byte(test.manifest), "install.sh", strings.NewReader(contents))
		if (err == nil) != test.valid {
			t.Fatalf("manifest %q: %v", test.manifest, err)
		}
	}
}

func TestReleaseBinaryContract(t *testing.T) {
	makeInfo := func() *debug.BuildInfo {
		return &debug.BuildInfo{Path: "github.com/shreyam1008/ProtoPeek/cmd/pp", Settings: []debug.BuildSetting{{Key: "GOOS", Value: "windows"}, {Key: "GOARCH", Value: "amd64"}, {Key: "-tags", Value: "protopeek_lite"}}}
	}
	companion := []byte("pinned companion bytes")
	if err := verifyBinary(makeInfo(), []byte("lightweight binary"), companion, "pp"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name   string
		change func(*debug.BuildInfo)
		binary []byte
	}{
		{"missing tag", func(info *debug.BuildInfo) { info.Settings[2].Value = "other" }, []byte("lightweight binary")},
		{"wrong platform", func(info *debug.BuildInfo) { info.Settings[1].Value = "arm64" }, []byte("lightweight binary")},
		{"wrong command", func(info *debug.BuildInfo) { info.Path = "wrong" }, []byte("lightweight binary")},
		{"embedded archive", func(*debug.BuildInfo) {}, append([]byte("prefix"), companion...)},
	} {
		t.Run(test.name, func(t *testing.T) {
			info := makeInfo()
			test.change(info)
			if err := verifyBinary(info, test.binary, companion, "pp"); err == nil {
				t.Fatal("accepted invalid release binary")
			}
		})
	}
}
