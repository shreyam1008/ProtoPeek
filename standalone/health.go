package standalone

import (
	"bytes"
	"container/heap"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/fullstorydev/grpcurl"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const (
	maxHealthRequestBodyBytes        int64 = 64 << 10
	maxHealthServiceBytes                  = 1024
	maxHealthMetadataEntries               = 64
	maxHealthMetadataAggregateBytes        = 32 << 10
	maxHealthMetadataNameBytes             = 256
	maxHealthMetadataValueBytes            = 8 << 10
	maxHealthResponseMetadataBytes         = 32 << 10
	maxHealthResponseMetadataEntries       = 512
	maxHealthStatusMessageBytes            = 2 << 10
	defaultHealthCheckTimeout              = 5 * time.Second
	minHealthCheckTimeout                  = 100 * time.Millisecond
	maxHealthCheckTimeout                  = 30 * time.Second
	maxConcurrentHealthWatches             = 4
	defaultHealthWatchDuration             = 60 * time.Second
	minHealthWatchDuration                 = time.Second
	maxHealthWatchDuration                 = 10 * time.Minute
	maxHealthWatchObservations             = 512
	maxHealthNDJSONLineBytes               = 64 << 10
)

var errHealthWatchDurationLimit = errors.New("ProtoPeek Health Watch duration limit reached")

type healthMetadata struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type healthCheckRequest struct {
	Service        string           `json:"service"`
	TimeoutSeconds float64          `json:"timeout_seconds"`
	Metadata       []healthMetadata `json:"metadata"`
}

type healthWatchRequest struct {
	Service         string           `json:"service"`
	DurationSeconds float64          `json:"duration_seconds"`
	Metadata        []healthMetadata `json:"metadata"`
}

type healthServingStatus struct {
	Code int32  `json:"code"`
	Name string `json:"name"`
}

type healthGRPCStatus struct {
	Code             int32  `json:"code"`
	Name             string `json:"name"`
	Message          string `json:"message"`
	MessageTruncated bool   `json:"messageTruncated"`
}

type healthCheckResponse struct {
	Service           string               `json:"service"`
	StartedAt         string               `json:"startedAt"`
	HandlerInvokeMs   float64              `json:"handlerInvokeMs"`
	ServingStatus     *healthServingStatus `json:"servingStatus"`
	GRPCStatus        healthGRPCStatus     `json:"grpcStatus"`
	Headers           []healthMetadata     `json:"headers"`
	Trailers          []healthMetadata     `json:"trailers"`
	HeadersTruncated  bool                 `json:"headersTruncated"`
	TrailersTruncated bool                 `json:"trailersTruncated"`
}

type healthWatchEventBase struct {
	Type             string  `json:"type"`
	Service          string  `json:"service"`
	StartedAt        string  `json:"startedAt"`
	ObservedOffsetMs float64 `json:"observedOffsetMs"`
}

type healthWatchStartedEvent struct {
	healthWatchEventBase
	DurationSeconds float64 `json:"durationSeconds"`
	MetadataCount   int     `json:"metadataCount"`
}

type healthWatchHeadersEvent struct {
	healthWatchEventBase
	Headers          []healthMetadata `json:"headers"`
	HeadersTruncated bool             `json:"headersTruncated"`
}

type healthWatchStatusEvent struct {
	healthWatchEventBase
	Sequence      int                  `json:"sequence"`
	ServingStatus *healthServingStatus `json:"servingStatus"`
}

type healthWatchEndedEvent struct {
	healthWatchEventBase
	Reason            string           `json:"reason"`
	ObservationCount  int              `json:"observationCount"`
	GRPCStatus        healthGRPCStatus `json:"grpcStatus"`
	Trailers          []healthMetadata `json:"trailers"`
	TrailersTruncated bool             `json:"trailersTruncated"`
}

type healthClient interface {
	Check(context.Context, *healthpb.HealthCheckRequest, ...grpc.CallOption) (*healthpb.HealthCheckResponse, error)
	Watch(context.Context, *healthpb.HealthCheckRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[healthpb.HealthCheckResponse], error)
}

type healthConnectionResolver func(*http.Request) (grpc.ClientConnInterface, *healthRequestError)

type healthRequestError struct {
	status  int
	message string
}

