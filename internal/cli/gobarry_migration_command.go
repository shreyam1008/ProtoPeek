package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"

	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

type goBarryMigrationCommandService interface {
	PreviewGoBarry(context.Context) (transfer.GoBarryMigrationPreview, error)
	ImportGoBarry(context.Context, transfer.GoBarryImportRequest) (transfer.GoBarryImportResult, error)
	RollbackGoBarry(context.Context, transfer.GoBarryRollbackRequest) (transfer.GoBarryRollbackResult, error)
}

type goBarryMigrationServiceFactory func() (goBarryMigrationCommandService, error)

func newConfiguredGoBarryMigrationService() (goBarryMigrationCommandService, error) {
	return loadConfiguredTransferService()
}

func runGoBarryMigrationCommand(
	arguments []string,
	stdout io.Writer,
	stderr io.Writer,
	factory goBarryMigrationServiceFactory,
) int {
	flags := flag.NewFlagSet("migrate-gobarry", flag.ContinueOnError)
	flags.SetOutput(stderr)
	apply := flags.Bool("apply", false, "copy the selected compatible state after showing the preview")
	rollbackID := flags.String("rollback", "", "restore a migration receipt when current ProtoPeek state still matches it")
	preferences := flags.Bool("preferences", true, "include compatible GoBarryGo preferences")
	session := flags.Bool("session", true, "include the resumable aria2 session")
	flags.Usage = func() {
		fmt.Fprintf(stderr, `Usage:
	%s migrate-gobarry [flags]

Previews the final GoBarryGo local profile and, only with --apply, copies the
selected compatible state into ProtoPeek. The source profile is never deleted,
renamed, uninstalled, or rewritten. The Downloader must be stopped.

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
	if flags.NArg() != 0 {
		fmt.Fprintln(stderr, "migrate-gobarry does not accept positional arguments")
		flags.Usage()
		return 2
	}
	if !*preferences && !*session {
		fmt.Fprintln(stderr, "Select at least one of --preferences or --session.")
		return 2
	}
	if *apply && strings.TrimSpace(*rollbackID) != "" {
		fmt.Fprintln(stderr, "--apply and --rollback are mutually exclusive.")
		return 2
	}

	service, err := factory()
	if err != nil {
		fmt.Fprintln(stderr, "Could not load ProtoPeek transfer configuration.")
		return 1
	}
	if receiptID := strings.TrimSpace(*rollbackID); receiptID != "" {
		result, err := service.RollbackGoBarry(context.Background(), transfer.GoBarryRollbackRequest{
			ReceiptID:                    receiptID,
			AcknowledgeCurrentStateCheck: true,
		})
		if err != nil {
			if errors.Is(err, transfer.ErrGoBarryRollbackConflict) {
				fmt.Fprintln(stderr, "Rollback refused: ProtoPeek transfer state changed after this receipt. Current files were preserved.")
			} else if errors.Is(err, transfer.ErrGoBarryImportActive) {
				fmt.Fprintln(stderr, "Stop the ProtoPeek Downloader before rolling back a migration.")
			} else {
				fmt.Fprintln(stderr, "Rollback did not finish cleanly. ProtoPeek state may already have been restored. Retry the same receipt so any retained recovery journal can finish safely.")
			}
			return 1
		}
		fmt.Fprintln(stdout, result.Message)
		return 0
	}
	preview, err := service.PreviewGoBarry(context.Background())
	if err != nil {
		if errors.Is(err, transfer.ErrGoBarryNotFound) {
			fmt.Fprintln(stderr, "No GoBarryGo preferences or resumable session were found in the known local profile.")
		} else if errors.Is(err, transfer.ErrGoBarryUnsafeState) {
			fmt.Fprintln(stderr, "GoBarryGo state failed the bounded migration safety checks; no target files changed.")
		} else {
			fmt.Fprintln(stderr, "GoBarryGo state could not be inspected safely; no target files changed.")
		}
		return 1
	}
	writeGoBarryPreview(stdout, preview)
	if !*apply {
		fmt.Fprintf(stdout, "\nPreview only. Run %s migrate-gobarry --apply to copy the selected state.\n", executableName())
		return 0
	}
	if (*preferences && !preview.PreferencesFound) || (*session && !preview.SessionFound) {
		fmt.Fprintln(stderr, "A selected GoBarryGo source file is not available; adjust the flags and preview again.")
		return 2
	}
	result, err := service.ImportGoBarry(context.Background(), transfer.GoBarryImportRequest{
		ImportPreferences:          *preferences,
		ImportSession:              *session,
		AcknowledgeSourcePreserved: true,
		ExpectedRevision:           preview.PreviewRevision,
	})
	if err != nil {
		if errors.Is(err, transfer.ErrGoBarryImportActive) {
			fmt.Fprintln(stderr, "Stop the ProtoPeek Downloader before importing GoBarryGo state.")
		} else if errors.Is(err, transfer.ErrGoBarryPreviewConflict) {
			fmt.Fprintln(stderr, "GoBarryGo or ProtoPeek transfer state changed after the preview. Import was refused; run the command again to review the current state.")
		} else {
			fmt.Fprintln(stderr, "GoBarryGo state could not be imported safely; source files were left untouched.")
		}
		return 1
	}
	if result.AlreadyImported {
		fmt.Fprintln(stdout, "\nThis exact GoBarryGo state was already imported. No files changed.")
		return 0
	}
	fmt.Fprintln(stdout, "\nImport complete. GoBarryGo source files were left untouched.")
	fmt.Fprintf(stdout, "Preferences copied: %t\n", result.PreferencesImported)
	fmt.Fprintf(stdout, "Session copied: %t (%d new entries)\n", result.SessionImported, result.SessionEntriesAdded)
	if result.ReceiptID != "" {
		fmt.Fprintf(stdout, "Rollback receipt: %s\n", result.ReceiptID)
	}
	return 0
}

func writeGoBarryPreview(output io.Writer, preview transfer.GoBarryMigrationPreview) {
	fmt.Fprintln(output, "GoBarryGo → ProtoPeek migration preview")
	fmt.Fprintf(output, "Preferences: %s\n", foundLabel(preview.PreferencesFound, fmt.Sprintf("%d compatible changes", len(preview.SettingChanges))))
	fmt.Fprintf(output, "Resumable session: %s\n", foundLabel(preview.SessionFound, fmt.Sprintf("%d entries, %d bytes", preview.SessionEntries, preview.SessionBytes)))
	if preview.AlreadyImported {
		fmt.Fprintln(output, "Status: this exact source state was already imported")
	} else if preview.EngineMustBeStopped {
		fmt.Fprintln(output, "Status: stop the Downloader before import")
	} else {
		fmt.Fprintln(output, "Status: ready for explicit import")
	}
	if len(preview.SettingChanges) > 0 {
		fmt.Fprintln(output, "\nCompatible preference changes:")
		for _, change := range preview.SettingChanges {
			fmt.Fprintf(output, "  %s: %s → %s", change.Key, compactMigrationValue(change.Before), compactMigrationValue(change.After))
			if change.Note != "" {
				fmt.Fprintf(output, " (%s)", change.Note)
			}
			fmt.Fprintln(output)
		}
	}
	if len(preview.PreservedButUnsupported) > 0 || len(preview.Warnings) > 0 {
		fmt.Fprintln(output, "\nPreserved differences:")
		for _, item := range append(append([]string{}, preview.PreservedButUnsupported...), preview.Warnings...) {
			fmt.Fprintf(output, "  - %s\n", item)
		}
	}
	fmt.Fprintln(output, "\nSource policy: copy only; the GoBarryGo profile remains unchanged.")
}

func foundLabel(found bool, detail string) string {
	if !found {
		return "not found"
	}
	return detail
}

func compactMigrationValue(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "not set"
	}
	if len(value) > 96 {
		return value[:96] + "…"
	}
	return value
}
