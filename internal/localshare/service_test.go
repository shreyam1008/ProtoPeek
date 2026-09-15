package localshare

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func pair(t testing.TB) (*Service, *Service, Peer) {
	t.Helper()
	a, b := New(), New()
	for _, s := range []*Service{a, b} {
		if err := s.Start("Test device", t.TempDir(), 0); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(s.Stop)
	}
	p, err := a.Connect(context.Background(), fmt.Sprintf("127.0.0.1:%d", b.port), b.fingerprint)
	if err != nil {
		t.Fatal(err)
	}
	return a, b, p
}
func waitJob(t testing.TB, s *Service, state string) Job {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, j := range s.Snapshot().Jobs {
			if j.State == state {
				return j
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("No %s job: %+v", state, s.Snapshot().Jobs)
	return Job{}
}
func sendAccepted(t testing.TB, a, b *Service, p Peer, name string, data []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.Send(ctx, p.ID, name, int64(len(data)), bytes.NewReader(data)) }()
	j := waitJob(t, b, "pending")
	if err := b.Decide(j.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestStreamingTransferAndCollision(t *testing.T) {
	a, b, p := pair(t)
	data := bytes.Repeat([]byte("file evidence\n"), 100000)
	if err := os.WriteFile(filepath.Join(b.directory, "capture.bin"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	sendAccepted(t, a, b, p, "capture.bin", data)
	j := waitJob(t, b, "completed")
	got, err := os.ReadFile(j.Path)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("Content mismatch: %v", err)
	}
	h := sha256.Sum256(data)
	if j.SHA256 != hex.EncodeToString(h[:]) {
		t.Fatal("Hash mismatch")
	}
	old, _ := os.ReadFile(filepath.Join(b.directory, "capture.bin"))
	if string(old) != "keep" {
		t.Fatal("Existing file overwritten")
	}
	parts, _ := filepath.Glob(filepath.Join(b.directory, "*.part"))
	if len(parts) > 0 {
		t.Fatal("Partial file left behind")
	}
	if a.Snapshot().Jobs[0].State != "completed" {
		t.Fatal("Sender did not complete")
	}
}
func TestEmptyFile(t *testing.T) {
	a, b, p := pair(t)
	sendAccepted(t, a, b, p, "empty.txt", nil)
	j := waitJob(t, b, "completed")
	info, err := os.Stat(j.Path)
	if err != nil || info.Size() != 0 {
		t.Fatal("Empty file not saved", err)
	}
}
func TestRejectAndCancelOffer(t *testing.T) {
	for _, cancelOffer := range []bool{false, true} {
		t.Run(fmt.Sprint(cancelOffer), func(t *testing.T) {
			a, b, p := pair(t)
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- a.Send(ctx, p.ID, "report.txt", 4, strings.NewReader("data")) }()
			j := waitJob(t, b, "pending")
			var err error
			if cancelOffer {
				err = b.Cancel(j.ID)
			} else {
				err = b.Decide(j.ID, false)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := <-done; err == nil {
				t.Fatal("Rejected offer succeeded")
			}
			files, _ := os.ReadDir(b.directory)
			if len(files) != 0 {
				t.Fatal("Rejected offer wrote a file")
			}
		})
	}
}
func TestCancelActiveUploadRemovesPartial(t *testing.T) {
	a, b, p := pair(t)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	done := make(chan error, 1)
	go func() { done <- a.Send(ctx, p.ID, "large.bin", 1<<30, reader) }()
	j := waitJob(t, b, "pending")
	if err := b.Decide(j.ID, true); err != nil {
		t.Fatal(err)
	}
	written := make(chan error, 1)
	go func() { _, err := writer.Write(bytes.Repeat([]byte{42}, 65536)); written <- err }()
	if err := <-written; err != nil {
		t.Fatal(err)
	}
	waitJob(t, b, "receiving")
	if err := a.Cancel(a.Snapshot().Jobs[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err == nil {
		t.Fatal("Cancelled transfer succeeded")
	}
	waitJob(t, b, "failed")
	deadline := time.Now().Add(time.Second)
	for {
		files, _ := os.ReadDir(b.directory)
		if len(files) == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Partial file not removed")
		}
		time.Sleep(time.Millisecond)
	}
}
func TestCertificatePinAndToken(t *testing.T) {
	a, b, _ := pair(t)
	if _, err := a.Connect(context.Background(), fmt.Sprintf("127.0.0.1:%d", b.port), strings.Repeat("0", 64)); err == nil {
		t.Fatal("Wrong certificate accepted")
	}
	req, _ := http.NewRequest("POST", fmt.Sprintf("https://127.0.0.1:%d/protopeek-share/v1/upload?id=fake", b.port), strings.NewReader("bad"))
	resp, err := client(b.fingerprint).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("Unsolicited upload accepted")
	}
}
func TestFileNamesAndPeerAddresses(t *testing.T) {
	for _, name := range []string{"../x", "..\\x", "/abs", "C:x", "NUL.txt", "CON", "a.", "a ", "a\x00b", "..", "LPT1.txt", "a:b", "a\nb"} {
		if validFile(name, 1) {
			t.Errorf("Accepted %q", name)
		}
	}
	if !validFile("trace-你好.pcap", 0) || validFile("ok", -1) {
		t.Fatal("Bad size/name validation")
	}
	s := New()
	for _, address := range []string{"example.com:53318", "https://127.0.0.1:53318", "127.0.0.1", "127.0.0.1:53318/path", "127.0.0.1:bad", "127.0.0.1:0", "127.0.0.1:65536"} {
		if _, err := s.Connect(context.Background(), address, strings.Repeat("0", 64)); err == nil {
			t.Errorf("Accepted %q", address)
		}
	}
}
func TestStopCancelsAndCanRestart(t *testing.T) {
	a, b, p := pair(t)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.Send(ctx, p.ID, "x", 1, strings.NewReader("x")) }()
	waitJob(t, b, "pending")
	b.Stop()
	if err := <-done; err == nil {
		t.Fatal("Stopped transfer succeeded")
	}
	if b.Snapshot().Running {
		t.Fatal("Still running")
	}
	if err := b.Start("Again", b.directory, 0); err != nil {
		t.Fatal(err)
	}
}

func BenchmarkStreamingTransfer(b *testing.B) {
	sender, receiver, peer := pair(b)
	data := bytes.Repeat([]byte{42}, 64<<20)
	b.SetBytes(int64(len(data)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		sendAccepted(b, sender, receiver, peer, fmt.Sprintf("benchmark-%d.bin", i), data)
	}
}