type healthHandlerSet struct {
	extraMetadata   []string
	preserveHeaders []string
	watchSlots      chan struct{}
	clientFactory   func(grpc.ClientConnInterface) healthClient
}

func newHealthHandlerSet(extraMetadata, preserveHeaders []string) *healthHandlerSet {
	return &healthHandlerSet{
		extraMetadata:   append([]string(nil), extraMetadata...),
		preserveHeaders: append([]string(nil), preserveHeaders...),
		watchSlots:      make(chan struct{}, maxConcurrentHealthWatches),
		clientFactory: func(connection grpc.ClientConnInterface) healthClient {
			return healthpb.NewHealthClient(connection)
		},
	}
}

func directHealthConnection(connection grpc.ClientConnInterface) healthConnectionResolver {
	return func(*http.Request) (grpc.ClientConnInterface, *healthRequestError) {
		if connection == nil {
			return nil, &healthRequestError{status: http.StatusConflict, message: "Direct gRPC target is unavailable"}
		}
		return connection, nil
	}
}

func workspaceHealthConnection(manager *WorkspaceManager) healthConnectionResolver {
	return func(request *http.Request) (grpc.ClientConnInterface, *healthRequestError) {
		sessionID := strings.TrimSpace(request.URL.Query().Get("session_id"))
		if sessionID == "" {
			return nil, &healthRequestError{status: http.StatusNotFound, message: "Unknown workspace session"}
		}
		session, ok := manager.Session(sessionID)
		if !ok || session.cc == nil {
			return nil, &healthRequestError{status: http.StatusNotFound, message: "Unknown workspace session"}
		}
		return session.cc, nil
	}
}

func (handlers *healthHandlerSet) checkHandler(resolve healthConnectionResolver) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		setHealthResponseHeaders(writer)
		if !validateHealthHTTPEnvelope(writer, request) {
			return
		}
		connection, requestError := resolve(request)
		if requestError != nil {
			http.Error(writer, requestError.message, requestError.status)
			return
		}

		var input healthCheckRequest
		if !decodeHealthJSON(writer, request, &input) {
			return
		}
		timeout, err := validateHealthCheckRequest(input)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusBadRequest)
			return
		}
		requestMetadata, err := handlers.outgoingMetadata(request, input.Metadata)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusBadRequest)
			return
		}

		ctx, cancel := context.WithTimeout(request.Context(), timeout)
		defer cancel()
		ctx = metadata.NewOutgoingContext(ctx, requestMetadata)
		var headers metadata.MD
		var trailers metadata.MD
		started := time.Now()
		response, invokeErr := handlers.clientFactory(connection).Check(
			ctx,
			&healthpb.HealthCheckRequest{Service: input.Service},
			grpc.Header(&headers),
			grpc.Trailer(&trailers),
		)
		invokeElapsed := elapsedHealthMilliseconds(started, time.Now())

		headerValues, headersTruncated, headerBytes := boundedHealthMetadata(headers, maxHealthResponseMetadataBytes)
		trailerValues, trailersTruncated, _ := boundedHealthMetadata(trailers, maxHealthResponseMetadataBytes-headerBytes)
		result := healthCheckResponse{
			Service:           input.Service,
			StartedAt:         started.UTC().Format(time.RFC3339Nano),
			HandlerInvokeMs:   invokeElapsed,
			GRPCStatus:        healthStatusFromError(invokeErr),
			Headers:           headerValues,
			Trailers:          trailerValues,
			HeadersTruncated:  headersTruncated,
			TrailersTruncated: trailersTruncated,
		}
		if response != nil && invokeErr == nil {
			result.ServingStatus = servingStatus(response.GetStatus())
		}

		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(result)
	}
}

