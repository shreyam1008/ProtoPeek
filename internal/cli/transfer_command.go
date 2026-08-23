package cli

import (
	"context"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"

	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

const (
	downloadCommandPollInterval = 250 * time.Millisecond
	downloadCommandAppearLimit  = 30 * time.Second
	downloadCommandShutdownTime = 5 * time.Second
	sha256DigestBytes           = 32
)

type downloadCommandService interface {
	Start(context.Context) (transfer.Health, error)
	Add(context.Context, transfer.AddRequest) (transfer.AddResult, error)
	Snapshot(context.Context) (transfer.Snapshot, error)
	Shutdown(context.Context) error
}

type downloadServiceFactory func() (downloadCommandService, error)

func dispatchSubcommand(arguments []string) (int, bool) {
	if len(arguments) == 0 || arguments[0] != "download" {
		return 0, false
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runDownloadCommand(
		ctx,
		arguments[1:],
		os.Stdout,
		os.Stderr,
		newConfiguredDownloadService,
		term.IsTerminal(int(os.Stderr.Fd())),
	), true
}

func newConfiguredDownloadService() (downloadCommandService, error) {
	return loadConfiguredTransferService()
}

func loadConfiguredTransferService() (*transfer.Service, error) {
	paths, err := transfer.DefaultPaths()
	if err != nil {
		return nil, err
	}
	config, _, err := transfer.NewConfigStore(paths.ConfigFile).Load()
	if err != nil {
		return nil, err
	}
	return transfer.NewService(config, paths)
}

func runDownloadCommand(
	ctx context.Context,
	arguments []string,
	stdout io.Writer,
	stderr io.Writer,
	factory downloadServiceFactory,
	interactive bool,
) (code int) {
	flags := flag.NewFlagSet("download", flag.ContinueOnError)
	flags.SetOutput(stderr)
	outputName := flags.String("output", "", "safe output file name (no directory components)")
	expectedSHA256 := flags.String("sha256", "", "expected SHA-256 digest (64 hexadecimal characters)")
	flags.Usage = func() {
		fmt.Fprintf(stderr, `Usage:
	%s download [flags] URL

Downloads one HTTP(S) URL through ProtoPeek's local aria2c transfer engine.
The command uses the same host configuration and session as the browser UI,
but does not attach to an already-running ProtoPeek process.

Flags:
`, executableName())
		flags.PrintDefaults()
	}
	if err := flags.Parse(arguments); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if flags.NArg() != 1 {
		fmt.Fprintln(stderr, "download requires exactly one URL")
		flags.Usage()
		return 2
	}

	request, err := validateDownloadCommandRequest(flags.Arg(0), *outputName, *expectedSHA256)
	if err != nil {
		fmt.Fprintf(stderr, "Invalid download request: %v\n", err)
		return 2
	}
	service, err := factory()
	if err != nil {
		fmt.Fprintf(stderr, "Could not load ProtoPeek transfer configuration: %v\n", err)
		return 1
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), downloadCommandShutdownTime)
		defer cancel()
		if err := service.Shutdown(shutdownCtx); err != nil {
			fmt.Fprintln(stderr, "Downloader shutdown was not clean; its local resumable state may need to be checked before another run.")
			if code == 0 {
				code = 1
			}
		}
	}()

	health, err := service.Start(ctx)
	if err != nil {
		if errors.Is(err, transfer.ErrLockHeld) {
			fmt.Fprintln(stderr, "Downloader is already owned by another ProtoPeek process. This command does not connect to an already-running browser session; stop that process and retry.")
		} else if errors.Is(err, context.Canceled) {
			fmt.Fprintln(stderr, "Download interrupted before aria2c started; no queue item was added.")
			return 130
		} else if errors.Is(err, transfer.ErrAria2NotFound) {
			fmt.Fprintln(stderr, "aria2c was not found. Install it or configure its executable path in ProtoPeek's transfer settings.")
		} else {
			fmt.Fprintln(stderr, "Could not start the local downloader. Check the configured aria2c binary and local transfer state.")
		}
		return 1
	}
	if !health.Ready {
		fmt.Fprintf(stderr, "Local downloader is not ready: %s\n", health.Message)
		return 1
	}

	result, err := service.Add(ctx, request)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			fmt.Fprintln(stderr, "Download interrupted before the URL was queued.")
			return 130
		}
		switch {
		case errors.Is(err, transfer.ErrQueueFull):
			fmt.Fprintln(stderr, "Could not add download: the configured local transfer queue is full.")
		case errors.Is(err, transfer.ErrInsufficientDisk):
			fmt.Fprintln(stderr, "Could not add download: the download directory is below its configured free-space reserve.")
		case errors.Is(err, transfer.ErrInvalidAddRequest):
			fmt.Fprintln(stderr, "Could not add download: the transfer request was invalid.")
		default:
			fmt.Fprintln(stderr, "Could not add download: local aria2c rejected the transfer operation.")
		}
		return 1
	}
	fmt.Fprintf(stderr, "Queued %s with aria2c %s.\n", result.ID, health.EngineVersion)
	if result.PersistenceWarning != "" {
		fmt.Fprintf(stderr, "Warning: %s\n", result.PersistenceWarning)
	}

	return waitForDownload(ctx, service, result.ID, stdout, stderr, interactive)
}

