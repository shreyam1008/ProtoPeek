package netdiag

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"net/netip"

	"golang.org/x/net/http2"
)

func (engine Engine) http2(ctx context.Context, input Request, target endpoint, address netip.Addr, result *Result) {
	evidence := &HTTP2Evidence{Protocol: "h2c prior knowledge", Settings: []string{}}
	result.HTTP2 = evidence
	conn, check, closeConn := engine.connect(ctx, input.TimeoutMS, "tcp", target, address)
	defer closeConn()
	result.Checks = append(result.Checks, check)
	result.Outcome, result.Summary = "failed", "No valid cleartext HTTP/2 SETTINGS exchange was observed."
	if conn == nil {
		return
	}
	if _, err := io.WriteString(conn, http2.ClientPreface); err != nil {
		return
	}
	framer := http2.NewFramer(conn, conn)
	framer.SetMaxReadFrameSize(16 << 10)
	if err := framer.WriteSettings(); err != nil {
		return
	}
	var nonce [8]byte
	_, _ = rand.Read(nonce[:])
	if err := framer.WritePing(false, nonce); err != nil {
		return
	}
	gotSettings := false
	for index := 0; index < 16 && ctx.Err() == nil; index++ {
		frame, err := framer.ReadFrame()
		if err != nil {
			evidence.Detail = "Peer closed, timed out, or sent an invalid/oversized HTTP/2 frame."
			return
		}
		if index == 0 {
			settings, ok := frame.(*http2.SettingsFrame)
			if !ok || settings.IsAck() {
				evidence.Detail = "The first server frame was not a non-ACK SETTINGS frame."
				return
			}
		}
		switch value := frame.(type) {
		case *http2.SettingsFrame:
			if value.IsAck() {
				continue
			}
			gotSettings = true
			if err := value.ForeachSetting(func(setting http2.Setting) error {
				if err := setting.Valid(); err != nil {
					return err
				}
				if len(evidence.Settings) < 64 {
					evidence.Settings = append(evidence.Settings, fmt.Sprintf("%s=%d", setting.ID, setting.Val))
				}
				return nil
			}); err != nil {
				evidence.Detail = "Peer sent invalid HTTP/2 settings."
				return
			}
			if err := framer.WriteSettingsAck(); err != nil {
				return
			}
		case *http2.PingFrame:
			if value.IsAck() && value.Data == nonce {
				evidence.PingAck = true
			} else if !value.IsAck() {
				if err := framer.WritePing(true, value.Data); err != nil {
					return
				}
			}
		case *http2.GoAwayFrame:
			evidence.Detail = fmt.Sprintf("Peer sent GOAWAY (%s).", value.ErrCode)
			return
		}
		if gotSettings && evidence.PingAck {
			result.Outcome, result.Summary = "success", "Cleartext HTTP/2 SETTINGS and a matching PING acknowledgement were observed. No request stream was opened."
			evidence.Detail = "Prior knowledge only. HTTP/1.1 Upgrade and application health were not tested."
			return
		}
	}
	evidence.Detail = "Stopped after 16 frames without a matching PING acknowledgement."
}
