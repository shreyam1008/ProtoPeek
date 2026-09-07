// Package capnpfixture provides a local, schema-compatible RPC peer for browser
// QA and integration tests. It uses the upstream server runtime directly.
package capnpfixture

import (
	"context"
	"errors"
	"net"
	"time"

	"capnproto.org/go/capnp/v3"
	"capnproto.org/go/capnp/v3/rpc"
	"capnproto.org/go/capnp/v3/server"
)

const InterfaceID uint64 = 0xb1529bf8e102de33

func ServeConnection(socket net.Conn) {
	methods := []server.Method{
		{Method: capnp.Method{InterfaceID: InterfaceID, MethodID: 0}, Impl: func(_ context.Context, call *server.Call) error {
			value, err := call.Args().Ptr(0)
			if err != nil {
				return err
			}
			result, err := call.AllocResults(capnp.ObjectSize{PointerCount: 1})
			if err != nil {
				return err
			}
			return result.SetPtr(0, value)
		}},
		{Method: capnp.Method{InterfaceID: InterfaceID, MethodID: 1}, Impl: func(_ context.Context, call *server.Call) error {
			result, err := call.AllocResults(capnp.ObjectSize{DataSize: 8})
			if err != nil {
				return err
			}
			result.SetUint64(0, call.Args().Uint64(0)+call.Args().Uint64(8))
			return nil
		}},
		{Method: capnp.Method{InterfaceID: InterfaceID, MethodID: 2}, Impl: func(context.Context, *server.Call) error { return errors.New("deliberate QA RPC failure") }},
		{Method: capnp.Method{InterfaceID: InterfaceID, MethodID: 3}, Impl: func(ctx context.Context, call *server.Call) error {
			delay := min(call.Args().Uint32(0), 30000)
			timer := time.NewTimer(time.Duration(delay) * time.Millisecond)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
			}
			result, err := call.AllocResults(capnp.ObjectSize{DataSize: 8})
			if err != nil {
				return err
			}
			result.SetBit(0, true)
			return nil
		}},
	}
	peer := capnp.NewClient(server.New(methods, nil, nil))
	connection := rpc.NewConn(rpc.NewStreamTransport(socket), &rpc.Options{BootstrapClient: peer, AbortTimeout: 100 * time.Millisecond})
	defer connection.Close()
	<-connection.Done()
}
