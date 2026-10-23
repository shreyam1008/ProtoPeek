package catalogids

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestCatalogMatchesFrontendManifestIdentityCapabilityAndOrder(t *testing.T) {
	raw, err := os.ReadFile("../../../web/src/console/extension-manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var frontend []Entry
	if err := json.Unmarshal(raw, &frontend); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(frontend, All()) || len(frontend) != 20 {
		t.Fatalf("frontend catalog identity/capability/order differs: frontend=%+v backend=%+v", frontend, All())
	}
	seen := map[string]bool{}
	for _, entry := range All() {
		found, ok := Lookup(entry.ID)
		if !ok || found != entry || seen[entry.ID] {
			t.Fatalf("invalid or repeated identity: %+v", entry)
		}
		seen[entry.ID] = true
	}
	copy := All()
	copy[0].ID = "changed"
	if All()[0].ID == "changed" {
		t.Fatal("caller changed the static catalog")
	}
	if _, ok := Lookup("../shell"); ok {
		t.Fatal("unknown ID accepted")
	}
}