func (handlers *healthHandlerSet) watchHandler(resolve healthConnectionResolver) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		setHealthResponseHeaders(writer)
		if !validateHealthHTTPEnvelope(writer, request) {
			return
		}
		select {
		case handlers.watchSlots <- struct{}{}:
			defer func() { <-handlers.watchSlots }()
		default:
			writer.Header().Set("Retry-After", "1")
			http.Error(writer, "Health Watch capacity is busy; retry shortly", http.StatusServiceUnavailable)
			return
		}
		connection, requestError := resolve(request)
		if requestError != nil {
			http.Error(writer, requestError.message, requestError.status)
			return
		}

		var input healthWatchRequest
		if !decodeHealthJSON(writer, request, &input) {
			return
		}
		duration, durationSeconds, err := validateHealthWatchRequest(input)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusBadRequest)
			return
		}
		requestMetadata, err := handlers.outgoingMetadata(request, input.Metadata)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusBadRequest)
			return
		}
		_, ok := writer.(http.Flusher)
		if !ok {
			http.Error(writer, "Streaming responses are unsupported", http.StatusInternalServerError)
			return
		}
		writer.Header().Set("Content-Type", "application/x-ndjson")
		events := healthNDJSONWriter{
			writer:     writer,
			controller: http.NewResponseController(writer),
		}

		started := time.Now()
		startedAt := started.UTC().Format(time.RFC3339Nano)
		callContext, cancelCall := context.WithCancelCause(request.Context())
		durationTimerDone := make(chan struct{})
		durationTimer := time.AfterFunc(duration, func() {
			cancelCall(errHealthWatchDurationLimit)
			close(durationTimerDone)
		})
		durationTimerStopped := false
		stopDurationTimer := func() {
			if durationTimerStopped {
				return
			}
			durationTimerStopped = true
			if !durationTimer.Stop() {
				<-durationTimerDone
			}
		}
		defer func() {
			stopDurationTimer()
			cancelCall(nil)
		}()
		base := func(eventType string, observedAt time.Time) healthWatchEventBase {
			return healthWatchEventBase{
				Type:             eventType,
				Service:          input.Service,
				StartedAt:        startedAt,
				ObservedOffsetMs: elapsedHealthMilliseconds(started, observedAt),
			}
		}
		if err := events.write(healthWatchStartedEvent{
			healthWatchEventBase: healthWatchEventBase{
				Type:             "started",
				Service:          input.Service,
				StartedAt:        startedAt,
				ObservedOffsetMs: 0,
			},
			DurationSeconds: durationSeconds,
			MetadataCount:   len(input.Metadata),
		}); err != nil {
			return
		}

		outgoingContext := metadata.NewOutgoingContext(callContext, requestMetadata)
		stream, watchErr := handlers.clientFactory(connection).Watch(
			outgoingContext,
			&healthpb.HealthCheckRequest{Service: input.Service},
		)
		if watchErr != nil {
			stopDurationTimer()
		}
		watchObservedAt := time.Now()
		if watchErr != nil {
			reason, evidenceErr := healthWatchTerminalEvidence(request.Context(), callContext, watchErr, false)
			_ = events.write(healthWatchEndedEvent{
				healthWatchEventBase: base("ended", watchObservedAt),
				Reason:               reason,
				GRPCStatus:           healthStatusFromError(evidenceErr),
				Trailers:             make([]healthMetadata, 0),
				TrailersTruncated:    true,
			})
			return
		}

		headers, headerErr := stream.Header()
		if headerErr != nil {
			stopDurationTimer()
		}
		headerObservedAt := time.Now()
		if headerErr != nil {
			trailers, trailersTruncated, _ := boundedHealthMetadata(stream.Trailer(), maxHealthResponseMetadataBytes)
			reason, evidenceErr := healthWatchTerminalEvidence(request.Context(), callContext, headerErr, false)
			_ = events.write(healthWatchEndedEvent{
				healthWatchEventBase: base("ended", headerObservedAt),
				Reason:               reason,
				GRPCStatus:           healthStatusFromError(evidenceErr),
				Trailers:             trailers,
				TrailersTruncated:    trailersTruncated,
			})
			return
		}
		headerValues, headersTruncated, headerBytes := boundedHealthMetadata(headers, maxHealthResponseMetadataBytes)
		if err := events.write(healthWatchHeadersEvent{
			healthWatchEventBase: base("headers-observed", headerObservedAt),
			Headers:              headerValues,
			HeadersTruncated:     headersTruncated,
		}); err != nil {
			return
		}

		observations := 0
		var terminalErr error
		var terminalObservedAt time.Time
		observationLimit := false
		for {
			response, recvErr := stream.Recv()
			if recvErr != nil {
				stopDurationTimer()
			}
			recvObservedAt := time.Now()
			if recvErr != nil {
				terminalObservedAt = recvObservedAt
				if errors.Is(recvErr, io.EOF) {
					terminalErr = nil
				} else {
					terminalErr = recvErr
				}
				break
			}
			observations++
			reachedObservationLimit := observations >= maxHealthWatchObservations
			if reachedObservationLimit {
				stopDurationTimer()
			}
			if err := events.write(healthWatchStatusEvent{
				healthWatchEventBase: base("status-observed", recvObservedAt),
				Sequence:             observations,
				ServingStatus:        servingStatus(response.GetStatus()),
			}); err != nil {
				return
			}
			if reachedObservationLimit {
				observationLimit = true
				cancelCall(nil)
				terminalErr = status.Error(codes.Canceled, "health watch observation limit reached")
				terminalObservedAt = recvObservedAt
				break
			}
		}

		trailers := make([]healthMetadata, 0)
		trailersTruncated := observationLimit
		if !observationLimit {
			trailers, trailersTruncated, _ = boundedHealthMetadata(stream.Trailer(), maxHealthResponseMetadataBytes-headerBytes)
		}
		reason, evidenceErr := healthWatchTerminalEvidence(request.Context(), callContext, terminalErr, observationLimit)
		_ = events.write(healthWatchEndedEvent{
			healthWatchEventBase: base("ended", terminalObservedAt),
			Reason:               reason,
			ObservationCount:     observations,
			GRPCStatus:           healthStatusFromError(evidenceErr),
			Trailers:             trailers,
			TrailersTruncated:    trailersTruncated,
		})
	}
}

