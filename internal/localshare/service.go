// Package localshare implements ProtoPeek's opt-in, direct file transport.
// It has no dependency on the download engine or a hosted rendezvous service.
package localshare

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const DefaultPort = 53318
const protocol = "protopeek-share/1"
const maxJobs = 64

type Peer struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Address string    `json:"address"`
	Seen    time.Time `json:"seen"`
	Manual  bool      `json:"manual"`
}
type Job struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Peer      string    `json:"peer"`
	Direction string    `json:"direction"`
	Size      int64     `json:"size"`
	Bytes     int64     `json:"bytes"`
	State     string    `json:"state"`
	Error     string    `json:"error,omitempty"`
	Path      string    `json:"path,omitempty"`
	SHA256    string    `json:"sha256,omitempty"`
	Started   time.Time `json:"started"`
	decision  chan bool
	cancel    context.CancelFunc
	token     string
	ctx       context.Context
}
type Snapshot struct {
	Running     bool     `json:"running"`
	Name        string   `json:"name"`
	Fingerprint string   `json:"fingerprint"`
	Directory   string   `json:"directory"`
	Addresses   []string `json:"addresses"`
	Warning     string   `json:"warning"`
	Peers       []Peer   `json:"peers"`
	Jobs        []Job    `json:"jobs"`
}
type Service struct {
	mu                                    sync.Mutex
	server                                *http.Server
	udp                                   *net.UDPConn
	stop                                  context.CancelFunc
	name, fingerprint, directory, warning string
	port                                  int
	peers                                 map[string]Peer
	jobs                                  map[string]*Job
}

func New() *Service { return &Service{peers: make(map[string]Peer), jobs: make(map[string]*Job)} }
func randomID() string {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

func (s *Service) Start(name, directory string, port int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server != nil {
		return errors.New("Local transfer is already enabled")
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 80 {
		return errors.New("Choose a device name of 1–80 bytes")
	}
	if !filepath.IsAbs(directory) {
		return errors.New("Choose an absolute receive directory")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return err
	}
	root.Close()
	if port < 0 || port > 65535 {
		return errors.New("Invalid port")
	}
	cert, fingerprint, err := certificate()
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return err
	}
	s.port = listener.Addr().(*net.TCPAddr).Port
	s.name, s.directory, s.fingerprint, s.warning = name, directory, fingerprint, ""
	s.peers = make(map[string]Peer)
	ctx, cancel := context.WithCancel(context.Background())
	s.stop = cancel
	mux := http.NewServeMux()
	mux.HandleFunc("GET /protopeek-share/v1/info", s.info)
	mux.HandleFunc("POST /protopeek-share/v1/offer", s.offer)
	mux.HandleFunc("POST /protopeek-share/v1/upload", s.upload)
	s.server = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 8192, BaseContext: func(net.Listener) context.Context { return ctx }}
	server := s.server
	go func() {
		_ = server.Serve(tls.NewListener(listener, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}))
	}()
	s.startDiscovery(ctx)
	// Sessions are intentionally temporary. Enabling again creates a fresh identity.
	go func() {
		select {
		case <-ctx.Done():
		case <-time.After(time.Hour):
			s.Stop()
		}
	}()
	return nil
}

