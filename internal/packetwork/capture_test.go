package packetwork

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestCapturePlanAndInterfaces(t *testing.T) {
	valid := CaptureRequest{Interface: "Ethernet", Host: "::1", Port: 443, Seconds: 5, Packets: 2000, Consent: true}
	args, err := PlanCapture(valid)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(args, "|"), "-f|host ::1 and port 443|-w|-") {
		t.Fatal(args)
	}
	for _, alter := range []func(*CaptureRequest){func(p *CaptureRequest) { p.Interface = "rpcap://remote/eth0" }, func(p *CaptureRequest) { p.Interface = "TCP@host:80" }, func(p *CaptureRequest) { p.Interface = `\\.\pipe\capture` }, func(p *CaptureRequest) { p.Consent = false }, func(p *CaptureRequest) { p.Host = "example.com" }, func(p *CaptureRequest) { p.Host = "::1; echo hi" }, func(p *CaptureRequest) { p.Host = ""; p.Port = 0 }, func(p *CaptureRequest) { p.Seconds = 31 }, func(p *CaptureRequest) { p.Packets = 2001 }} {
		p := valid
		alter(&p)
		if _, err := PlanCapture(p); err == nil {
			t.Fatal("accepted invalid capture", p)
		}
	}
	list, err := parseInterfaces("1. \\Device\\NPF_{123} (Ethernet)\n2. lo (Loopback)\n")
	if err != nil || len(list) != 2 || list[1].Name != "lo" {
		t.Fatal(list, err)
	}
	for _, bad := range []string{"warning: bad", "1. eth0\n2. eth0"} {
		if _, err := parseInterfaces(bad); err == nil {
			t.Fatal("accepted bad listing")
		}
	}
}

func TestCaptureHelperProcess(t *testing.T) {
	if os.Getenv("PROTOPEEK_PACKET_TEST_HELPER") != "1" {
		return
	}
	if os.Args[len(os.Args)-1] == "wait" {
		time.Sleep(30 * time.Second)
		os.Exit(0)
	}
	_, _ = os.Stdout.Write(make([]byte, 64<<10))
	os.Exit(0)
}

func TestCaptureCancellationAndOutputCap(t *testing.T) {
	t.Setenv("PROTOPEEK_PACKET_TEST_HELPER", "1")
	path, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := runCaptureTool(ctx, path, []string{"-test.run=TestCaptureHelperProcess", "--", "wait"}, 1024); err == nil {
		t.Fatal("capture did not cancel")
	}
	if time.Since(start) > 3*time.Second {
		t.Fatal("slow capture teardown")
	}
	ctx, cancel = context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := runCaptureTool(ctx, path, []string{"-test.run=TestCaptureHelperProcess", "--", "flood"}, 1024); err == nil {
		t.Fatal("output cap not enforced")
	}
}
