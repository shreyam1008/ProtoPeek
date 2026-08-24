package cli

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/shreyam1008/ProtoPeek/internal/transfer"
)

type fakeGoBarryCommandService struct {
	preview        transfer.GoBarryMigrationPreview
	previewErr     error
	result         transfer.GoBarryImportResult
	importErr      error
	previewCalls   int
	importCalls    int
	lastRequest    transfer.GoBarryImportRequest
	rollbackResult transfer.GoBarryRollbackResult
	rollbackErr    error
	rollbackCalls  int
	lastRollback   transfer.GoBarryRollbackRequest
}

func (service *fakeGoBarryCommandService) PreviewGoBarry(context.Context) (transfer.GoBarryMigrationPreview, error) {
	service.previewCalls++
	return service.preview, service.previewErr
}

func (service *fakeGoBarryCommandService) ImportGoBarry(_ context.Context, request transfer.GoBarryImportRequest) (transfer.GoBarryImportResult, error) {
	service.importCalls++
	service.lastRequest = request
	return service.result, service.importErr
}

func (service *fakeGoBarryCommandService) RollbackGoBarry(_ context.Context, request transfer.GoBarryRollbackRequest) (transfer.GoBarryRollbackResult, error) {
	service.rollbackCalls++
	service.lastRollback = request
	return service.rollbackResult, service.rollbackErr
}

func TestGoBarryMigrationCommandDefaultsToReadOnlyPreview(t *testing.T) {
	service := &fakeGoBarryCommandService{preview: migrationCommandPreview()}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := runGoBarryMigrationCommand(nil, &stdout, &stderr, func() (goBarryMigrationCommandService, error) {
		return service, nil
	})
	if code != 0 || service.previewCalls != 1 || service.importCalls != 0 {
		t.Fatalf("code=%d preview=%d import=%d stderr=%q", code, service.previewCalls, service.importCalls, stderr.String())
	}
	if !strings.Contains(stdout.String(), "Preview only") || !strings.Contains(stdout.String(), "Source policy: copy only") {
		t.Fatalf("stdout=%q", stdout.String())
	}
}

func TestGoBarryMigrationCommandApplyIsExplicitAndPreserving(t *testing.T) {
	service := &fakeGoBarryCommandService{
		preview: migrationCommandPreview(),
		result: transfer.GoBarryImportResult{
			Imported:            true,
			PreferencesImported: true,
			SessionImported:     true,
			SessionEntriesAdded: 2,
			SourcePreserved:     true,
		},
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := runGoBarryMigrationCommand([]string{"--apply"}, &stdout, &stderr, func() (goBarryMigrationCommandService, error) {
		return service, nil
	})
	if code != 0 || service.importCalls != 1 {
		t.Fatalf("code=%d import=%d stderr=%q", code, service.importCalls, stderr.String())
	}
	if !service.lastRequest.ImportPreferences || !service.lastRequest.ImportSession || !service.lastRequest.AcknowledgeSourcePreserved || service.lastRequest.ExpectedRevision != service.preview.PreviewRevision {
		t.Fatalf("request=%#v", service.lastRequest)
	}
	if !strings.Contains(stdout.String(), "source files were left untouched") {
		t.Fatalf("stdout=%q", stdout.String())
	}
}

func TestGoBarryMigrationCommandCarriesOnePreviewRevisionForSubsetImports(t *testing.T) {
	for _, test := range []struct {
		name        string
		arguments   []string
		preferences bool
		session     bool
	}{
		{name: "preferences only", arguments: []string{"--apply", "--session=false"}, preferences: true},
		{name: "session only", arguments: []string{"--apply", "--preferences=false"}, session: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeGoBarryCommandService{preview: migrationCommandPreview(), result: transfer.GoBarryImportResult{Imported: true, SourcePreserved: true}}
			var stdout bytes.Buffer
			var stderr bytes.Buffer
			code := runGoBarryMigrationCommand(test.arguments, &stdout, &stderr, func() (goBarryMigrationCommandService, error) {
				return service, nil
			})
			if code != 0 || service.importCalls != 1 {
				t.Fatalf("code=%d import=%d stderr=%q", code, service.importCalls, stderr.String())
			}
			if service.lastRequest.ImportPreferences != test.preferences || service.lastRequest.ImportSession != test.session || service.lastRequest.ExpectedRevision != service.preview.PreviewRevision {
				t.Fatalf("request=%#v", service.lastRequest)
			}
		})
	}
}

