package standalone

import "testing"

func TestValidateScanAddress(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		address      string
		allowPrivate bool
		wantErr      bool
	}{
		{name: "localhost", address: "localhost:50051"},
		{name: "localhost absolute hostname denied", address: "localhost.:50051", wantErr: true},
		{name: "ipv4 loopback", address: "127.0.0.1:9090"},
		{name: "ipv6 loopback", address: "[::1]:50051"},
		{name: "private denied by default", address: "192.168.1.20:50051", wantErr: true},
		{name: "private explicit", address: "192.168.1.20:50051", allowPrivate: true},
		{name: "public always denied", address: "8.8.8.8:443", allowPrivate: true, wantErr: true},
		{name: "hostname denied", address: "api.example.test:443", allowPrivate: true, wantErr: true},
		{name: "missing port", address: "localhost", wantErr: true},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			err := validateScanAddress(test.address, test.allowPrivate)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateScanAddress(%q, %v) error = %v, wantErr %v", test.address, test.allowPrivate, err, test.wantErr)
			}
		})
	}
}