func waitForDownload(
	ctx context.Context,
	service downloadCommandService,
	id string,
	stdout io.Writer,
	stderr io.Writer,
	interactive bool,
) int {
	ticker := time.NewTicker(downloadCommandPollInterval)
	defer ticker.Stop()
	missingSince := time.Now()
	lastLine := ""
	lastBucket := -1
	lastStatus := transfer.JobStatus("")

	for {
		snapshot, err := service.Snapshot(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				finishInteractiveProgress(stderr, interactive, lastLine)
				fmt.Fprintln(stderr, "Download interrupted. Partial data and the aria2 session were preserved for resumption.")
				return 130
			}
			finishInteractiveProgress(stderr, interactive, lastLine)
			fmt.Fprintln(stderr, "Could not read transfer progress from local aria2c.")
			return 1
		}
		job, found := findDownloadJob(snapshot.Jobs, id)
		if found {
			line := formatDownloadProgress(job)
			bucket := int(job.ProgressPercent) / 10
			if interactive {
				fmt.Fprintf(stderr, "\r%-96s", line)
				lastLine = line
			} else if job.Status != lastStatus || bucket != lastBucket {
				fmt.Fprintln(stderr, line)
				lastStatus = job.Status
				lastBucket = bucket
			}

			switch job.Status {
			case transfer.JobCompleted:
				finishInteractiveProgress(stderr, interactive, lastLine)
				if job.ExpectedSHA256 != "" && job.Verification != "verified" {
					fmt.Fprintf(stderr, "Checksum evidence is incomplete: %s\n", fallback(job.VerifyMessage, string(job.Verification)))
					return 1
				}
				output := fallback(job.OutputPath, filepath.Join(job.Directory, job.Name))
				fmt.Fprintln(stdout, output)
				return 0
			case transfer.JobFailed:
				finishInteractiveProgress(stderr, interactive, lastLine)
				fmt.Fprintf(stderr, "Download failed: %s\n", fallback(job.ErrorMessage, "aria2c error "+job.ErrorCode))
				return 1
			case transfer.JobCancelled:
				finishInteractiveProgress(stderr, interactive, lastLine)
				fmt.Fprintln(stderr, "Download was cancelled.")
				return 1
			}
		} else if time.Since(missingSince) > downloadCommandAppearLimit {
			finishInteractiveProgress(stderr, interactive, lastLine)
			fmt.Fprintln(stderr, "The queued transfer did not appear in aria2c before the observation deadline.")
			return 1
		}

		select {
		case <-ctx.Done():
			finishInteractiveProgress(stderr, interactive, lastLine)
			fmt.Fprintln(stderr, "Download interrupted. Partial data and the aria2 session were preserved for resumption.")
			return 130
		case <-ticker.C:
		}
	}
}

func validateDownloadCommandRequest(rawURL, outputName, expectedSHA256 string) (transfer.AddRequest, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" || len(rawURL) > 8<<10 || containsCLIControl(rawURL) {
		return transfer.AddRequest{}, errors.New("URL is empty, too long, or contains a control character")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || !parsed.IsAbs() || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return transfer.AddRequest{}, errors.New("URL must be absolute HTTP or HTTPS without user information")
	}
	parsed.Fragment = ""

	outputName = strings.TrimSpace(outputName)
	if outputName != "" && (len(outputName) > 255 || outputName == "." || outputName == ".." || filepath.Base(outputName) != outputName || strings.ContainsAny(outputName, "/\\") || containsCLIControl(outputName)) {
		return transfer.AddRequest{}, errors.New("output must be one safe file name without directory components")
	}

	expectedSHA256 = strings.ToLower(strings.TrimSpace(expectedSHA256))
	if expectedSHA256 != "" {
		digest, err := hex.DecodeString(expectedSHA256)
		if err != nil || len(digest) != sha256DigestBytes {
			return transfer.AddRequest{}, errors.New("sha256 must contain exactly 64 hexadecimal characters")
		}
	}
	return transfer.AddRequest{
		Sources:    []string{parsed.String()},
		OutputName: outputName,
		SHA256:     expectedSHA256,
	}, nil
}

func findDownloadJob(jobs []transfer.Job, id string) (transfer.Job, bool) {
	for _, job := range jobs {
		if job.ID == id {
			return job, true
		}
	}
	return transfer.Job{}, false
}

func formatDownloadProgress(job transfer.Job) string {
	line := fmt.Sprintf("%-11s %6.1f%%  %s/s", job.Status, job.ProgressPercent, humanBytes(job.BytesPerSecond))
	if job.ETASeconds > 0 {
		line += "  ETA " + formatETA(job.ETASeconds)
	}
	return line
}

func finishInteractiveProgress(writer io.Writer, interactive bool, lastLine string) {
	if interactive && lastLine != "" {
		fmt.Fprintln(writer)
	}
}

func humanBytes(value int64) string {
	if value < 1024 {
		return fmt.Sprintf("%d B", value)
	}
	units := []string{"KiB", "MiB", "GiB", "TiB"}
	size := float64(value)
	for _, unit := range units {
		size /= 1024
		if size < 1024 || unit == units[len(units)-1] {
			return fmt.Sprintf("%.1f %s", size, unit)
		}
	}
	return fmt.Sprintf("%d B", value)
}

func formatETA(seconds int64) string {
	duration := time.Duration(seconds) * time.Second
	if duration < time.Minute {
		return duration.String()
	}
	return duration.Round(time.Second).String()
}

func fallback(value, fallbackValue string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallbackValue
}

func executableName() string {
	if len(os.Args) == 0 || strings.TrimSpace(os.Args[0]) == "" {
		return "protopeek"
	}
	return filepath.Base(os.Args[0])
}

func containsCLIControl(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}
