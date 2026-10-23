//go:build windows

package cloudflared

import (
	"errors"
	"os"
	"syscall"

	"golang.org/x/sys/windows"
)

func isReparse(info os.FileInfo) bool {
	data, ok := info.Sys().(*syscall.Win32FileAttributeData)
	return !ok || data.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0
}
func singleLink(path string, _ os.FileInfo) error {
	value, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(value, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		return err
	}
	if info.NumberOfLinks != 1 || info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return errors.New("hardlinked or reparse files are not adopted")
	}
	return nil
}
func ownedWritableConfig(path string) error {
	if _, _, err := readRegularConfig(path); err != nil {
		return err
	}
	security, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil || security == nil {
		return errors.New("permission-required: config ownership could not be verified")
	}
	owner, _, err := security.Owner()
	if err != nil {
		return err
	}
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || owner == nil || !owner.Equals(user.User.Sid) {
		return errors.New("permission-required: administrator-owned configs must be edited through the host administrator workflow; no alternate copy is used")
	}
	file, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return errors.New("permission-required: the canonical config is not writable by this user")
	}
	return file.Close()
}
func protectStage(path string) error {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	security, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + user.User.Sid.String() + ")")
	if err != nil {
		return err
	}
	dacl, _, err := security.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}
func preserveConfigPermissions(stage, target string, _ os.FileInfo) error {
	security, err := windows.GetNamedSecurityInfo(target, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION)
	if err != nil || security == nil {
		return errors.New("config permissions unavailable")
	}
	dacl, _, err := security.DACL()
	if err != nil || dacl == nil {
		return errors.New("an absent or unrestricted config ACL is not adopted")
	}
	group, _, err := security.Group()
	if err != nil {
		return err
	}
	control, _, err := security.Control()
	if err != nil {
		return err
	}
	flags := windows.SECURITY_INFORMATION(windows.DACL_SECURITY_INFORMATION | windows.GROUP_SECURITY_INFORMATION)
	if control&windows.SE_DACL_PROTECTED != 0 {
		flags |= windows.PROTECTED_DACL_SECURITY_INFORMATION
	} else {
		flags |= windows.UNPROTECTED_DACL_SECURITY_INFORMATION
	}
	return windows.SetNamedSecurityInfo(stage, windows.SE_FILE_OBJECT, flags, nil, group, dacl, nil)
}
func replaceConfigFile(stage, target string) (bool, error) {
	from, err := windows.UTF16PtrFromString(stage)
	if err != nil {
		return false, err
	}
	to, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return false, err
	}
	if err := windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH); err != nil {
		return false, err
	}
	return true, nil
}

func configPermissions(path string, info os.FileInfo) (string, error) {
	security, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.GROUP_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil || security == nil {
		return "", errors.New("config permissions unavailable")
	}
	return configPermissionFingerprint(security, info.Mode())
}

func configPermissionFingerprint(security *windows.SECURITY_DESCRIPTOR, mode os.FileMode) (string, error) {
	// SetNamedSecurityInfo can mark an unchanged ACL as converted to automatic
	// inheritance. Ignore only that bookkeeping bit in this in-memory copy; owner,
	// group, ordered ACEs (including inheritance flags), protection and mode remain.
	// https://learn.microsoft.com/en-us/windows/win32/secauthz/automatic-propagation-of-inheritable-aces
	if err := security.SetControl(windows.SE_DACL_AUTO_INHERITED, 0); err != nil {
		return "", errors.New("config permission control unavailable")
	}
	descriptor := security.String()
	if descriptor == "" {
		return "", errors.New("config permissions unavailable")
	}
	return descriptor + mode.String(), nil
}
