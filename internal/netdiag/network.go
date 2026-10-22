package netdiag

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"os"
	"slices"
	"strings"
	"syscall"
	"time"
)

func (engine Engine) connect(parent context.Context, timeoutMS int, network string, target endpoint, address netip.Addr) (net.Conn, Check, func()) {
	started := time.Now()
	ctx, cancel := context.WithTimeout(parent, time.Duration(timeoutMS)*time.Millisecond)
	check := Check{Stage: network, Address: net.JoinHostPort(address.String(), target.port)}
	dial := engine.Dial
	if dial == nil {
		dial = (&net.Dialer{}).DialContext
	}
	conn, err := dial(ctx, network, check.Address)
	check.DurationMS = elapsed(started)
	if err != nil {
		err = probeIOError(ctx, err)
		cancel()
		check.Outcome, check.Detail = networkError(err)
		return nil, check, func() {}
	}
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	check.Local, check.Outcome = conn.LocalAddr().String(), "connected"
	return probeConn{Conn: conn, context: ctx}, check, func() { stop(); _ = conn.Close(); cancel() }
}

// Closing a socket on cancellation can race its deadline and return ErrClosed.
// Preserve the probe context's authoritative cause at the I/O boundary.
type probeConn struct {
	net.Conn
	context context.Context
}

func probeIOError(ctx context.Context, err error) error {
	if err != nil && ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}
func (conn probeConn) Read(data []byte) (int, error) {
	n, err := conn.Conn.Read(data)
	return n, probeIOError(conn.context, err)
}
func (conn probeConn) Write(data []byte) (int, error) {
	n, err := conn.Conn.Write(data)
	return n, probeIOError(conn.context, err)
}

func networkError(err error) (string, string) {
	if errors.Is(err, context.Canceled) {
		return "cancelled", "Cancelled locally."
	}
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, os.ErrDeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
		return "timeout", "No completion before this probe's deadline."
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return "refused", "The operating system reported connection refused."
	}
	if outcome, detail, ok := platformNetworkError(err); ok {
		return outcome, detail
	}
	if errors.Is(err, syscall.ENETUNREACH) || errors.Is(err, syscall.EHOSTUNREACH) {
		return "unreachable", "The operating system reported an unreachable network or host."
	}
	// Callers must not include a remote response or credential-bearing request in errors.
	return "failed", "The operating system could not complete this network operation."
}

func (engine Engine) sample(ctx context.Context, input Request, target endpoint, address netip.Addr, result *Result) {
	stats := &Statistics{Requested: input.Samples}
	result.Statistics = stats
	var durations []float64
	for index := 0; index < input.Samples && ctx.Err() == nil; index++ {
		conn, check, closeConn := engine.connect(ctx, input.TimeoutMS, "tcp", target, address)
		if conn != nil {
			stats.Connected++
			durations = append(durations, check.DurationMS)
		}
		closeConn()
		stats.Completed++
		if check.Outcome == "refused" {
			stats.Refused++
		}
		if check.Outcome == "timeout" {
			stats.Timeouts++
		}
		result.Samples = append(result.Samples, check)
		if index+1 < input.Samples && input.IntervalMS > 0 {
			timer := time.NewTimer(time.Duration(input.IntervalMS) * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
			case <-timer.C:
			}
		}
	}
	if len(durations) > 0 {
		slices.Sort(durations)
		minValue, median, p95 := durations[0], durations[len(durations)/2], durations[(len(durations)*95+99)/100-1]
		if len(durations)%2 == 0 {
			median = (durations[len(durations)/2-1] + median) / 2
		}
		stats.MinMS, stats.MedianMS, stats.P95MS = &minValue, &median, &p95
	}
	result.Summary = "Finite TCP connection samples to one pinned address. Timing includes connection setup, not application latency."
	if stats.Connected == 0 {
		result.Outcome = "failed"
	} else if stats.Connected < stats.Requested {
		result.Outcome = "partial"
	}
}

func (engine Engine) exchange(ctx context.Context, input Request, target endpoint, address netip.Addr, result *Result) {
	protocol := strings.TrimSuffix(input.Mode, "-exchange")
	evidence := &Exchange{Protocol: protocol, Outcome: "failed"}
	result.Exchange = evidence
	conn, check, closeConn := engine.connect(ctx, input.TimeoutMS, protocol, target, address)
	defer closeConn()
	if protocol == "udp" && conn != nil {
		check.Outcome = "socket-open"
		check.Detail = "A UDP socket does not establish remote availability."
	}
	result.Checks = append(result.Checks, check)
	if conn == nil {
		result.Outcome, result.Summary = "failed", "No exchange was performed."
		return
	}
	payload, _ := payloadBytes(input)
	if len(payload) > 0 {
		n, err := conn.Write(payload)
		evidence.SentBytes = n
		if err != nil || n != len(payload) {
			if err == nil {
				err = io.ErrShortWrite
			}
			evidence.Outcome, evidence.Detail = networkError(err)
			result.Outcome = "failed"
			return
		}
	}
	// One UDP datagram; TCP reads until EOF, deadline or the explicit byte cap.
	data := make([]byte, MaxReplyBytes+1)
	var n int
	var err error
	if protocol == "udp" {
		n, err = conn.Read(data)
	} else {
		n, err = io.ReadFull(conn, data)
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			err = nil
		}
	}
	evidence.Limited = n > MaxReplyBytes
	if evidence.Limited {
		n = MaxReplyBytes
	}
	evidence.ReceivedBytes, evidence.ReplyHex = n, hex.EncodeToString(data[:n])
	evidence.ReplyText = strings.ToValidUTF8(string(data[:n]), "�")
	if err != nil {
		evidence.Outcome, evidence.Detail = networkError(err)
		if n > 0 {
			detail := fmt.Sprintf("Received %d bytes before the read ended; peer completion was not observed.", n)
			if evidence.Outcome == "timeout" {
				detail = fmt.Sprintf("Received %d bytes before the local read deadline; peer completion was not observed.", n)
			}
			evidence.Outcome, evidence.Detail = "partial", detail
		}
	} else {
		evidence.Outcome = "received"
	}
	result.Outcome = evidence.Outcome
	result.Summary = "Raw exchange finished. Payload and reply are held only in this result; no protocol health is inferred."
	if protocol == "udp" {
		result.Warnings = append(result.Warnings, "UDP has no delivery acknowledgement. Silence is not proof that a port is closed.")
	}
}
