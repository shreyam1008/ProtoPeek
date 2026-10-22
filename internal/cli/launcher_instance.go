package cli

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

const instanceEndpoint = "/.well-known/protopeek-instance"
const instanceHeader = "X-ProtoPeek-Instance"
const instanceChallengeHeader = "X-ProtoPeek-Challenge"

func instanceProof(token, direction, nonce string) string {
	mac := hmac.New(sha256.New, []byte(token))
	_, _ = io.WriteString(mac, direction+"\x00"+nonce)
	return hex.EncodeToString(mac.Sum(nil))
}

type launcherInstance struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	lease transfer.Lock
	path  string
}

func reusableLauncherLaunch(launcher bool, initialScanTarget string) bool {
	if initialScanTarget != "" || !launcher || *port != 0 || *bind != "127.0.0.1" || *basePath != "/" || *unsafeAllowRemote || *allowNonLoopbackBind {
		return false
	}
	allowed := true
	flags.Visit(func(value *flag.Flag) {
		if value.Name != "open-browser" {
			allowed = false
		}
	})
	return allowed
}

func acquireLauncherInstance(ctx context.Context, directory string) (*launcherInstance, string, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, "", err
	}
	path := filepath.Join(directory, "launcher-instance.json")
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return nil, "", fmt.Errorf("launcher state must be a regular file")
	}
	lease, err := (transfer.FileLocker{}).TryLock(filepath.Join(directory, "launcher.lock"))
	if errors.Is(err, transfer.ErrLockHeld) {
		// Another start may hold the lock before publishing its listening endpoint.
		deadline := time.NewTimer(2 * time.Second)
		defer deadline.Stop()
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			if active, readErr := readLauncherInstance(path); readErr == nil && active.probe(ctx) {
				return nil, active.URL, nil
			}
			select {
			case <-ctx.Done():
				return nil, "", ctx.Err()
			case <-deadline.C:
				return nil, "", fmt.Errorf("another ProtoPeek launcher owns this profile but has not answered; wait for it to start or close it, then retry")
			case <-ticker.C:
			}
		}
	}
	if err != nil {
		return nil, "", err
	}
	random := make([]byte, 32)
	_, _ = rand.Read(random)
	return &launcherInstance{Token: hex.EncodeToString(random), lease: lease, path: path}, "", nil
}

func readLauncherInstance(path string) (*launcherInstance, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4096 {
		return nil, fmt.Errorf("launcher state unavailable")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var instance launcherInstance
	decoder := json.NewDecoder(io.LimitReader(file, 4097))
	if decoder.Decode(&instance) != nil {
		return nil, fmt.Errorf("invalid launcher state")
	}
	parsed, err := url.Parse(instance.URL)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "/" || len(instance.Token) != 64 {
		return nil, fmt.Errorf("invalid launcher endpoint")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("invalid launcher port")
	}
	if _, err := hex.DecodeString(instance.Token); err != nil {
		return nil, fmt.Errorf("invalid launcher identity")
	}
	return &instance, nil
}

func (instance *launcherInstance) probe(parent context.Context) bool {
	ctx, cancel := context.WithTimeout(parent, 300*time.Millisecond)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "GET", instance.URL+instanceEndpoint[1:], nil)
	if err != nil {
		return false
	}
	nonceBytes := make([]byte, 32)
	_, _ = rand.Read(nonceBytes)
	nonce := hex.EncodeToString(nonceBytes)
	request.Header.Set(instanceChallengeHeader, nonce)
	request.Header.Set(instanceHeader, instanceProof(instance.Token, "request", nonce))
	transport := &http.Transport{Proxy: nil}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 65))
	return err == nil && response.StatusCode == 200 && subtle.ConstantTimeCompare(body, []byte(instanceProof(instance.Token, "response", nonce))) == 1
}

func (instance *launcherInstance) handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != instanceEndpoint {
			next.ServeHTTP(writer, request)
			return
		}
		writer.Header().Set("Cache-Control", "no-store")
		nonce := request.Header.Get(instanceChallengeHeader)
		decoded, err := hex.DecodeString(nonce)
		if request.Method != "GET" || err != nil || len(decoded) != 32 || len(nonce) != 64 || subtle.ConstantTimeCompare([]byte(request.Header.Get(instanceHeader)), []byte(instanceProof(instance.Token, "request", nonce))) != 1 {
			http.NotFound(writer, request)
			return
		}
		_, _ = io.WriteString(writer, instanceProof(instance.Token, "response", nonce))
	})
}

func (instance *launcherInstance) publish(address string) error {
	instance.URL = address
	encoded, err := json.Marshal(instance)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(instance.path), "launcher-*.tmp")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(encoded)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, instance.path)
}

func (instance *launcherInstance) close() {
	if saved, err := readLauncherInstance(instance.path); err == nil && saved.Token == instance.Token {
		_ = os.Remove(instance.path)
	}
	if instance.lease != nil {
		_ = instance.lease.Release()
	}
}
