package media

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func putPathTool(t *testing.T, dir, name string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("external fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPartialStatusIsCheapAndMutationStillChecksHashes(t *testing.T) {
	a, ok := assetFor("gallery-dl")
	if !ok {
		t.Skip("no managed gallery-dl on this platform")
	}
	s := &Service{root: t.TempDir()}
	path := s.assetPath(a)
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(a.Size); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	tool := s.tool("gallery-dl")
	if !tool.Incomplete || !tool.CanInstall || !tool.CanRemove {
		t.Fatalf("structural candidate: %+v", tool)
	}
	if err := s.Remove("gallery-dl"); !errors.Is(err, ErrRemoveInvalid) {
		t.Fatalf("zero-filled file was not independently rejected: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("changed file removed: %v", err)
	}
}

func TestInvalidVersionDirectoryDoesNotFallBackToPath(t *testing.T) {
	a, ok := assetFor("gallery-dl")
	if !ok {
		t.Skip("no managed gallery-dl on this platform")
	}
	pathDir := t.TempDir()
	putPathTool(t, pathDir, "gallery-dl")
	t.Setenv("PATH", pathDir)
	root := t.TempDir()
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("HOME", root)
	config, err := configDirectory()
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{root: config}
	dir := filepath.Dir(s.assetPath(a))
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "user-file"), []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	got := s.tool("gallery-dl")
	if !got.Invalid || got.Path != "" || got.CanInstall {
		t.Fatalf("Files status: %+v", got)
	}
	state, err := InspectManaged("gallery-dl")
	if err != nil || state.Status != "invalid" || state.CanInstall {
		t.Fatalf("Extensions status: %+v %v", state, err)
	}
	if err := s.Install(context.Background(), "gallery-dl"); !errors.Is(err, ErrInstallUnsafe) {
		t.Fatalf("invalid install: %v", err)
	}
}

func TestExternalInstallationIsNotReportedAsManagedSuccess(t *testing.T) {
	if _, ok := assetFor("gallery-dl"); !ok {
		t.Skip("no managed gallery-dl on this platform")
	}
	dir := t.TempDir()
	putPathTool(t, dir, "gallery-dl")
	t.Setenv("PATH", dir)
	root := t.TempDir()
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("HOME", root)
	config, err := configDirectory()
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{root: config}
	state, err := InspectManaged("gallery-dl")
	if err != nil || state.Status != "external" || state.CanInstall || state.CanRemove {
		t.Fatalf("external state: %+v %v", state, err)
	}
	if err := s.Install(context.Background(), "gallery-dl"); !errors.Is(err, ErrExternalToolPresent) {
		t.Fatalf("external install: %v", err)
	}
	if err := s.Remove("gallery-dl"); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("external removal: %v", err)
	}
}

func TestDamagedOptionalHelpersFallbackWithWarning(t *testing.T) {
	deno, denoOK := assetFor("deno")
	ffmpeg, ffmpegOK := assetFor("ffmpeg")
	if !denoOK || !ffmpegOK {
		t.Skip("managed Deno and FFmpeg not both supported on this platform")
	}
	dir := t.TempDir()
	engine := putPathTool(t, dir, "yt-dlp")
	node := putPathTool(t, dir, "node")
	t.Setenv("PATH", dir)
	s := &Service{root: t.TempDir()}
	for _, asset := range []Asset{deno, ffmpeg} {
		path := s.assetPath(asset)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("damaged"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	tools, err := s.resolveTools(Job{Request: Request{Engine: "yt-dlp"}})
	if err != nil {
		t.Fatal(err)
	}
	if tools.engine != engine || tools.runtimeName != "node" || tools.runtimePath != node || tools.ffmpeg != "" || !strings.Contains(tools.warning, "Deno") || !strings.Contains(tools.warning, "FFmpeg") {
		t.Fatalf("fallback: %+v", tools)
	}
	args := s.args(Job{Request: Request{Engine: "yt-dlp", Format: "video", Start: 1, End: 1, URL: "http://127.0.0.1/fixture"}}, tools)
	encoded, _ := json.Marshal(args)
	if strings.Contains(string(encoded), "--ffmpeg-location") || !strings.Contains(string(encoded), "best[acodec!=none][vcodec!=none]") {
		t.Fatalf("wrong fallback args: %s", encoded)
	}
}

func TestYTDLPSetupSkipsDamagedOptionalHelpers(t *testing.T) {
	yt, ytOK := assetFor("yt-dlp")
	deno, denoOK := assetFor("deno")
	ffmpeg, ffmpegOK := assetFor("ffmpeg")
	if !ytOK || !denoOK || !ffmpegOK {
		t.Skip("managed media tools not all supported on this platform")
	}
	root := t.TempDir()
	t.Setenv("APPDATA", root)
	t.Setenv("XDG_CONFIG_HOME", root)
	t.Setenv("HOME", root)
	t.Setenv("PATH", t.TempDir())
	config, err := configDirectory()
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{root: config}
	denoDir := filepath.Dir(s.assetPath(deno))
	ffmpegPath := s.assetPath(ffmpeg)
	for _, dir := range []string{denoDir, filepath.Dir(ffmpegPath)} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	unknown := filepath.Join(denoDir, "unexpected-user-file")
	if err := os.WriteFile(unknown, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	// This looks structurally recoverable but fails verification, without a
	// costly status hash or any network request.
	receipt := ffmpegPath + ".verified"
	if err := os.WriteFile(receipt, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	tool := s.tool("yt-dlp")
	if tool.InstallBytes != yt.Size || !strings.Contains(tool.Help, "deno and ffmpeg") {
		t.Fatalf("setup size or warning: %+v", tool)
	}
	state, err := InspectManaged("yt-dlp")
	if err != nil || state.InstallBytes != yt.Size || !strings.Contains(state.Message, "deno and ffmpeg") {
		t.Fatalf("inventory warning: %+v %v", state, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.Install(ctx, "yt-dlp"); !errors.Is(err, context.Canceled) {
		t.Fatalf("main install should be reached without attempting damaged helpers: %v", err)
	}
	for _, file := range []string{unknown, receipt} {
		if _, err := os.Stat(file); err != nil {
			t.Fatalf("optional file was changed or removed: %s: %v", file, err)
		}
	}
}
