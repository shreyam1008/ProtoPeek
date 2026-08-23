package transfer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"
)

const maxRPCResponseBytes = 1 << 20

type aria2RPC interface {
	AddURI(context.Context, []string, map[string]any) (string, error)
	TellActive(context.Context) ([]aria2Status, error)
	TellWaiting(context.Context, int, int) ([]aria2Status, error)
	TellStopped(context.Context, int, int) ([]aria2Status, error)
	TellStatus(context.Context, string) (aria2Status, error)
	Pause(context.Context, string) error
	Unpause(context.Context, string) error
	Remove(context.Context, string) error
	ForceRemove(context.Context, string) error
	RemoveDownloadResult(context.Context, string) error
	SaveSession(context.Context) error
	Shutdown(context.Context) error
	GetGlobalStat(context.Context) (aria2GlobalStat, error)
	GetVersion(context.Context) (string, error)
}

type rpcClient struct {
	endpoint   string
	secret     string
	httpClient *http.Client
	nextID     atomic.Uint64
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      string `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params,omitempty"`
}

type rpcResponse struct {
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  *RPCError       `json:"error,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (err *RPCError) Error() string {
	return fmt.Sprintf("aria2 RPC error (%d): %s", err.Code, err.Message)
}

type aria2Status struct {
	GID             string      `json:"gid"`
	Status          string      `json:"status"`
	TotalLength     string      `json:"totalLength"`
	CompletedLength string      `json:"completedLength"`
	DownloadSpeed   string      `json:"downloadSpeed"`
	Connections     string      `json:"connections"`
	Dir             string      `json:"dir"`
	ErrorCode       string      `json:"errorCode"`
	ErrorMessage    string      `json:"errorMessage"`
	VerifiedLength  string      `json:"verifiedLength"`
	VerifyPending   string      `json:"verifyIntegrityPending"`
	Files           []aria2File `json:"files"`
}

type aria2File struct {
	Path string     `json:"path"`
	URIs []aria2URI `json:"uris"`
}

type aria2URI struct {
	URI string `json:"uri"`
}

type aria2GlobalStat struct {
	DownloadSpeed string `json:"downloadSpeed"`
	NumActive     string `json:"numActive"`
	NumWaiting    string `json:"numWaiting"`
	NumStopped    string `json:"numStopped"`
}

func newRPCClient(endpoint, secret string) *rpcClient {
	return &rpcClient{
		endpoint: endpoint,
		secret:   secret,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				Proxy:                  nil,
				MaxResponseHeaderBytes: 64 << 10,
			},
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (client *rpcClient) AddURI(ctx context.Context, sources []string, options map[string]any) (string, error) {
	raw, err := client.call(ctx, "aria2.addUri", sources, options)
	if err != nil {
		return "", err
	}
	var id string
	if err := json.Unmarshal(raw, &id); err != nil {
		return "", fmt.Errorf("decode aria2.addUri result: %w", err)
	}
	return id, nil
}

func (client *rpcClient) TellActive(ctx context.Context) ([]aria2Status, error) {
	return client.tellMany(ctx, "aria2.tellActive")
}

func (client *rpcClient) TellWaiting(ctx context.Context, offset, limit int) ([]aria2Status, error) {
	return client.tellMany(ctx, "aria2.tellWaiting", offset, limit)
}

func (client *rpcClient) TellStopped(ctx context.Context, offset, limit int) ([]aria2Status, error) {
	return client.tellMany(ctx, "aria2.tellStopped", offset, limit)
}

func (client *rpcClient) TellStatus(ctx context.Context, id string) (aria2Status, error) {
	raw, err := client.call(ctx, "aria2.tellStatus", id)
	if err != nil {
		return aria2Status{}, err
	}
	var status aria2Status
	if err := json.Unmarshal(raw, &status); err != nil {
		return aria2Status{}, fmt.Errorf("decode aria2.tellStatus result: %w", err)
	}
	return status, nil
}

func (client *rpcClient) Pause(ctx context.Context, id string) error {
	_, err := client.call(ctx, "aria2.pause", id)
	return err
}

func (client *rpcClient) Unpause(ctx context.Context, id string) error {
	_, err := client.call(ctx, "aria2.unpause", id)
	return err
}

func (client *rpcClient) Remove(ctx context.Context, id string) error {
	_, err := client.call(ctx, "aria2.remove", id)
	return err
}

func (client *rpcClient) ForceRemove(ctx context.Context, id string) error {
	_, err := client.call(ctx, "aria2.forceRemove", id)
	return err
}

func (client *rpcClient) RemoveDownloadResult(ctx context.Context, id string) error {
	_, err := client.call(ctx, "aria2.removeDownloadResult", id)
	return err
}

func (client *rpcClient) SaveSession(ctx context.Context) error {
	_, err := client.call(ctx, "aria2.saveSession")
	return err
}

func (client *rpcClient) Shutdown(ctx context.Context) error {
	_, err := client.call(ctx, "aria2.shutdown")
	return err
}

func (client *rpcClient) GetGlobalStat(ctx context.Context) (aria2GlobalStat, error) {
	raw, err := client.call(ctx, "aria2.getGlobalStat")
	if err != nil {
		return aria2GlobalStat{}, err
	}
	var stat aria2GlobalStat
	if err := json.Unmarshal(raw, &stat); err != nil {
		return aria2GlobalStat{}, fmt.Errorf("decode aria2.getGlobalStat result: %w", err)
	}
	return stat, nil
}

func (client *rpcClient) GetVersion(ctx context.Context) (string, error) {
	raw, err := client.call(ctx, "aria2.getVersion")
	if err != nil {
		return "", err
	}
	var version struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &version); err != nil {
		return "", fmt.Errorf("decode aria2.getVersion result: %w", err)
	}
	return version.Version, nil
}

func (client *rpcClient) tellMany(ctx context.Context, method string, params ...any) ([]aria2Status, error) {
	raw, err := client.call(ctx, method, params...)
	if err != nil {
		return nil, err
	}
	var statuses []aria2Status
	if err := json.Unmarshal(raw, &statuses); err != nil {
		return nil, fmt.Errorf("decode %s result: %w", method, err)
	}
	return statuses, nil
}

func (client *rpcClient) call(ctx context.Context, method string, params ...any) (json.RawMessage, error) {
	if client.secret != "" {
		params = append([]any{"token:" + client.secret}, params...)
	}
	payload := rpcRequest{
		JSONRPC: "2.0",
		ID:      strconv.FormatUint(client.nextID.Add(1), 10),
		Method:  method,
		Params:  params,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode %s request: %w", method, err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create %s request: %w", method, err)
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("perform %s request: %w", method, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("%s returned HTTP %d", method, response.StatusCode)
	}

	limited := io.LimitReader(response.Body, maxRPCResponseBytes+1)
	responseBody, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("read %s response: %w", method, err)
	}
	if len(responseBody) > maxRPCResponseBytes {
		return nil, fmt.Errorf("%s response exceeds %d bytes", method, maxRPCResponseBytes)
	}
	var decoded rpcResponse
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return nil, fmt.Errorf("decode %s response: %w", method, err)
	}
	if decoded.ID != payload.ID {
		return nil, fmt.Errorf("%s response id mismatch", method)
	}
	if decoded.Error != nil {
		return nil, decoded.Error
	}
	if decoded.Result == nil {
		return nil, fmt.Errorf("%s response omitted result", method)
	}
	return decoded.Result, nil
}