func TestGoBarryMigrationCommandRejectsMissingUnsafeAndActiveState(t *testing.T) {
	for _, test := range []struct {
		name       string
		arguments  []string
		preview    transfer.GoBarryMigrationPreview
		previewErr error
		importErr  error
		want       string
		wantCode   int
	}{
		{name: "missing", previewErr: transfer.ErrGoBarryNotFound, want: "No GoBarryGo", wantCode: 1},
		{name: "unsafe", previewErr: transfer.ErrGoBarryUnsafeState, want: "safety checks", wantCode: 1},
		{name: "active", arguments: []string{"--apply"}, preview: migrationCommandPreview(), importErr: transfer.ErrGoBarryImportActive, want: "Stop the ProtoPeek Downloader", wantCode: 1},
		{name: "preview changed", arguments: []string{"--apply"}, preview: migrationCommandPreview(), importErr: transfer.ErrGoBarryPreviewConflict, want: "run the command again", wantCode: 1},
		{name: "nothing selected", arguments: []string{"--preferences=false", "--session=false"}, want: "Select at least one", wantCode: 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeGoBarryCommandService{preview: test.preview, previewErr: test.previewErr, importErr: test.importErr}
			var stdout bytes.Buffer
			var stderr bytes.Buffer
			code := runGoBarryMigrationCommand(test.arguments, &stdout, &stderr, func() (goBarryMigrationCommandService, error) {
				return service, nil
			})
			if code != test.wantCode || !strings.Contains(stderr.String(), test.want) {
				t.Fatalf("code=%d stderr=%q stdout=%q", code, stderr.String(), stdout.String())
			}
		})
	}
}

func TestGoBarryMigrationCommandHidesProviderErrors(t *testing.T) {
	service := &fakeGoBarryCommandService{previewErr: errors.New("/home/user/private/preferences.json token=secret")}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := runGoBarryMigrationCommand(nil, &stdout, &stderr, func() (goBarryMigrationCommandService, error) {
		return service, nil
	})
	if code != 1 || strings.Contains(stderr.String(), "/home/") || strings.Contains(stderr.String(), "secret") {
		t.Fatalf("code=%d stderr=%q", code, stderr.String())
	}
}

func TestGoBarryMigrationCommandRollbackIsGuarded(t *testing.T) {
	receiptID := "20260823T120000.000000000Z-aabbccddeeff"
	service := &fakeGoBarryCommandService{rollbackResult: transfer.GoBarryRollbackResult{
		RolledBack: true, ReceiptID: receiptID, SourcePreserved: true, Message: "State restored.",
	}}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := runGoBarryMigrationCommand([]string{"--rollback", receiptID}, &stdout, &stderr, func() (goBarryMigrationCommandService, error) {
		return service, nil
	})
	if code != 0 || service.previewCalls != 0 || service.rollbackCalls != 1 || !service.lastRollback.AcknowledgeCurrentStateCheck {
		t.Fatalf("code=%d preview=%d rollback=%d request=%#v stderr=%q", code, service.previewCalls, service.rollbackCalls, service.lastRollback, stderr.String())
	}
	if !strings.Contains(stdout.String(), "State restored") {
		t.Fatalf("stdout=%q", stdout.String())
	}

	service.rollbackErr = transfer.ErrGoBarryRollbackConflict
	stdout.Reset()
	stderr.Reset()
	code = runGoBarryMigrationCommand([]string{"--rollback", receiptID}, &stdout, &stderr, func() (goBarryMigrationCommandService, error) {
		return service, nil
	})
	if code != 1 || !strings.Contains(stderr.String(), "Current files were preserved") {
		t.Fatalf("code=%d stderr=%q", code, stderr.String())
	}
}

func TestGoBarryMigrationCommandRollbackFailureDoesNotPromiseFilesWerePreserved(t *testing.T) {
	receiptID := "20260823T120000.000000000Z-aabbccddeeff"
	service := &fakeGoBarryCommandService{rollbackErr: errors.New("state was restored but marker save failed")}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := runGoBarryMigrationCommand([]string{"--rollback", receiptID}, &stdout, &stderr, func() (goBarryMigrationCommandService, error) {
		return service, nil
	})
	message := stderr.String()
	if code != 1 || service.rollbackCalls != 1 {
		t.Fatalf("code=%d rollback=%d stderr=%q", code, service.rollbackCalls, message)
	}
	for _, want := range []string{"may already have been restored", "Retry the same receipt", "retained recovery journal"} {
		if !strings.Contains(message, want) {
			t.Fatalf("stderr=%q; want %q", message, want)
		}
	}
	if strings.Contains(message, "current files were preserved") {
		t.Fatalf("stderr overpromises rollback outcome: %q", message)
	}
}

func migrationCommandPreview() transfer.GoBarryMigrationPreview {
	return transfer.GoBarryMigrationPreview{
		Available:        true,
		PreferencesFound: true,
		SessionFound:     true,
		SessionBytes:     1024,
		SessionEntries:   2,
		CanImport:        true,
		PreviewRevision:  strings.Repeat("a", 64),
		SettingChanges: []transfer.GoBarrySettingChange{{
			Key: "downloadDirectory", Before: "/old", After: "/new", Note: "Preserved.",
		}},
		PreservedButUnsupported: []string{"Native notifications remain preserved in GoBarryGo."},
	}
}
