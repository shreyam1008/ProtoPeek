package localshare

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type unreadOfferBody struct{ read atomic.Bool }

func (body *unreadOfferBody) Read([]byte) (int, error) {
	body.read.Store(true)
	return 0, errors.New("rejected offer body was read")
}

func TestOfferAdmissionPrecedesBodyAndRecoversOnCancellation(t *testing.T) {
	service := New()
	service.server = &http.Server{}
	var requests sync.WaitGroup
	var cancellations []context.CancelFunc
	defer func() {
		for _, cancel := range cancellations {
			cancel()
		}
		requests.Wait()
	}()
	for range maxOffers {
		ctx, cancel := context.WithCancel(context.Background())
		cancellations = append(cancellations, cancel)
		request := httptest.NewRequest(http.MethodPost, "/protopeek-share/v1/offer", strings.NewReader(`{"name":"trace.pcap","size":1,"sender":"Owned test peer"}`)).WithContext(ctx)
		requests.Go(func() { service.offer(httptest.NewRecorder(), request) })
	}
	deadline := time.Now().Add(3 * time.Second)
	for len(service.Snapshot().Jobs) != maxOffers {
		if time.Now().After(deadline) {
			t.Fatal("the four admitted offers did not reach receiver review")
		}
		time.Sleep(time.Millisecond)
	}
	body := &unreadOfferBody{}
	rejected := httptest.NewRecorder()
	service.offer(rejected, httptest.NewRequest(http.MethodPost, "/protopeek-share/v1/offer", body))
	if rejected.Code != http.StatusTooManyRequests || body.read.Load() || rejected.Header().Get("Retry-After") != "1" {
		t.Fatalf("capacity rejection: code=%d read=%v headers=%v", rejected.Code, body.read.Load(), rejected.Header())
	}
	for _, cancel := range cancellations {
		cancel()
	}
	requests.Wait()
	retry := httptest.NewRecorder()
	service.offer(retry, httptest.NewRequest(http.MethodPost, "/protopeek-share/v1/offer", strings.NewReader(`{"name":"../invalid","size":1}`)))
	if retry.Code != http.StatusBadRequest {
		t.Fatalf("cancelled offers retained admission slots: %d %s", retry.Code, retry.Body.String())
	}
}

func TestSlowOfferBodyHasNativeReadDeadline(t *testing.T) {
	service := New()
	server := httptest.NewTLSServer(http.HandlerFunc(service.offer))
	defer server.Close()
	tlsConfig := server.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	connection, err := tls.DialWithDialer(&net.Dialer{Timeout: 2 * time.Second}, "tcp", server.Listener.Addr().String(), tlsConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err := connection.SetDeadline(time.Now().Add(offerBodyTimeout + 3*time.Second)); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	_, err = fmt.Fprint(connection, "POST /protopeek-share/v1/offer HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{\"name\":")
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(connection), nil)
	if err != nil {
		t.Fatalf("slow metadata was not rejected before the outer test deadline: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest || time.Since(started) < offerBodyTimeout/2 {
		t.Fatalf("unexpected slow-body result: status=%d elapsed=%s", response.StatusCode, time.Since(started))
	}
	if len(service.Snapshot().Jobs) != 0 || len(service.offers) != 0 {
		t.Fatal("invalid metadata created a transfer or retained admission")
	}
}