func (s *Service) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return
	}
	s.stop()
	_ = s.server.Close()
	if s.udp != nil {
		_ = s.udp.Close()
		s.udp = nil
	}
	s.server = nil
	for _, j := range s.jobs {
		if active(j.State) {
			j.State = "cancelled"
			if j.cancel != nil {
				j.cancel()
			}
		}
	}
}
func active(state string) bool {
	return state == "pending" || state == "sending" || state == "receiving" || state == "waiting"
}
func (s *Service) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Snapshot{Running: s.server != nil, Name: s.name, Fingerprint: s.fingerprint, Directory: s.directory, Warning: s.warning, Addresses: []string{}, Peers: []Peer{}, Jobs: []Job{}}
	if out.Running {
		addrs, _ := net.InterfaceAddrs()
		for _, a := range addrs {
			ip, _, err := net.ParseCIDR(a.String())
			if err == nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
				out.Addresses = append(out.Addresses, net.JoinHostPort(ip.String(), fmt.Sprint(s.port)))
			}
		}
	}
	for id, p := range s.peers {
		if !p.Manual && time.Since(p.Seen) > 3*time.Minute {
			delete(s.peers, id)
		} else {
			out.Peers = append(out.Peers, p)
		}
	}
	for _, j := range s.jobs {
		out.Jobs = append(out.Jobs, *j)
	}
	sort.Slice(out.Peers, func(i, j int) bool { return out.Peers[i].Name < out.Peers[j].Name })
	sort.Slice(out.Jobs, func(i, j int) bool { return out.Jobs[i].Started.After(out.Jobs[j].Started) })
	return out
}
func (s *Service) newJob(name, peer, direction string, size int64, cancel context.CancelFunc) (*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return nil, errors.New("Enable local transfer first")
	}
	count := 0
	for _, j := range s.jobs {
		if active(j.State) {
			count++
		}
	}
	if count >= 4 {
		return nil, errors.New("Four transfers are already active; wait or cancel one")
	}
	if len(s.jobs) >= maxJobs {
		var oldest *Job
		for _, j := range s.jobs {
			if !active(j.State) && (oldest == nil || j.Started.Before(oldest.Started)) {
				oldest = j
			}
		}
		if oldest != nil {
			delete(s.jobs, oldest.ID)
		}
	}
	j := &Job{ID: randomID(), Name: name, Peer: peer, Direction: direction, Size: size, State: "waiting", Started: time.Now(), cancel: cancel, decision: make(chan bool, 1)}
	s.jobs[j.ID] = j
	return j, nil
}
func (s *Service) update(id string, f func(*Job)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if j := s.jobs[id]; j != nil {
		f(j)
	}
}
func (s *Service) finish(id string, err error, hash, path string) {
	s.update(id, func(j *Job) {
		if j.State == "cancelled" {
			return
		}
		if err != nil {
			j.State = "failed"
			j.Error = err.Error()
		} else {
			j.State = "completed"
			j.SHA256 = hash
			j.Path = path
		}
	})
}
func (s *Service) Decide(id string, accept bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j := s.jobs[id]
	if j == nil || j.State != "pending" {
		return errors.New("This offer is no longer waiting")
	}
	select {
	case j.decision <- accept:
		j.State = "waiting"
		return nil
	default:
		return errors.New("Already answered")
	}
}
func (s *Service) Cancel(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	j := s.jobs[id]
	if j == nil || !active(j.State) {
		return errors.New("Transfer is no longer active")
	}
	j.State = "cancelled"
	if j.cancel != nil {
		j.cancel()
	}
	return nil
}

func certificate() (tls.Certificate, string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, "", err
	}
	t := &x509.Certificate{SerialNumber: serial, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(2 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, t, t, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	h := sha256.Sum256(der)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, hex.EncodeToString(h[:]), nil
}

func client(fingerprint string) *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Peer redirects are not allowed") }, Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, DisableKeepAlives: true, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 125 * time.Second, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, InsecureSkipVerify: true, // Identity is the explicitly pinned certificate, not a public CA hostname.
		VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errors.New("Missing peer certificate")
			}
			h := sha256.Sum256(cs.PeerCertificates[0].Raw)
			if hex.EncodeToString(h[:]) != fingerprint {
				return errors.New("Peer fingerprint changed; reconnect and verify the device")
			}
			return nil
		},
	}}}
}
func jsonResponse(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		http.Error(w, "Invalid request", 400)
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		http.Error(w, "Invalid request", 400)
		return false
	}
	return true
}
func validFile(name string, size int64) bool {
	if name == "" || name == "." || name == ".." || len(name) > 200 || size < 0 || size > 1<<50 || strings.ContainsAny(name, "/\\:\x00<>\"|?*") || strings.TrimRight(name, " .") != name {
		return false
	}
	for _, r := range name {
		if r < 32 {
			return false
		}
	}
	base := strings.ToUpper(strings.Split(name, ".")[0])
	if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || (len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '0' && base[3] <= '9') {
		return false
	}
	return true
}
