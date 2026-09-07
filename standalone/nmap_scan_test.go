package standalone

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestNmapPlansAreExplicitAndBounded(t *testing.T) {
	for _, target := range []string{"--script=all", "example.com", "0.0.0.0", "224.1.2.3", "fe80::1%12", "192.168.0.0/16", "8.8.8.0/24", "::/0"} {
		if _, err := planNmapScan(nmapScanRequest{Target: target, Ports: "80"}); err == nil {
			t.Fatalf("accepted %q", target)
		}
	}
	if _, err := planNmapScan(nmapScanRequest{Target: "192.168.1.0/24", Ports: "1-17"}); err == nil {
		t.Fatal("accepted more than 4096 host ports")
	}
	for _, target := range []string{"127.0.0.1", "::1", "1.1.1.1", "192.168.1.0/28"} {
		plan, err := planNmapScan(nmapScanRequest{Target: target, Ports: "443,80,80", DetectServices: true})
		if err != nil {
			t.Fatal(err)
		}
		args := strings.Join(plan.Arguments, " ")
		for _, want := range []string{"-sT -Pn -n --unprivileged", "-p 80,443", "--host-timeout 15s", "-sV --version-light"} {
			if !strings.Contains(args, want) {
				t.Fatalf("missing %s: %s", want, args)
			}
		}
		if plan.Arguments[len(plan.Arguments)-1] != target {
			t.Fatal("target must be one final literal argument")
		}
	}
}

func TestNmapPOSTRejectsBeforeStartingProcess(t *testing.T) {
	handler := Handler(nil, "", nil, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("POST", "/api/nmap/scan", strings.NewReader(`{"target":"127.0.0.1","ports":"80","consent":true}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("missing CSRF accepted: %d", response.Code)
	}
	cookie := handlerCSRFCookie(t, handler)
	for _, body := range []string{`{"target":"127.0.0.1","ports":"80","consent":false}`, `{"target":"127.0.0.1","ports":"80","consent":true,"arguments":["--script=all"]}`} {
		request := httptest.NewRequest("POST", "/api/nmap/scan", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(csrfHeaderName, cookie.Value)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 400 {
			t.Fatalf("invalid body = %d %s", response.Code, response.Body.String())
		}
	}
}

func TestNmapHelperProcess(t *testing.T) {
	mode := os.Getenv("PROTOPEEK_NMAP_TEST_HELPER")
	if mode == "" {
		return
	}
	switch mode {
	case "xml":
		data, _ := os.ReadFile("testdata/nmap-basic.xml")
		_, _ = os.Stdout.Write(data)
	case "wait":
		time.Sleep(time.Minute)
	case "oversize":
		_, _ = fmt.Fprint(os.Stdout, strings.Repeat("x", maxNmapXMLBytes+1))
	}
	os.Exit(0)
}

func TestNmapProcessOutputAndCancellation(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	plan := nmapScanPlan{Arguments: []string{"-test.run=^TestNmapHelperProcess$"}}
	t.Setenv("PROTOPEEK_NMAP_TEST_HELPER", "xml")
	result, err := executeNmap(context.Background(), executable, plan)
	if err != nil || len(result.Inventory.Hosts) != 1 || !result.Inventory.Complete {
		t.Fatalf("parse process result: %#v %v", result, err)
	}
	t.Setenv("PROTOPEEK_NMAP_TEST_HELPER", "oversize")
	if _, err := executeNmap(context.Background(), executable, plan); err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("output limit: %v", err)
	}
	t.Setenv("PROTOPEEK_NMAP_TEST_HELPER", "wait")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = executeNmap(ctx, executable, plan)
	if err == nil || time.Since(start) > 3*time.Second {
		t.Fatalf("process cancellation: %v after %s", err, time.Since(start))
	}
}

func TestInstalledNmapLoopback(t *testing.T) {
	if os.Getenv("PROTOPEEK_NMAP_INTEGRATION") != "1" {
		t.Skip("set PROTOPEEK_NMAP_INTEGRATION=1 with installed Nmap")
	}
	path, err := exec.LookPath("nmap")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Server", "ProtoPeek-fixture")
		_, _ = fmt.Fprint(w, "fixture")
	}))
	defer server.Close()
	port := strings.Split(server.URL, ":")[2]
	plan, err := planNmapScan(nmapScanRequest{Target: "127.0.0.1", Ports: port})
	if err != nil {
		t.Fatal(err)
	}
	result, err := executeNmap(context.Background(), path, plan)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Inventory.Hosts) != 1 || len(result.Inventory.Hosts[0].Ports) != 1 || result.Inventory.Hosts[0].Ports[0].State != "open" {
		t.Fatalf("missing loopback evidence: %#v", result)
	}
}