type healthNDJSONWriter struct {
	writer     http.ResponseWriter
	controller *http.ResponseController
}

func (writer healthNDJSONWriter) write(event any) error {
	line, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if len(line)+1 > maxHealthNDJSONLineBytes {
		return fmt.Errorf("health Watch event exceeds the line limit")
	}
	line = append(line, '\n')
	written, err := writer.writer.Write(line)
	if err != nil {
		return err
	}
	if written != len(line) {
		return io.ErrShortWrite
	}
	return writer.controller.Flush()
}

func setHealthResponseHeaders(writer http.ResponseWriter) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
}

func validateHealthHTTPEnvelope(writer http.ResponseWriter, request *http.Request) bool {
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", http.MethodPost)
		http.Error(writer, "Method Not Allowed", http.StatusMethodNotAllowed)
		return false
	}
	if !validCSRF(request) {
		http.Error(writer, "incorrect CSRF token", http.StatusUnauthorized)
		return false
	}
	contentType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || !strings.EqualFold(contentType, "application/json") {
		http.Error(writer, "Request must use application/json", http.StatusUnsupportedMediaType)
		return false
	}
	return true
}

func decodeHealthJSON(writer http.ResponseWriter, request *http.Request, destination any) bool {
	request.Body = http.MaxBytesReader(writer, request.Body, maxHealthRequestBodyBytes)
	if request.ContentLength > maxHealthRequestBodyBytes {
		http.Error(writer, "Health request body is too large", http.StatusRequestEntityTooLarge)
		return false
	}
	contents, err := io.ReadAll(request.Body)
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			http.Error(writer, "Health request body is too large", http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(writer, "Invalid health request body", http.StatusBadRequest)
		return false
	}
	if !utf8.Valid(contents) {
		http.Error(writer, "Health request body must be valid UTF-8", http.StatusBadRequest)
		return false
	}
	trimmed := bytes.TrimSpace(contents)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		http.Error(writer, "Health request body must contain one JSON object", http.StatusBadRequest)
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		http.Error(writer, "Invalid health request JSON", http.StatusBadRequest)
		return false
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		http.Error(writer, "Health request body must contain one JSON object", http.StatusBadRequest)
		return false
	}
	return true
}

func validateHealthCheckRequest(input healthCheckRequest) (time.Duration, error) {
	if err := validateHealthService(input.Service); err != nil {
		return 0, err
	}
	if err := validateHealthMetadata(input.Metadata); err != nil {
		return 0, err
	}
	if input.TimeoutSeconds == 0 {
		return defaultHealthCheckTimeout, nil
	}
	if math.IsNaN(input.TimeoutSeconds) || math.IsInf(input.TimeoutSeconds, 0) {
		return 0, fmt.Errorf("timeout_seconds must be finite")
	}
	timeout := time.Duration(input.TimeoutSeconds * float64(time.Second))
	if timeout < minHealthCheckTimeout || timeout > maxHealthCheckTimeout {
		return 0, fmt.Errorf("timeout_seconds must be between 0.1 and 30")
	}
	return timeout, nil
}

