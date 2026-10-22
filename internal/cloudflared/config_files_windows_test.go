//go:build windows

package cloudflared

import (
	"os"
	"path/filepath"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func createWindowsConfig(t *testing.T, path, descriptor string) {
	t.Helper()
	security, err := windows.SecurityDescriptorFromString(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	attributes := &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: security}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, attributes, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(operationFixture), 0600); err != nil {
		t.Fatal(err)
	}
}

func windowsConfigDescriptor(t *testing.T, path string) *windows.SECURITY_DESCRIPTOR {
	t.Helper()
	security, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	return security
}

func windowsConfigFingerprint(t *testing.T, path string) string {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	fingerprint, err := configPermissions(path, info)
	if err != nil {
		t.Fatal(err)
	}
	return fingerprint
}

func setWindowsConfigDACL(t *testing.T, path, descriptor string) {
	t.Helper()
	security, err := windows.SecurityDescriptorFromString(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	dacl, _, err := security.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		t.Fatal(err)
	}
}

func TestWindowsConfigPermissionsRoundTrip(t *testing.T) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"inherited", "explicit-protected", "legacy-inherited"} {
		t.Run(name, func(t *testing.T) {
			protected := name == "explicit-protected"
			directory := t.TempDir()
			if name == "legacy-inherited" {
				directory = filepath.Join(directory, "legacy")
				parent, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;" + user.User.Sid.String() + ")")
				if err != nil {
					t.Fatal(err)
				}
				attributes := &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: parent}
				path, err := windows.UTF16PtrFromString(directory)
				if err != nil {
					t.Fatal(err)
				}
				if err := windows.CreateDirectory(path, attributes); err != nil {
					t.Fatal(err)
				}
			}
			target, stage := filepath.Join(directory, "config.yml"), filepath.Join(directory, "stage.yml")
			if protected {
				// Creation with an explicit descriptor retains the legacy no-AI form.
				createWindowsConfig(t, target, "D:P(A;;FA;;;"+user.User.Sid.String()+")")
			} else {
				if name == "inherited" {
					setWindowsConfigDACL(t, directory, "D:P(A;OICI;FA;;;"+user.User.Sid.String()+")(A;OICI;FA;;;SY)")
				}
				if err := os.WriteFile(target, []byte(operationFixture), 0600); err != nil {
					t.Fatal(err)
				}
			}
			before := windowsConfigDescriptor(t, target)
			beforeControl, _, err := before.Control()
			if err != nil {
				t.Fatal(err)
			}
			if protected && beforeControl&windows.SE_DACL_AUTO_INHERITED != 0 {
				t.Fatal("fixture did not reproduce a protected ACL without automatic-inheritance bookkeeping")
			}
			if name == "legacy-inherited" && beforeControl&windows.SE_DACL_AUTO_INHERITED != 0 {
				t.Fatal("fixture did not reproduce a legacy inherited ACL without automatic-inheritance bookkeeping")
			}
			if !protected && beforeControl&windows.SE_DACL_PROTECTED != 0 {
				t.Fatal("fixture did not inherit its directory's ACL")
			}
			wanted := windowsConfigFingerprint(t, target)
			if err := os.WriteFile(stage, []byte("staged"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := protectStage(stage); err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(target)
			if err != nil {
				t.Fatal(err)
			}
			if err := preserveConfigPermissions(stage, target, info); err != nil {
				t.Fatal(err)
			}
			after := windowsConfigDescriptor(t, stage)
			afterControl, _, err := after.Control()
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("before control=%#x %s; after control=%#x %s", beforeControl, before.String(), afterControl, after.String())
			if name != "inherited" && (afterControl&windows.SE_DACL_AUTO_INHERITED == 0 || before.String() == after.String()) {
				t.Fatal("fixture did not exercise SetNamedSecurityInfo's AI conversion")
			}
			if got := windowsConfigFingerprint(t, stage); got != wanted {
				t.Fatalf("permissions changed during staging:\nbefore %s\nafter  %s", wanted, got)
			}
			if got := windowsConfigFingerprint(t, target); got != wanted || windowsConfigDescriptor(t, target).String() != before.String() {
				t.Fatal("fingerprinting changed the canonical file's descriptor")
			}
		})
	}
}

func TestWindowsConfigFingerprintRefusesEmptyDescriptor(t *testing.T) {
	security, err := windows.NewSecurityDescriptor()
	if err != nil {
		t.Fatal(err)
	}
	if !security.IsValid() || security.String() != "" {
		t.Fatal("fixture is not a valid descriptor with unavailable SDDL")
	}
	if fingerprint, err := configPermissionFingerprint(security, 0666); err == nil || fingerprint != "" {
		t.Fatalf("empty descriptor did not fail closed: %q %v", fingerprint, err)
	}
}

