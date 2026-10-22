package capnpwork

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"testing"
	"unicode/utf8"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/rpc"
	"capnproto.org/go/capnp/v3/rpc/transport"
	"capnproto.org/go/capnp/v3/server"
)

func TestSingleCallBoundsRealRemoteExceptionAndPreservesLocalCauses(t *testing.T) {
	s, _ := fixtureSchema(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		socket, err := listener.Accept()
		if err != nil {
			return
		}
		client := capnp.NewClient(server.New([]server.Method{{Method: capnp.Method{InterfaceID: 0xb1529bf8e102de33, MethodID: 2}, Impl: func(context.Context, *server.Call) error {
			return errors.New("remote fixture " + strings.Repeat("界", 10000))
		}}}, nil, nil))
		connection := rpc.NewConn(transport.New(newWireCodec(socket)), &rpc.Options{BootstrapClient: client})
		defer connection.Close()
		<-connection.Done()
	}()
	_, err = s.Call(context.Background(), CallRequest{Address: listener.Addr().String(), Transport: "tcp", TimeoutMs: 2000, InterfaceID: "0xb1529bf8e102de33", Ordinal: 2, Params: json.RawMessage(`{}`)})
	if err == nil || !strings.Contains(err.Error(), "remote fixture") || len(err.Error()) > len("RPC failed: ")+4096 || !utf8.ValidString(err.Error()) {
		t.Fatalf("unbounded remote exception: %v", err)
	}
	for _, cause := range []error{context.Canceled, context.DeadlineExceeded} {
		if !errors.Is(boundedCallError{cause: cause}, cause) {
			t.Fatal("bounded message lost its cancellation identity")
		}
	}
}
