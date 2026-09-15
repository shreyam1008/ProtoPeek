package localshare

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type offerRequest struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Sender string `json:"sender"`
}
type offerResponse struct {
	ID    string `json:"id"`
	Token string `json:"token"`
}
type receipt struct {
	SHA256 string `json:"sha256"`
}

func (s *Service) info(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	jsonResponse(w, map[string]any{"protocol": protocol, "name": s.name, "fingerprint": s.fingerprint})
}
func (s *Service) offer(w http.ResponseWriter, r *http.Request) {
	var in offerRequest
	if !decode(w, r, &in) {
		return
	}
	if !validFile(in.Name, in.Size) || len(in.Sender) > 80 {
		http.Error(w, "Invalid file details", 400)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	j, err := s.newJob(in.Name, in.Sender+" ("+host+")", "receive", in.Size, cancel)
	if err != nil {
		cancel()
		http.Error(w, err.Error(), 429)
		return
	}
	s.update(j.ID, func(j *Job) {
		if j.State != "cancelled" {
			j.State = "pending"
		}
		j.ctx = ctx
	})
	timer := time.NewTimer(2 * time.Minute)
	defer timer.Stop()
	select {
	case accepted := <-j.decision:
		if !accepted {
			cancel()
			s.finish(j.ID, errors.New("Declined by receiver"), "", "")
			http.Error(w, "Receiver declined this file", 403)
			return
		}
	case <-r.Context().Done():
		cancel()
		s.finish(j.ID, errors.New("Sender disconnected"), "", "")
		return
	case <-ctx.Done():
		s.finish(j.ID, errors.New("Transfer cancelled"), "", "")
		http.Error(w, "Transfer cancelled", 409)
		return
	case <-timer.C:
		cancel()
		s.finish(j.ID, errors.New("Offer expired after two minutes"), "", "")
		http.Error(w, "Receiver did not answer within two minutes", 408)
		return
	}
	token := randomID()
	s.update(j.ID, func(j *Job) { j.token = token })
	jsonResponse(w, offerResponse{ID: j.ID, Token: token})
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Minute):
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		if j.State == "waiting" {
			j.State = "failed"
			j.Error = "Sender did not start uploading"
			j.cancel()
		}
	}()
}

func (s *Service) upload(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	j := s.jobs[r.URL.Query().Get("id")]
	if j == nil || j.Direction != "receive" || j.State != "waiting" || j.token == "" || r.Header.Get("Authorization") != "Bearer "+j.token {
		s.mu.Unlock()
		http.Error(w, "Invalid or expired transfer token", 403)
		return
	}
	if r.ContentLength != j.Size {
		s.mu.Unlock()
		http.Error(w, "File size differs from the accepted offer", 400)
		return
	}
	j.State = "receiving"
	j.token = ""
	directory := s.directory
	s.mu.Unlock()
	defer j.cancel()
	stop := context.AfterFunc(j.ctx, func() { _ = r.Body.Close() })
	defer stop()
	root, err := os.OpenRoot(directory)
	if err != nil {
		s.finish(j.ID, err, "", "")
		http.Error(w, "Receive directory unavailable", 500)
		return
	}
	defer root.Close()
	temp := ".protopeek-" + randomID() + ".part"
	f, err := root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		s.finish(j.ID, err, "", "")
		http.Error(w, "Cannot create receive file", 500)
		return
	}
	defer root.Remove(temp)
	h := sha256.New()
	reader := &progressReader{reader: io.LimitReader(r.Body, j.Size+1), service: s, id: j.ID, deadline: func() { _ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(30 * time.Second)) }}
	n, err := io.CopyBuffer(io.MultiWriter(f, h), reader, make([]byte, 256<<10))
	if err == nil && n != j.Size {
		err = errors.New("Incomplete file; partial data removed")
	}
	if err == nil {
		err = j.ctx.Err()
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	name := j.Name
	// Serialize publication with cancellation: a successful cancellation never
	// publishes a file afterwards, and an already published file is completed.
	s.mu.Lock()
	if err == nil && j.State == "cancelled" {
		err = context.Canceled
	}
	if err == nil {
		// A hard link publishes the complete file atomically without replacing an existing path.
		err = root.Link(temp, name)
		if os.IsExist(err) {
			ext := filepath.Ext(name)
			name = strings.TrimSuffix(name, ext) + "-" + randomID()[:8] + ext
			err = root.Link(temp, name)
		}
		if err != nil && !os.IsExist(err) {
			// FAT/exFAT and some network volumes do not support hard links.
			// Reserve a fresh directory and atomically rename within that volume.
			folder := "ProtoPeek-" + randomID()[:12]
			if mkdirErr := root.Mkdir(folder, 0700); mkdirErr == nil {
				name = filepath.Join(folder, j.Name)
				err = root.Rename(temp, name)
				if err != nil {
					_ = root.Remove(folder)
				}
			}
		}
	}
	digest := hex.EncodeToString(h.Sum(nil))
	if err == nil {
		j.State = "completed"
		j.SHA256 = digest
		j.Path = filepath.Join(directory, name)
	}
	s.mu.Unlock()
	if err != nil {
		s.finish(j.ID, err, "", "")
		http.Error(w, "Transfer failed; partial file removed", 500)
		return
	}
	jsonResponse(w, receipt{SHA256: digest})
}