func validateHealthWatchRequest(input healthWatchRequest) (time.Duration, float64, error) {
	if err := validateHealthService(input.Service); err != nil {
		return 0, 0, err
	}
	if err := validateHealthMetadata(input.Metadata); err != nil {
		return 0, 0, err
	}
	if input.DurationSeconds == 0 {
		return defaultHealthWatchDuration, defaultHealthWatchDuration.Seconds(), nil
	}
	if math.IsNaN(input.DurationSeconds) || math.IsInf(input.DurationSeconds, 0) ||
		input.DurationSeconds < minHealthWatchDuration.Seconds() ||
		input.DurationSeconds > maxHealthWatchDuration.Seconds() {
		return 0, 0, fmt.Errorf("duration_seconds must be between 1 and 600")
	}
	return time.Duration(input.DurationSeconds * float64(time.Second)), input.DurationSeconds, nil
}

func healthWatchReason(requestContext, callContext context.Context, terminalErr error, observationLimit bool) string {
	if observationLimit {
		return "observation-limit"
	}
	terminalCode := status.Code(terminalErr)
	if (requestContext.Err() != nil || errors.Is(callContext.Err(), context.Canceled)) && terminalCode == codes.Canceled {
		return "canceled"
	}
	if terminalErr == nil || errors.Is(terminalErr, io.EOF) {
		return "completed"
	}
	if terminalCode == codes.Unimplemented {
		return "unsupported"
	}
	return "rpc-error"
}

func healthWatchTerminalEvidence(requestContext, callContext context.Context, terminalErr error, observationLimit bool) (string, error) {
	if !observationLimit && errors.Is(context.Cause(callContext), errHealthWatchDurationLimit) &&
		(status.Code(terminalErr) == codes.Canceled || errors.Is(terminalErr, context.Canceled)) {
		return "duration-limit", status.Error(codes.DeadlineExceeded, errHealthWatchDurationLimit.Error())
	}
	return healthWatchReason(requestContext, callContext, terminalErr, observationLimit), terminalErr
}

func validateHealthService(service string) error {
	if !utf8.ValidString(service) {
		return fmt.Errorf("service must be valid UTF-8")
	}
	if len(service) > maxHealthServiceBytes {
		return fmt.Errorf("service exceeds the %d byte limit", maxHealthServiceBytes)
	}
	return nil
}

func validateHealthMetadata(values []healthMetadata) error {
	if len(values) > maxHealthMetadataEntries {
		return fmt.Errorf("metadata exceeds the %d entry limit", maxHealthMetadataEntries)
	}
	total := 0
	for _, value := range values {
		if value.Name == "" || !validHealthMetadataName(value.Name) {
			return fmt.Errorf("metadata name %q is invalid", value.Name)
		}
		if len(value.Name) > maxHealthMetadataNameBytes {
			return fmt.Errorf("metadata name exceeds the %d byte limit", maxHealthMetadataNameBytes)
		}
		if !utf8.ValidString(value.Value) {
			return fmt.Errorf("metadata value must be valid UTF-8")
		}
		if len(value.Value) > maxHealthMetadataValueBytes {
			return fmt.Errorf("metadata value exceeds the %d byte limit", maxHealthMetadataValueBytes)
		}
		if len(value.Name)+len(value.Value) > maxHealthMetadataAggregateBytes-total {
			return fmt.Errorf("metadata exceeds the %d byte aggregate limit", maxHealthMetadataAggregateBytes)
		}
		total += len(value.Name) + len(value.Value)
	}
	return nil
}

func validHealthMetadataName(name string) bool {
	for _, character := range name {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '-' || character == '_' || character == '.' {
			continue
		}
		return false
	}
	return true
}

