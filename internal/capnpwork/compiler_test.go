package capnpwork

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCompilerInputCannotImportHostFiles(t *testing.T) {
	for _, source := range []string{
		`using X = import "../../outside.capnp";`,
		`using X = import "/outside.capnp";`,
		`using X = import "C:/outside.capnp";`,
		`using X = import "..\\outside.capnp";`,
		`const secret :Text = embed "private.txt";`,
		`using X = import "\x2e\x2e/outside.capnp";`,
		`using X = import`,
	} {
		if err := validateSources("root.capnp", []SourceFile{{Path: "root.capnp", Source: source}}); err == nil {
			t.Fatalf("accepted %s", source)
		}
	}
	files := []SourceFile{{Path: "root.capnp", Source: "# import \"outside.capnp\"\nusing X = import \"nested/child.capnp\";\nconst note :Text = \"embed outside import\";"}, {Path: "nested/child.capnp", Source: `using X = import "../root.capnp";`}}
	if err := validateSources("root.capnp", files); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"../root.capnp", "/root.capnp", "CON.capnp", "folder/NUL.capnp", "root.capnp:stream", "root./x.capnp"} {
		if safeSourcePath(bad) {
			t.Fatalf("accepted %s", bad)
		}
	}
}

func TestOfficialCompilerSourceImport(t *testing.T) {
	binary := os.Getenv("PROTOPEEK_CAPNP_COMPILER")
	if binary == "" {
		t.Skip("set PROTOPEEK_CAPNP_COMPILER for real compiler integration")
	}
	binary, err := filepath.Abs(binary)
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile("testdata/workbench.capnp")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := compileWith(context.Background(), binary, "workbench.capnp", []SourceFile{{Path: "workbench.capnp", Source: string(source)}})
	if err != nil {
		t.Fatal(err)
	}
	s, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	description, err := s.Describe()
	if err != nil || len(description.Methods) != 4 {
		t.Fatalf("%+v %v", description, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := compileWith(ctx, binary, "workbench.capnp", []SourceFile{{Path: "workbench.capnp", Source: string(source)}}); err == nil {
		t.Fatal("ignored cancellation")
	}
}