type progressReader struct {
	reader   io.Reader
	service  *Service
	id       string
	deadline func()
}

func (p *progressReader) Read(b []byte) (int, error) {
	if p.deadline != nil {
		p.deadline()
	}
	n, err := p.reader.Read(b)
	if n > 0 {
		p.service.update(p.id, func(j *Job) { j.Bytes += int64(n) })
	}
	return n, err
}

// Connect pins the certificate fingerprint supplied by the receiver's invitation.
// IP literals keep discovery bounded and avoid DNS rebinding and proxy routing.
func (s *Service) Connect(ctx context.Context, address, fingerprint string) (Peer, error) {
	host, port, err := net.SplitHostPort(address)
	portNumber, portErr := strconv.Atoi(port)
	if err != nil || net.ParseIP(host) == nil || portErr != nil || portNumber < 1 || portNumber > 65535 {
		return Peer{}, errors.New("Use an IP address and port, for example 192.168.1.20:53318 or [fd00::20]:53318")
	}
	if len(fingerprint) != 64 {
		return Peer{}, errors.New("Paste the receiver's full SHA-256 fingerprint")
	}
	if _, err := hex.DecodeString(fingerprint); err != nil {
		return Peer{}, errors.New("Invalid fingerprint")
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://"+address+"/protopeek-share/v1/info", nil)
	resp, err := client(strings.ToLower(fingerprint)).Do(req)
	if err != nil {
		return Peer{}, err
	}
	defer resp.Body.Close()
	var in struct {
		Protocol    string `json:"protocol"`
		Name        string `json:"name"`
		Fingerprint string `json:"fingerprint"`
	}
	if resp.StatusCode != 200 || json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&in) != nil || in.Protocol != protocol || len(in.Name) > 80 {
		return Peer{}, errors.New("This address is not a ProtoPeek transfer receiver")
	}
	p := Peer{ID: strings.ToLower(fingerprint), Name: in.Name, Address: address, Seen: time.Now(), Manual: true}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return Peer{}, errors.New("Enable local transfer first")
	}
	if len(s.peers) >= 128 {
		return Peer{}, errors.New("Nearby device limit reached")
	}
	s.peers[p.ID] = p
	return p, nil
}

// Send streams the request body to the peer without staging or loading the file in RAM.
func (s *Service) Send(ctx context.Context, peerID, name string, size int64, body io.Reader) error {
	if !validFile(name, size) {
		return errors.New("Invalid file name or size")
	}
	s.mu.Lock()
	p, ok := s.peers[peerID]
	sender := s.name
	s.mu.Unlock()
	if !ok {
		return errors.New("Connect to the receiver first")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if closer, ok := body.(io.ReadCloser); ok {
		stop := context.AfterFunc(ctx, func() { _ = closer.Close() })
		defer stop()
	}
	j, err := s.newJob(name, p.Name+" ("+p.Address+")", "send", size, cancel)
	if err != nil {
		return err
	}
	digest := ""
	defer func() { s.finish(j.ID, err, digest, "") }()
	c := client(p.ID)
	data, _ := json.Marshal(offerRequest{Name: name, Size: size, Sender: sender})
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://"+p.Address+"/protopeek-share/v1/offer", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	var offer offerResponse
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		resp.Body.Close()
		err = fmt.Errorf("Peer: %s", strings.TrimSpace(string(b)))
		return err
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&offer)
	resp.Body.Close()
	if err != nil {
		return err
	}
	if len(offer.ID) != 48 || len(offer.Token) != 48 {
		err = errors.New("Invalid transfer session from peer")
		return err
	}
	s.update(j.ID, func(j *Job) {
		if j.State != "cancelled" {
			j.State = "sending"
		}
	})
	h := sha256.New()
	reader := &progressReader{reader: io.TeeReader(io.LimitReader(body, size), h), service: s, id: j.ID}
	req, err = http.NewRequestWithContext(ctx, "POST", "https://"+p.Address+"/protopeek-share/v1/upload?id="+url.QueryEscape(offer.ID), reader)
	if err != nil {
		return err
	}
	req.ContentLength = size
	// Go treats a zero content length and non-nil body as unknown/chunked.
	if size == 0 {
		req.Body = http.NoBody
	}
	req.Header.Set("Authorization", "Bearer "+offer.Token)
	resp, err = c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		err = fmt.Errorf("Receiver could not save the file (HTTP %d)", resp.StatusCode)
		return err
	}
	var result receipt
	err = json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&result)
	if err != nil {
		return err
	}
	digest = hex.EncodeToString(h.Sum(nil))
	if digest != result.SHA256 {
		err = errors.New("Receiver checksum did not match the sent file")
		return err
	}
	return nil
}
