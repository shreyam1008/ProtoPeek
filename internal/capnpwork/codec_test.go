package capnpwork

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/std/capnp/schema"
)

const exampleJSON = `{"enabled":false,"signed":"-9223372036854775808","unsigned":"18446744073709551615","ratio":-2.25,"mode":"failed","text":"Hello 世界","data":"cmF3IGJ5dGVz","child":{"label":"nested","count":7},"flags":[true,false],"numbers":[-1,0,2147483647],"names":["one","two"],"children":[{"label":"first","count":1}],"matrix":[[1,65535],[]],"selection":"chosen","details":{"note":"group","amount":255}}`

func fixtureSchema(t *testing.T) (*Schema, uint64) {
	t.Helper()
	raw, err := os.ReadFile("testdata/workbench.bin")
	if err != nil {
		t.Fatal(err)
	}
	s, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	for id, n := range s.nodes {
		name, _ := n.DisplayName()
		if strings.HasSuffix(name, ":Payload") {
			return s, id
		}
	}
	t.Fatal("fixture Payload schema missing")
	return nil, 0
}

func TestCompilerGeneratedMessageAndWorkbenchEncodingAgree(t *testing.T) {
	s, id := fixtureSchema(t)
	raw, err := os.ReadFile("testdata/payload.bin")
	if err != nil {
		t.Fatal(err)
	}
	official, err := capnp.Unmarshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	defer official.Release()
	root, err := official.Root()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := s.DecodeResults(id, root.Struct())
	if err != nil {
		t.Fatal(err)
	}
	var got, want any
	if err := json.Unmarshal(decoded, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(exampleJSON), &want); err != nil {
		t.Fatal(err)
	}
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("official message decoded differently:\ngot  %s\nwant %s", gotJSON, wantJSON)
	}
	msg, encoded, err := s.EncodeParams(id, json.RawMessage(exampleJSON))
	if err != nil {
		t.Fatal(err)
	}
	defer msg.Release()
	equal, err := capnp.Equal(root, encoded.ToPtr())
	if err != nil || !equal {
		t.Fatalf("encoding differs from official compiler: equal=%t %v", equal, err)
	}
}

func TestSchemaDefaultsAndExactIntegerValidation(t *testing.T) {
	s, id := fixtureSchema(t)
	msg, st, err := s.EncodeParams(id, json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	defer msg.Release()
	raw, err := s.DecodeResults(id, st)
	if err != nil {
		t.Fatal(err)
	}
	var values map[string]any
	if err := json.Unmarshal(raw, &values); err != nil {
		t.Fatal(err)
	}
	if values["enabled"] != true || values["signed"] != "-17" || values["unsigned"] != "18446744073709551615" || values["ratio"] != 1.5 || values["mode"] != "ready" || values["text"] != "default text" {
		t.Fatalf("defaults: %s", raw)
	}
	for _, bad := range []string{`[]`, `{} {}`, `{"typo":1}`, `{"signed":"9223372036854775808"}`, `{"unsigned":-1}`, `{"unsigned":1.5}`, `{"enabled":"false"}`, `{"none":null,"selection":"two union fields"}`, `{"mode":"missing"}`, `{"data":"%bad"}`, `{"details":{"amount":256}}`, `{"numbers":[2147483648]}`, `{"children":[null]}`} {
		msg, _, err := s.EncodeParams(id, json.RawMessage(bad))
		if msg != nil {
			msg.Release()
		}
		if err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
}

func TestSchemaDescriptionAndBounds(t *testing.T) {
	s, _ := fixtureSchema(t)
	description, err := s.Describe()
	if err != nil {
		t.Fatal(err)
	}
	if len(description.Methods) != 4 || description.Methods[0].Name != "echo" || description.Methods[1].Fields[0].Type != "int64" {
		t.Fatalf("description: %+v", description)
	}
	if _, _, err := s.method("0xb1529bf8e102de33", 4); err == nil {
		t.Fatal("accepted missing method")
	}
	raw, _ := os.ReadFile("testdata/workbench.bin")
	for _, bad := range [][]byte{nil, {0}, raw[:len(raw)-1], append(append([]byte{}, raw...), 0), make([]byte, MaxSchemaBytes+1)} {
		parsed, err := Parse(bad)
		if parsed != nil {
			parsed.Close()
		}
		if err == nil {
			t.Fatal("accepted invalid schema")
		}
	}
	for _, node := range s.nodes {
		if node.Which() != schema.Node_Which_structNode {
			continue
		}
		fields, _ := node.StructNode().Fields()
		for i := 0; i < fields.Len(); i++ {
			f := fields.At(i)
			if f.Which() == schema.Field_Which_slot {
				typ, _ := f.Slot().Type()
				if typeBits(typ.Which()) == 0 {
					continue
				}
				f.Slot().SetOffset(0xffffffff)
				bad, _ := s.message.Marshal()
				parsed, err := Parse(bad)
				if parsed != nil {
					parsed.Close()
				}
				if err == nil {
					t.Fatal("accepted out-of-range field offset")
				}
				return
			}
		}
	}
}

func FuzzSchemaParse(f *testing.F) {
	raw, _ := os.ReadFile("testdata/workbench.bin")
	f.Add(raw)
	f.Add([]byte{0})
	f.Fuzz(func(t *testing.T, raw []byte) {
		if len(raw) > MaxSchemaBytes {
			return
		}
		s, err := Parse(raw)
		if err != nil {
			return
		}
		defer s.Close()
		_, _ = s.Describe()
	})
}
