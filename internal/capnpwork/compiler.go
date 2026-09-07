package capnpwork

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type SourceFile struct {
	Path   string `json:"path"`
	Source string `json:"source"`
}
type CompilerStatus struct {
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

func CompilerCapability() CompilerStatus {
	binary, err := exec.LookPath("capnp")
	if err != nil {
		return CompilerStatus{Reason: "Install the official capnp compiler to load source files, or import a compiled schema (.bin). RPC calls use the built-in Go runtime."}
	}
	return CompilerStatus{Available: true, Path: binary}
}

func Compile(ctx context.Context, root string, files []SourceFile) ([]byte, error) {
	if err := validateSources(root, files); err != nil {
		return nil, err
	}
	capability := CompilerCapability()
	if !capability.Available {
		return nil, errors.New(capability.Reason)
	}
	return compileWith(ctx, capability.Path, root, files)
}

func compileWith(parent context.Context, binary, root string, files []SourceFile) ([]byte, error) {
	if err := validateSources(root, files); err != nil {
		return nil, err
	}
	directory, err := os.MkdirTemp("", "protopeek-capnp-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(directory)
	for _, file := range files {
		destination := filepath.Join(directory, filepath.FromSlash(file.Path))
		if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			return nil, err
		}
		if err := os.WriteFile(destination, []byte(file.Source), 0600); err != nil {
			return nil, err
		}
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "compile", "--no-standard-import", "-I"+directory, "--src-prefix="+directory, "-o-", filepath.Join(directory, filepath.FromSlash(root)))
	command.Dir = directory
	command.WaitDelay = time.Second
	hideCompiler(command)
	output, diagnostics := &boundedBuffer{max: MaxSchemaBytes}, &boundedBuffer{max: 16 << 10}
	command.Stdout, command.Stderr = output, diagnostics
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		detail := strings.ReplaceAll(diagnostics.data.String(), directory, "<schema>")
		return nil, fmt.Errorf("schema compilation failed: %.2048s (%v)", detail, err)
	}
	return append([]byte(nil), output.data.Bytes()...), nil
}

func safeSourcePath(name string) bool {
	if len(name) == 0 || len(name) > 160 || !strings.HasSuffix(name, ".capnp") || name != path.Clean(name) || strings.HasPrefix(name, "/") || strings.HasPrefix(name, "../") {
		return false
	}
	for _, c := range name {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("_-./", c)) {
			return false
		}
	}
	for _, component := range strings.Split(name, "/") {
		base := strings.ToUpper(strings.SplitN(component, ".", 2)[0])
		if component == "." || component == ".." || strings.HasSuffix(component, ".") || base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9' {
			return false
		}
	}
	return true
}

func validateSources(root string, files []SourceFile) error {
	if len(files) == 0 || len(files) > 32 {
		return errors.New("upload 1–32 schema source files")
	}
	names := map[string]bool{}
	total := 0
	for _, file := range files {
		total += len(file.Source)
		if !safeSourcePath(file.Path) || names[strings.ToLower(file.Path)] || !utf8.ValidString(file.Source) || strings.ContainsRune(file.Source, 0) || total > 512<<10 {
			return errors.New("schema sources require distinct portable relative .capnp paths and at most 512 KiB of UTF-8 text")
		}
		names[strings.ToLower(file.Path)] = true
	}
	if !safeSourcePath(root) || !names[strings.ToLower(root)] {
		return errors.New("choose an uploaded .capnp root file")
	}
	for _, file := range files {
		imports, err := sourceImports(file.Source)
		if err != nil {
			return err
		}
		for _, imported := range imports {
			name := path.Join(path.Dir(file.Path), imported)
			if strings.HasPrefix(imported, "/") {
				name = strings.TrimPrefix(imported, "/")
			}
			if strings.ContainsAny(imported, "\\:\x00") || !safeSourcePath(name) || !names[strings.ToLower(name)] {
				return fmt.Errorf("%s imports %q: upload that schema within this source set; host filesystem imports are not allowed", file.Path, imported)
			}
		}
	}
	return nil
}

// Inspect only import/embedded-file directives outside quoted text and Cap'n
// Proto # comments. The official compiler remains the language parser.
func sourceImports(source string) ([]string, error) {
	imports := []string{}
	wantImport := false
	for i := 0; i < len(source); {
		c := source[i]
		if c == '#' {
			for i < len(source) && source[i] != '\n' {
				i++
			}
			continue
		}
		if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
			i++
			continue
		}
		if c == '"' {
			start := i
			i++
			closed := false
			for i < len(source) {
				if source[i] == '\\' {
					i += 2
					continue
				}
				if source[i] == '"' {
					i++
					closed = true
					break
				}
				i++
			}
			if !closed {
				return nil, errors.New("unterminated schema string")
			}
			if wantImport {
				name, err := strconv.Unquote(source[start:i])
				if err != nil {
					return nil, errors.New("invalid schema import string")
				}
				imports = append(imports, name)
				wantImport = false
			}
			continue
		}
		if wantImport {
			return nil, errors.New("schema import must use a quoted uploaded path")
		}
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '_' {
			start := i
			for i < len(source) && (source[i] >= 'a' && source[i] <= 'z' || source[i] >= 'A' && source[i] <= 'Z' || source[i] >= '0' && source[i] <= '9' || source[i] == '_') {
				i++
			}
			word := source[start:i]
			if word == "embed" {
				return nil, errors.New("embedded filesystem data is not supported; provide schema source files only")
			}
			wantImport = word == "import"
			continue
		}
		i++
	}
	if wantImport {
		return nil, errors.New("schema import path is missing")
	}
	return imports, nil
}
