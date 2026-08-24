//go:build linux

package thispc

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLinuxSystemParsersUseExactStrings(t *testing.T) {
	t.Parallel()
	uptime, err := parseProcUptime("9007199254740993.25 10.00\n")
	if err != nil || uptime != "9007199254740993" {
		t.Fatalf("uptime = %q, %v", uptime, err)
	}
	total, available, notes := parseProcMeminfo("MemTotal: 9007199254740 kB\nMemAvailable: 123 kB\n")
	if total != "9223372036853760" || available != "125952" || len(notes) != 0 {
		t.Fatalf("memory = total %q available %q notes %v", total, available, notes)
	}
}

func TestLinuxSystemParsersRejectMalformedAndOverflow(t *testing.T) {
	t.Parallel()
	for _, input := range []string{"", "-1.0 2.0", "1e3 2.0", "1. 2.0", "1.0", "18446744073709551616.0 1.0", "1.0 nope"} {
		if _, err := parseProcUptime(input); err == nil {
			t.Errorf("parseProcUptime(%q) unexpectedly succeeded", input)
		}
	}
	total, available, notes := parseProcMeminfo("MemTotal: 18446744073709551615 kB\nMemAvailable: nope kB\n")
	if total != "" || available != "" || len(notes) != 2 {
		t.Fatalf("overflow memory = total %q available %q notes %v", total, available, notes)
	}
	total, _, notes = parseProcMeminfo("MemTotal: 1 kB\nMemTotal: 2 kB\nMemAvailable: 1 kB\n")
	if total != "" || len(notes) == 0 {
		t.Fatalf("duplicate MemTotal accepted: total=%q notes=%v", total, notes)
	}
}

func TestReadBoundedFileRejectsOversize(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "bounded")
	if err := os.WriteFile(path, []byte(strings.Repeat("x", 17)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readBoundedFile(path, 16); !errors.Is(err, errProcFileTooLarge) {
		t.Fatalf("readBoundedFile() error = %v", err)
	}
}