func (handlers *healthHandlerSet) outgoingMetadata(request *http.Request, values []healthMetadata) (metadata.MD, error) {
	if err := validateHealthMetadata(values); err != nil {
		return nil, err
	}
	bodyHeaders := make([]string, 0, len(values))
	for _, value := range values {
		bodyHeaders = append(bodyHeaders, value.Name+": "+value.Value)
	}
	combined := grpcurl.MetadataFromHeaders(bodyHeaders)
	for name, values := range grpcurl.MetadataFromHeaders(handlers.extraMetadata) {
		combined[name] = append([]string(nil), values...)
	}
	for _, name := range handlers.preserveHeaders {
		values := request.Header.Values(name)
		canonicalName := strings.ToLower(name)
		if len(values) == 0 {
			delete(combined, canonicalName)
			continue
		}
		preserved := make([]string, 0, len(values))
		for _, value := range values {
			preserved = append(preserved, name+": "+value)
		}
		combined[canonicalName] = grpcurl.MetadataFromHeaders(preserved)[canonicalName]
	}
	return combined, nil
}

func servingStatus(value healthpb.HealthCheckResponse_ServingStatus) *healthServingStatus {
	return &healthServingStatus{Code: int32(value), Name: value.String()}
}

func healthStatusFromError(err error) healthGRPCStatus {
	if err == nil {
		return healthGRPCStatus{Code: int32(codes.OK), Name: codes.OK.String()}
	}
	grpcStatus := status.Convert(err)
	message, truncated := truncateHealthString(grpcStatus.Message(), maxHealthStatusMessageBytes)
	return healthGRPCStatus{
		Code:             int32(grpcStatus.Code()),
		Name:             grpcStatus.Code().String(),
		Message:          message,
		MessageTruncated: truncated,
	}
}

type healthMetadataKeyHeap []string

func (keys healthMetadataKeyHeap) Len() int                  { return len(keys) }
func (keys healthMetadataKeyHeap) Less(left, right int) bool { return keys[left] > keys[right] }
func (keys healthMetadataKeyHeap) Swap(left, right int) {
	keys[left], keys[right] = keys[right], keys[left]
}
func (keys *healthMetadataKeyHeap) Push(value any) { *keys = append(*keys, value.(string)) }
func (keys *healthMetadataKeyHeap) Pop() any {
	old := *keys
	last := old[len(old)-1]
	*keys = old[:len(old)-1]
	return last
}

func boundedHealthMetadata(values metadata.MD, limit int) ([]healthMetadata, bool, int) {
	if limit < 0 {
		limit = 0
	}
	keys := make(healthMetadataKeyHeap, 0, min(len(values), maxHealthResponseMetadataEntries))
	truncated := false
	for key := range values {
		if len(keys) < maxHealthResponseMetadataEntries {
			heap.Push(&keys, key)
			continue
		}
		truncated = true
		if key < keys[0] {
			keys[0] = key
			heap.Fix(&keys, 0)
		}
	}
	sort.Strings(keys)
	result := make([]healthMetadata, 0, maxHealthResponseMetadataEntries)
	used := 0
	inspected := 0
	for _, key := range keys {
		for _, value := range values[key] {
			if inspected >= maxHealthResponseMetadataEntries {
				truncated = true
				break
			}
			inspected++
			remaining := limit - used
			if len(key) > remaining || len(value) > remaining-len(key) {
				truncated = true
				continue
			}
			if strings.HasSuffix(key, "-bin") {
				encodedLength := base64.StdEncoding.EncodedLen(len(value))
				if encodedLength > remaining-len(key) {
					truncated = true
					continue
				}
				value = base64.StdEncoding.EncodeToString([]byte(value))
			}
			entry := healthMetadata{Name: key, Value: value}
			encoded, err := json.Marshal(entry)
			if err != nil || len(encoded)+1 > limit-used {
				truncated = true
				continue
			}
			result = append(result, entry)
			used += len(encoded) + 1
		}
	}
	return result, truncated, used
}

func truncateHealthString(value string, limit int) (string, bool) {
	if len(value) <= limit {
		return value, false
	}
	value = value[:limit]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value, true
}

func elapsedHealthMilliseconds(started, observed time.Time) float64 {
	elapsed := observed.Sub(started)
	if elapsed < 0 {
		return 0
	}
	return float64(elapsed.Microseconds()) / 1000
}
