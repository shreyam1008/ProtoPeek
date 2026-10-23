# WebSocket and SSE workbench

Open **Inspect → Event streams** to observe a service’s live messages through the local Go
process. WebSocket and Server-Sent Events are available in stable v0.6.1. They retain their own
connection and message evidence; this is separate from gRPC streaming RPCs.

## Connect to one endpoint

1. Choose **WebSocket** or **SSE**.
2. Enter a `ws://` or `wss://` URL for WebSocket, or `http://` or `https://` for SSE.
3. Add headers only when needed. For WebSocket, optional subprotocol names are comma-separated.
4. Set the session duration and choose **Connect**.

Opening the tool or editing the form sends nothing. Connect opens a real upstream connection
from the machine running ProtoPeek, which may differ from the browser’s machine. URLs cannot
contain user/password credentials or a fragment. TLS certificates are verified and redirects
are not followed.

## Read and send messages

Choose a timeline row to read its details. WebSocket records received text or base64 binary
messages and the negotiated subprotocol. After connecting, choose text or base64 encoding,
prepare a message, and select **Send message** when you intend to deliver it. A send can change service
state; connection success alone does not prove the application accepted a message.

SSE is receive-only. Its timeline keeps multiline data, event names and event IDs together.
ProtoPeek does not reconnect automatically. If the service supports resumption, add an explicit
`Last-Event-ID` request header before a new connection.

Timeline offsets are browser observation times since Connect, not server emission times or
one-way latency. A disconnected or capped stream is not a complete history of the service.

## Stop and keep the limits visible

Choose **Disconnect** to stop waiting and close the upstream connection. Leaving Event streams
also cancels it. Previously delivered WebSocket messages may already have taken effect.

- Duration: 0.1–120 seconds, with a 60-second default.
- Each session stops at 500 received messages or 2 MiB, with a 64 KiB per-message limit.
- A WebSocket session allows at most 200 sends.
- The interface retains the latest 200 timeline rows; two stream sessions may run per server.
- Headers and payloads stay in memory and are not an automatic saved collection.

These are explicit finite sessions, with no background polling, cloud sync or hidden retry.
Network and service permissions still belong to the host and upstream service.

## Related workflows

- [Build an HTTP request](http-workbench.md) for a response body, headers, redirects and timing.
- [Inspect gRPC streams](grpc-workbench.md) for RPC messages, headers, trailers and final status.
- [Keep transport evidence distinct](transport-boundaries.md).