func TestWindowsConfigFingerprintRetainsPermissionAuthority(t *testing.T) {
	const original = "O:SYG:BAD:P(A;;FR;;;BU)(A;;FA;;;BA)"
	fingerprint := func(descriptor string, mode os.FileMode) string {
		t.Helper()
		security, err := windows.SecurityDescriptorFromString(descriptor)
		if err != nil {
			t.Fatal(err)
		}
		value, err := configPermissionFingerprint(security, mode)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	wanted := fingerprint(original, 0666)
	if got := fingerprint("O:SYG:BAD:PAI(A;;FR;;;BU)(A;;FA;;;BA)", 0666); got != wanted {
		t.Fatal("the automatic-inheritance bookkeeping bit changed the fingerprint")
	}
	for name, descriptor := range map[string]string{
		"owner":       "O:BAG:BAD:P(A;;FR;;;BU)(A;;FA;;;BA)",
		"group":       "O:SYG:SYD:P(A;;FR;;;BU)(A;;FA;;;BA)",
		"rights":      "O:SYG:BAD:P(A;;FW;;;BU)(A;;FA;;;BA)",
		"ACE order":   "O:SYG:BAD:P(A;;FA;;;BA)(A;;FR;;;BU)",
		"inheritance": "O:SYG:BAD:P(A;ID;FR;;;BU)(A;;FA;;;BA)",
		"protection":  "O:SYG:BAD:(A;;FR;;;BU)(A;;FA;;;BA)",
	} {
		t.Run(name, func(t *testing.T) {
			if fingerprint(descriptor, 0666) == wanted {
				t.Fatal("a permission authority change was ignored")
			}
		})
	}
	if fingerprint(original, 0444) == wanted {
		t.Fatal("the read-only mode change was ignored")
	}
}

func TestWindowsCanonicalProtectedConfigApplyRollback(t *testing.T) {
	state := fixtureOperations(t)
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(state.path); err != nil {
		t.Fatal(err)
	}
	createWindowsConfig(t, state.path, "D:P(A;;FA;;;"+user.User.Sid.String()+")")
	control, _, err := windowsConfigDescriptor(t, state.path).Control()
	if err != nil || control&windows.SE_DACL_AUTO_INHERITED != 0 || control&windows.SE_DACL_PROTECTED == 0 {
		t.Fatalf("fixture is not a protected ACL without automatic-inheritance bookkeeping: %#x %v", control, err)
	}
	wanted := windowsConfigFingerprint(t, state.path)
	planned := executeFixture(t, state, state.request("plan"))
	if planned.Status != "planned" || planned.Plan == nil {
		t.Fatalf("plan: %+v", planned)
	}
	for _, operation := range []string{"apply", "rollback"} {
		request := state.request(operation)
		request.PlanID, request.Confirmed = planned.Plan.ID, true
		if result := executeFixture(t, state, request); result.Status != "completed" {
			t.Fatalf("%s: %+v", operation, result)
		}
		if got := windowsConfigFingerprint(t, state.path); got != wanted {
			t.Fatalf("%s changed permissions: %s", operation, got)
		}
	}
	data, err := os.ReadFile(state.path)
	if err != nil || string(data) != operationFixture {
		t.Fatalf("rollback did not restore the original content: %v", err)
	}
}

func TestWindowsCanonicalConfigRejectsNativeACLChangeAfterPlan(t *testing.T) {
	state := fixtureOperations(t)
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(state.path); err != nil {
		t.Fatal(err)
	}
	createWindowsConfig(t, state.path, "D:P(A;;FA;;;"+user.User.Sid.String()+")")
	planned := executeFixture(t, state, state.request("plan"))
	if planned.Status != "planned" || planned.Plan == nil {
		t.Fatalf("plan: %+v", planned)
	}
	before := windowsConfigFingerprint(t, state.path)
	setWindowsConfigDACL(t, state.path, "D:P(A;;FR;;;BU)(A;;FA;;;"+user.User.Sid.String()+")")
	if windowsConfigFingerprint(t, state.path) == before {
		t.Fatal("native ACL change did not change the permission fingerprint")
	}
	request := state.request("apply")
	request.PlanID, request.Confirmed = planned.Plan.ID, true
	if result := executeFixture(t, state, request); result.Status != "stale" {
		t.Fatalf("native ACL change accepted: %+v", result)
	}
	data, err := os.ReadFile(state.path)
	if err != nil || string(data) != operationFixture {
		t.Fatalf("refused apply changed canonical content: %v", err)
	}
}
