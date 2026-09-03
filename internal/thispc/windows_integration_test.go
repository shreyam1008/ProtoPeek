//go:build windows

package thispc

import (
	"context"
	"net"
	"os"
	"testing"
	"time"
)

func TestWindowsNativeThisPCIntegration(t *testing.T) {
	if os.Getenv("PROTOPEEK_WINDOWS_INTEGRATION") != "1" {
		t.Skip("set PROTOPEEK_WINDOWS_INTEGRATION=1 to exercise native Windows IP Helper APIs")
	}
	tcpListener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer tcpListener.Close()
	udpListener, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer udpListener.Close()

	service := NewService()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	snapshot, err := service.Snapshot(ctx)
	if err != nil {
		t.Fatalf("Snapshot() error = %v", err)
	}
	if len(snapshot.Interfaces) == 0 {
		t.Fatal("Snapshot() returned no Windows interfaces")
	}
	counterInterfaces := 0
	for _, networkInterface := range snapshot.Interfaces {
		if networkInterface.Traffic != nil {
			counterInterfaces++
		}
	}
	if counterInterfaces == 0 {
		t.Fatalf("Snapshot() returned no native counters: %#v", snapshot.Notes)
	}

	activity, err := service.Activity(ctx)
	if err != nil {
		t.Fatalf("Activity() error = %v", err)
	}
	wantTCPPort := uint16(tcpListener.Addr().(*net.TCPAddr).Port)
	wantUDPPort := uint16(udpListener.LocalAddr().(*net.UDPAddr).Port)
	foundTCP := false
	foundUDP := false
	foundCurrentProcessOwner := false
	for _, socket := range activity.Listeners {
		if socket.Protocol == "tcp4" && socket.Local.Address == "127.0.0.1" && socket.Local.Port == wantTCPPort {
			foundTCP = true
			if socket.OwnerStatus == "observed" && len(socket.Processes) == 1 && socket.Processes[0].PID == os.Getpid() && socket.Processes[0].Comm != "" {
				foundCurrentProcessOwner = true
			}
		}
		if socket.Protocol == "udp4" && socket.Local.Address == "127.0.0.1" && socket.Local.Port == wantUDPPort {
			foundUDP = true
		}
	}
	if !foundTCP || !foundUDP || !foundCurrentProcessOwner {
		t.Fatalf("native activity missing test evidence: tcp=%v udp=%v owner=%v ports=%d/%d notes=%v", foundTCP, foundUDP, foundCurrentProcessOwner, wantTCPPort, wantUDPPort, activity.Notes)
	}
	if _, err := service.SampleTraffic(ctx, 500*time.Millisecond); err != nil {
		t.Fatalf("SampleTraffic() error = %v", err)
	}
}
