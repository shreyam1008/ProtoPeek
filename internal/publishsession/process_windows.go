package publishsession

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"syscall"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

func hideProcess(command *exec.Cmd)  { command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
func publishingPlatformError() error { return nil }

// The Windows 10 JOB_LIST creation attribute is absent from pinned x/sys.
// https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute
const procThreadAttributeJobList = 0x0002000d

type windowsChild struct {
	job  windows.Handle
	pid  int
	once sync.Once
	done chan struct{}
	err  error
}

func (c *windowsChild) Kill() error {
	c.once.Do(func() { _ = windows.CloseHandle(c.job) })
	return nil
}
func (c *windowsChild) PID() int    { return c.pid }
func (c *windowsChild) Wait() error { <-c.done; return c.err }

func inheritedHandle(file *os.File) (windows.Handle, error) {
	var duplicate windows.Handle
	current := windows.CurrentProcess()
	err := windows.DuplicateHandle(current, windows.Handle(file.Fd()), current, &duplicate, 0, true, windows.DUPLICATE_SAME_ACCESS)
	return duplicate, err
}

// CreateProcess assigns only this child to its job before any child code runs.
// The non-inherited job handle dies with ProtoPeek; no parent process, browser,
// unrelated helper or existing provider daemon joins this job.
func launch(ctx context.Context, path string, args []string, output io.Writer) (child, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	accepted := false
	defer func() {
		if !accepted {
			_ = windows.CloseHandle(job)
		}
	}()
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		return nil, err
	}
	attributes, err := windows.NewProcThreadAttributeList(2)
	if err != nil {
		return nil, err
	}
	defer attributes.Delete()
	if err = attributes.Update(procThreadAttributeJobList, unsafe.Pointer(&job), unsafe.Sizeof(job)); err != nil {
		return nil, err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	defer writer.Close()
	defer func() {
		if !accepted {
			_ = reader.Close()
		}
	}()
	input, err := os.Open(os.DevNull)
	if err != nil {
		return nil, err
	}
	defer input.Close()
	outHandle, err := inheritedHandle(writer)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(outHandle)
	inHandle, err := inheritedHandle(input)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(inHandle)
	handles := []windows.Handle{inHandle, outHandle}
	if err = attributes.Update(windows.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, unsafe.Pointer(&handles[0]), uintptr(len(handles))*unsafe.Sizeof(handles[0])); err != nil {
		return nil, err
	}
	executable, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	line, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(append([]string{path}, args...)))
	if err != nil {
		return nil, err
	}
	env := environment()
	sort.Slice(env, func(i, j int) bool { return strings.ToUpper(env[i]) < strings.ToUpper(env[j]) })
	block := utf16.Encode([]rune(strings.Join(env, "\x00") + "\x00\x00"))
	startup := windows.StartupInfoEx{
		StartupInfo:             windows.StartupInfo{Cb: uint32(unsafe.Sizeof(windows.StartupInfoEx{})), Flags: windows.STARTF_USESTDHANDLES | windows.STARTF_USESHOWWINDOW, ShowWindow: windows.SW_HIDE, StdInput: inHandle, StdOutput: outHandle, StdErr: outHandle},
		ProcThreadAttributeList: attributes.List(),
	}
	process := windows.ProcessInformation{}
	if err = windows.CreateProcess(executable, line, nil, nil, true, windows.CREATE_UNICODE_ENVIRONMENT|windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_NO_WINDOW, &block[0], nil, &startup.StartupInfo, &process); err != nil {
		return nil, err
	}
	_ = windows.CloseHandle(process.Thread)
	value := &windowsChild{job: job, pid: int(process.ProcessId), done: make(chan struct{})}
	accepted = true
	readDone := make(chan struct{})
	go func() { _, _ = io.Copy(output, reader); _ = reader.Close(); close(readDone) }()
	stop := context.AfterFunc(ctx, func() { _ = value.Kill() })
	go func() {
		state, waitErr := windows.WaitForSingleObject(process.Process, windows.INFINITE)
		if waitErr == nil && state == windows.WAIT_OBJECT_0 {
			var code uint32
			waitErr = windows.GetExitCodeProcess(process.Process, &code)
			if waitErr == nil && code != 0 {
				waitErr = errors.New("owned publishing process exited unsuccessfully")
			}
		}
		_ = value.Kill() // Also closes any child descendants and their pipe copies.
		stop()
		_ = windows.CloseHandle(process.Process)
		<-readDone
		value.err = waitErr
		close(value.done)
	}()
	return value, nil
}
