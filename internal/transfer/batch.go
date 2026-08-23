package transfer

import (
	"context"
	"errors"
	"fmt"
)

const MaxBatchJobs = 32

var ErrInvalidBatchRequest = errors.New("invalid transfer batch request")

type BatchFailureCode string

const (
	BatchFailureInvalidRequest   BatchFailureCode = "invalid_request"
	BatchFailureEngineStopped    BatchFailureCode = "engine_stopped"
	BatchFailureQueueFull        BatchFailureCode = "queue_full"
	BatchFailureInsufficientDisk BatchFailureCode = "insufficient_disk"
	BatchFailureCancelled        BatchFailureCode = "cancelled"
	BatchFailureEngineRejected   BatchFailureCode = "engine_rejected"
)

// BatchAddRequest contains independent queue jobs. Each job keeps AddRequest's
// mirror-capable Sources primitive, but no source from one job is combined with
// a source from another job.
type BatchAddRequest struct {
	Jobs []AddRequest `json:"jobs"`
}

// BatchAddItemResult is intentionally source-free. Signed URLs, request
// headers, and per-job credentials are never reflected by this contract.
type BatchAddItemResult struct {
	Index              int              `json:"index"`
	Queued             bool             `json:"queued"`
	ID                 string           `json:"id,omitempty"`
	ExpectedSHA256     string           `json:"expectedSha256,omitempty"`
	Verification       string           `json:"verificationStatus,omitempty"`
	FailureCode        BatchFailureCode `json:"failureCode,omitempty"`
	PersistenceWarning string           `json:"persistenceWarning,omitempty"`
}

type BatchAddResult struct {
	RequestedCount     int                  `json:"requestedCount"`
	QueuedCount        int                  `json:"queuedCount"`
	FailedCount        int                  `json:"failedCount"`
	Results            []BatchAddItemResult `json:"results"`
	PersistenceWarning string               `json:"persistenceWarning,omitempty"`
}

// AddBatch attempts every independent job in stable input order. Individual
// failures are data, not a whole-batch error, so callers can report partial
// success without inviting users to retry already-queued work.
func (service *Service) AddBatch(ctx context.Context, request BatchAddRequest) (BatchAddResult, error) {
	if len(request.Jobs) == 0 || len(request.Jobs) > MaxBatchJobs {
		return BatchAddResult{}, fmt.Errorf("%w: one to %d independent jobs are required", ErrInvalidBatchRequest, MaxBatchJobs)
	}

	result := BatchAddResult{
		RequestedCount: len(request.Jobs),
		Results:        make([]BatchAddItemResult, 0, len(request.Jobs)),
	}
	for index, job := range request.Jobs {
		if err := ctx.Err(); err != nil {
			for remaining := index; remaining < len(request.Jobs); remaining++ {
				result.Results = append(result.Results, BatchAddItemResult{
					Index:       remaining,
					FailureCode: BatchFailureCancelled,
				})
				result.FailedCount++
			}
			break
		}

		added, err := service.Add(ctx, job)
		if err != nil {
			result.Results = append(result.Results, BatchAddItemResult{
				Index:       index,
				FailureCode: classifyBatchFailure(err),
			})
			result.FailedCount++
			continue
		}

		item := BatchAddItemResult{
			Index:              index,
			Queued:             true,
			ID:                 added.ID,
			ExpectedSHA256:     added.ExpectedSHA256,
			Verification:       added.Verification,
			PersistenceWarning: added.PersistenceWarning,
		}
		result.Results = append(result.Results, item)
		result.QueuedCount++
		if added.PersistenceWarning != "" {
			result.PersistenceWarning = PersistenceWarningMessage
		}
	}
	return result, nil
}

func classifyBatchFailure(err error) BatchFailureCode {
	switch {
	case errors.Is(err, ErrInvalidAddRequest):
		return BatchFailureInvalidRequest
	case errors.Is(err, ErrEngineNotRunning), errors.Is(err, ErrAlreadyStarting):
		return BatchFailureEngineStopped
	case errors.Is(err, ErrQueueFull):
		return BatchFailureQueueFull
	case errors.Is(err, ErrInsufficientDisk):
		return BatchFailureInsufficientDisk
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return BatchFailureCancelled
	default:
		return BatchFailureEngineRejected
	}
}
