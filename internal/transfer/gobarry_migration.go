package transfer

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	goBarryMigrationVersion   = 1
	maxGoBarryPreferencesSize = int64(1 << 20)
	maxGoBarrySessionSize     = int64(16 << 20)
	maxGoBarrySessionEntries  = 4096
	maxGoBarrySessionLine     = 64 << 10
	goBarryDefaultUserAgent   = "GoBarryGo/0.0.9 (CHITRA)"
	goBarryPendingImport      = "import"
	goBarryPendingRollback    = "rollback"
)

var (
	ErrGoBarryNotFound         = errors.New("no GoBarryGo state was found")
	ErrGoBarryUnsafeState      = errors.New("GoBarryGo state is not safe to import")
	ErrGoBarryImportActive     = errors.New("stop the transfer engine before importing GoBarryGo state")
	ErrGoBarryRollbackConflict = errors.New("ProtoPeek transfer state changed after this migration receipt")
	errGoBarryReceiptNotFound  = errors.New("GoBarryGo migration receipt was not found")
)

// GoBarryPaths identifies the final GoBarryGo user-state contract. Imports are
// intentionally limited to this known local profile; the browser API never
// accepts an arbitrary host path.
type GoBarryPaths struct {
	PreferencesFile string
	SessionFile     string
}

type GoBarrySettingChange struct {
	Key    string `json:"key"`
	Before string `json:"before"`
	After  string `json:"after"`
	Note   string `json:"note,omitempty"`
}

type GoBarryMigrationPreview struct {
	Available               bool                   `json:"available"`
	PreferencesFound        bool                   `json:"preferencesFound"`
	SessionFound            bool                   `json:"sessionFound"`
	PreferencesSHA256       string                 `json:"preferencesSha256,omitempty"`
	SessionSHA256           string                 `json:"sessionSha256,omitempty"`
	SessionBytes            int64                  `json:"sessionBytes"`
	SessionEntries          int                    `json:"sessionEntries"`
	ProposedConfig          HostConfig             `json:"proposedConfig"`
	SettingChanges          []GoBarrySettingChange `json:"settingChanges"`
	PreservedButUnsupported []string               `json:"preservedButUnsupported"`
	Warnings                []string               `json:"warnings"`
	TargetConfigExists      bool                   `json:"targetConfigExists"`
	TargetSessionExists     bool                   `json:"targetSessionExists"`
	AlreadyImported         bool                   `json:"alreadyImported"`
	CanImport               bool                   `json:"canImport"`
	EngineMustBeStopped     bool                   `json:"engineMustBeStopped"`
	LastReceiptID           string                 `json:"lastReceiptId,omitempty"`
}

type GoBarryImportRequest struct {
	ImportPreferences          bool `json:"importPreferences"`
	ImportSession              bool `json:"importSession"`
	AcknowledgeSourcePreserved bool `json:"acknowledgeSourcePreserved"`
}

type GoBarryImportResult struct {
	Imported            bool       `json:"imported"`
	PreferencesImported bool       `json:"preferencesImported"`
	SessionImported     bool       `json:"sessionImported"`
	SessionEntriesAdded int        `json:"sessionEntriesAdded"`
	SourcePreserved     bool       `json:"sourcePreserved"`
	AlreadyImported     bool       `json:"alreadyImported"`
	ImportedAt          *time.Time `json:"importedAt,omitempty"`
	Message             string     `json:"message"`
	ReceiptID           string     `json:"receiptId,omitempty"`
}

type GoBarryRollbackRequest struct {
	ReceiptID                    string `json:"receiptId"`
	AcknowledgeCurrentStateCheck bool   `json:"acknowledgeCurrentStateCheck"`
}

type GoBarryRollbackResult struct {
	RolledBack      bool       `json:"rolledBack"`
	ReceiptID       string     `json:"receiptId"`
	SourcePreserved bool       `json:"sourcePreserved"`
	RolledBackAt    *time.Time `json:"rolledBackAt,omitempty"`
	Message         string     `json:"message"`
}

type goBarryPreferences struct {
	Aria2Binary             string `json:"aria2Binary"`
	DownloadDirectory       string `json:"downloadDirectory"`
	MaxConcurrentDownloads  int    `json:"maxConcurrentDownloads"`
	Split                   int    `json:"split"`
	MaxConnectionsPerServer int    `json:"maxConnectionsPerServer"`
	MinSplitSize            string `json:"minSplitSize"`
	FileAllocation          string `json:"fileAllocation"`
	ContinueDownloads       bool   `json:"continueDownloads"`
	AlwaysResume            bool   `json:"alwaysResume"`
	AutoRename              bool   `json:"autoRename"`
	UserAgent               string `json:"userAgent"`
	NotifyOnCompletion      bool   `json:"notifyOnCompletion"`
	NotifyOnError           bool   `json:"notifyOnError"`
}

type goBarryImportLedger struct {
	Version             int       `json:"version"`
	PreferencesSHA256   string    `json:"preferencesSha256,omitempty"`
	SessionSHA256       string    `json:"sessionSha256,omitempty"`
	PreferencesImported bool      `json:"preferencesImported"`
	SessionImported     bool      `json:"sessionImported"`
	SessionEntriesAdded int       `json:"sessionEntriesAdded"`
	ImportedAt          time.Time `json:"importedAt"`
	LastReceiptID       string    `json:"lastReceiptId,omitempty"`
}

type goBarryReceiptFile struct {
	Exists bool   `json:"exists"`
	SHA256 string `json:"sha256,omitempty"`
	Backup string `json:"backup,omitempty"`
}

type goBarryMigrationReceipt struct {
	Version             int                `json:"version"`
	ReceiptID           string             `json:"receiptId"`
	ImportedAt          time.Time          `json:"importedAt"`
	PreferencesSHA256   string             `json:"preferencesSha256,omitempty"`
	SessionSHA256       string             `json:"sessionSha256,omitempty"`
	TargetConfigBefore  goBarryReceiptFile `json:"targetConfigBefore"`
	TargetSessionBefore goBarryReceiptFile `json:"targetSessionBefore"`
	TargetLedgerBefore  goBarryReceiptFile `json:"targetLedgerBefore"`
	TargetConfigAfter   goBarryReceiptFile `json:"targetConfigAfter"`
	TargetSessionAfter  goBarryReceiptFile `json:"targetSessionAfter"`
	TargetLedgerAfter   goBarryReceiptFile `json:"targetLedgerAfter"`
}

type goBarryPendingJournal struct {
	Version   int                     `json:"version"`
	Operation string                  `json:"operation"`
	Receipt   goBarryMigrationReceipt `json:"receipt"`
}

type goBarryRollbackMarker struct {
	Version      int       `json:"version"`
	ReceiptID    string    `json:"receiptId"`
	RolledBackAt time.Time `json:"rolledBackAt"`
}

type goBarrySource struct {
	preferences       goBarryPreferences
	preferencesFound  bool
	preferencesBytes  []byte
	preferencesDigest string
	sessionFound      bool
	sessionBytes      []byte
	sessionDigest     string
	sessionEntries    int
}

func DefaultGoBarryPaths() (GoBarryPaths, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return GoBarryPaths{}, fmt.Errorf("resolve user config directory: %w", err)
	}
	root = filepath.Join(root, "gobarrygo")
	return GoBarryPaths{
		PreferencesFile: filepath.Join(root, "preferences.json"),
		SessionFile:     filepath.Join(root, "session.aria2"),
	}, nil
}

// PreviewGoBarry is observational. It does not create directories, write
// target state, start aria2c, or change either product's configuration.
func (service *Service) PreviewGoBarry(ctx context.Context) (GoBarryMigrationPreview, error) {
	paths, err := DefaultGoBarryPaths()
	if err != nil {
		return GoBarryMigrationPreview{}, err
	}
	return service.previewGoBarry(ctx, paths)
}

func (service *Service) previewGoBarry(ctx context.Context, sourcePaths GoBarryPaths) (GoBarryMigrationPreview, error) {
	if err := ctx.Err(); err != nil {
		return GoBarryMigrationPreview{}, err
	}
	service.mu.RLock()
	current := service.config
	running := service.starting || service.runtime != nil
	targetPaths := service.paths
	service.mu.RUnlock()

	source, err := readGoBarrySource(sourcePaths)
	if err != nil {
		return GoBarryMigrationPreview{}, err
	}
	preview, err := buildGoBarryPreview(source, current, targetPaths, running)
	if err != nil {
		return GoBarryMigrationPreview{}, err
	}
	return preview, nil
}

func (service *Service) ImportGoBarry(ctx context.Context, request GoBarryImportRequest) (GoBarryImportResult, error) {
	paths, err := DefaultGoBarryPaths()
	if err != nil {
		return GoBarryImportResult{}, err
	}
	return service.importGoBarry(ctx, paths, request)
}

func (service *Service) RollbackGoBarry(ctx context.Context, request GoBarryRollbackRequest) (GoBarryRollbackResult, error) {
	if !request.AcknowledgeCurrentStateCheck {
		return GoBarryRollbackResult{}, errors.New("confirm that rollback must refuse changed ProtoPeek state")
	}
	receiptID := strings.TrimSpace(request.ReceiptID)
	if !validGoBarryReceiptID(receiptID) {
		return GoBarryRollbackResult{}, errors.New("invalid GoBarryGo migration receipt id")
	}
	if err := ctx.Err(); err != nil {
		return GoBarryRollbackResult{}, err
	}

	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	service.queueMu.Lock()
	defer service.queueMu.Unlock()
	service.mu.RLock()
	running := service.starting || service.runtime != nil
	targetPaths := service.paths
	service.mu.RUnlock()
	if running {
		return GoBarryRollbackResult{}, ErrGoBarryImportActive
	}
	lease, err := service.acquireGoBarryMigrationLock(targetPaths)
	if err != nil {
		return GoBarryRollbackResult{}, err
	}
	defer func() { _ = lease.Release() }()
	if _, err := recoverPendingGoBarryMigration(targetPaths); err != nil {
		return GoBarryRollbackResult{}, err
	}

	receiptDirectory := goBarryReceiptDirectory(targetPaths, receiptID)
	receipt, err := loadGoBarryReceipt(receiptDirectory, receiptID)
	if err != nil {
		return GoBarryRollbackResult{}, err
	}
	if marker, found, err := loadGoBarryRollbackMarker(receiptDirectory, receiptID); err != nil {
		return GoBarryRollbackResult{}, err
	} else if found {
		if err := ensureGoBarryReceiptTargets(targetPaths, receipt, false); err != nil {
			return GoBarryRollbackResult{}, err
		}
		config, _, err := NewConfigStore(targetPaths.ConfigFile).Load()
		if err != nil {
			return GoBarryRollbackResult{}, err
		}
		service.mu.Lock()
		service.config = config
		service.mu.Unlock()
		return goBarryRollbackResult(receiptID, marker.RolledBackAt), nil
	}
	if err := ensureGoBarryReceiptTargets(targetPaths, receipt, true); err != nil {
		return GoBarryRollbackResult{}, err
	}

	ledgerPath := goBarryLedgerPath(targetPaths)
	originalConfig, err := receiptBackupBytes(receiptDirectory, receipt.TargetConfigBefore, maxGoBarryPreferencesSize)
	if err != nil {
		return GoBarryRollbackResult{}, err
	}
	originalSession, err := receiptBackupBytes(receiptDirectory, receipt.TargetSessionBefore, maxGoBarrySessionSize)
	if err != nil {
		return GoBarryRollbackResult{}, err
	}
	originalLedger, err := receiptBackupBytes(receiptDirectory, receipt.TargetLedgerBefore, maxGoBarryPreferencesSize)
	if err != nil {
		return GoBarryRollbackResult{}, err
	}

	if err := savePendingGoBarryMigration(targetPaths, goBarryPendingRollback, receipt); err != nil {
		return GoBarryRollbackResult{}, err
	}
	rollbackFailure := func(cause error) error {
		_, recoveryErr := recoverPendingGoBarryMigration(targetPaths)
		return errors.Join(cause, recoveryErr)
	}
	// All shipped ProtoPeek writers cooperate on the engine lock. This immediate
	// hash boundary refuses a cooperative writer before the first rollback write;
	// manual editors are outside advisory-lock guarantees and are still caught by
	// the per-target and final hash verification below when they do not race a rename.
	if err := ensureGoBarryReceiptTargets(targetPaths, receipt, true); err != nil {
		return GoBarryRollbackResult{}, rollbackFailure(err)
	}
	if err := restoreOptionalTarget(targetPaths.ConfigFile, originalConfig, receipt.TargetConfigBefore.Exists, 0o600); err != nil {
		return GoBarryRollbackResult{}, rollbackFailure(err)
	}
	if err := ensureGoBarryReceiptTarget(targetPaths.ConfigFile, maxGoBarryPreferencesSize, receipt.TargetConfigBefore); err != nil {
		return GoBarryRollbackResult{}, rollbackFailure(err)
	}
	if err := restoreOptionalTarget(targetPaths.SessionFile, originalSession, receipt.TargetSessionBefore.Exists, 0o600); err != nil {
		return GoBarryRollbackResult{}, rollbackFailure(err)
	}
	if err := ensureGoBarryReceiptTarget(targetPaths.SessionFile, maxGoBarrySessionSize, receipt.TargetSessionBefore); err != nil {
		return GoBarryRollbackResult{}, rollbackFailure(err)
	}
	if err := restoreOptionalTarget(ledgerPath, originalLedger, receipt.TargetLedgerBefore.Exists, 0o600); err != nil {
		return GoBarryRollbackResult{}, rollbackFailure(err)
	}
	if err := ensureGoBarryReceiptTarget(ledgerPath, maxGoBarryPreferencesSize, receipt.TargetLedgerBefore); err != nil {
		return GoBarryRollbackResult{}, rollbackFailure(err)
	}
	if err := ensureGoBarryReceiptTargets(targetPaths, receipt, false); err != nil {
		return GoBarryRollbackResult{}, rollbackFailure(err)
	}
	now := service.now().UTC()
	if err := saveGoBarryRollbackMarker(receiptDirectory, goBarryRollbackMarker{
		Version:      goBarryMigrationVersion,
		ReceiptID:    receiptID,
		RolledBackAt: now,
	}); err != nil {
		return GoBarryRollbackResult{}, fmt.Errorf("state was restored but rollback marker could not be saved: %w", err)
	}
	if err := removeGoBarryPending(targetPaths); err != nil {
		return GoBarryRollbackResult{}, fmt.Errorf("rollback committed but pending marker cleanup failed: %w", err)
	}
	config, _, err := NewConfigStore(targetPaths.ConfigFile).Load()
	if err != nil {
		return GoBarryRollbackResult{}, err
	}
	service.mu.Lock()
	service.config = config
	service.mu.Unlock()
	return goBarryRollbackResult(receiptID, now), nil
}

func goBarryRollbackResult(receiptID string, rolledBackAt time.Time) GoBarryRollbackResult {
	return GoBarryRollbackResult{
		RolledBack:      true,
		ReceiptID:       receiptID,
		SourcePreserved: true,
		RolledBackAt:    &rolledBackAt,
		Message:         "ProtoPeek transfer state was restored from the migration receipt. GoBarryGo source files remain untouched.",
	}
}

func (service *Service) importGoBarry(ctx context.Context, sourcePaths GoBarryPaths, request GoBarryImportRequest) (GoBarryImportResult, error) {
	if !request.AcknowledgeSourcePreserved {
		return GoBarryImportResult{}, errors.New("confirm that GoBarryGo source files will be preserved")
	}
	if !request.ImportPreferences && !request.ImportSession {
		return GoBarryImportResult{}, errors.New("select preferences, session, or both to import")
	}
	if err := ctx.Err(); err != nil {
		return GoBarryImportResult{}, err
	}

	service.operationMu.Lock()
	defer service.operationMu.Unlock()
	service.queueMu.Lock()
	defer service.queueMu.Unlock()

	service.mu.RLock()
	current := service.config
	running := service.starting || service.runtime != nil
	targetPaths := service.paths
	service.mu.RUnlock()
	if running {
		return GoBarryImportResult{}, ErrGoBarryImportActive
	}
	lease, err := service.acquireGoBarryMigrationLock(targetPaths)
	if err != nil {
		return GoBarryImportResult{}, err
	}
	defer func() { _ = lease.Release() }()

	recovered, err := recoverPendingGoBarryMigration(targetPaths)
	if err != nil {
		return GoBarryImportResult{}, err
	}
	ledgerPath := goBarryLedgerPath(targetPaths)
	originalConfig, configExisted, err := readOptionalTarget(targetPaths.ConfigFile, maxGoBarryPreferencesSize)
	if err != nil {
		return GoBarryImportResult{}, err
	}
	originalSession, sessionExisted, err := readOptionalTarget(targetPaths.SessionFile, maxGoBarrySessionSize)
	if err != nil {
		return GoBarryImportResult{}, err
	}
	originalLedger, ledgerFileExisted, err := readOptionalTarget(ledgerPath, maxGoBarryPreferencesSize)
	if err != nil {
		return GoBarryImportResult{}, err
	}
	current, err = decodeGoBarryTargetConfig(originalConfig, configExisted, current, recovered)
	if err != nil {
		return GoBarryImportResult{}, err
	}
	service.mu.Lock()
	service.config = current
	service.mu.Unlock()
	ledger, ledgerExists, err := decodeGoBarryLedger(originalLedger, ledgerFileExisted)
	if err != nil {
		return GoBarryImportResult{}, err
	}

	source, err := readGoBarrySource(sourcePaths)
	if err != nil {
		return GoBarryImportResult{}, err
	}
	preview, err := buildGoBarryPreview(source, current, targetPaths, false)
	if err != nil {
		return GoBarryImportResult{}, err
	}
	if request.ImportPreferences && !source.preferencesFound {
		return GoBarryImportResult{}, errors.New("GoBarryGo preferences were not found")
	}
	if request.ImportSession && !source.sessionFound {
		return GoBarryImportResult{}, errors.New("GoBarryGo session was not found")
	}

	preferencesDone := !request.ImportPreferences || (ledgerExists && ledger.PreferencesImported && ledger.PreferencesSHA256 == source.preferencesDigest)
	sessionDone := !request.ImportSession || (ledgerExists && ledger.SessionImported && ledger.SessionSHA256 == source.sessionDigest)
	if preferencesDone && sessionDone {
		when := ledger.ImportedAt
		return GoBarryImportResult{
			SourcePreserved: true,
			AlreadyImported: true,
			ImportedAt:      &when,
			ReceiptID:       ledger.LastReceiptID,
			Message:         "This exact GoBarryGo state was already imported; no files changed.",
		}, nil
	}

	newConfig := current
	willImportPreferences := request.ImportPreferences && !preferencesDone
	willImportSession := request.ImportSession && !sessionDone
	if willImportPreferences {
		newConfig = preview.ProposedConfig
	}
	entriesAdded := 0
	plannedSession := originalSession
	plannedSessionExists := sessionExisted
	if willImportSession {
		var mergedSession []byte
		mergedSession, entriesAdded, err = mergeAria2Sessions(originalSession, source.sessionBytes, goBarrySessionEntryLimit(newConfig))
		if err != nil {
			return GoBarryImportResult{}, err
		}
		plannedSession = mergedSession
		plannedSessionExists = true
	}

	now := service.now().UTC()
	receiptID := newGoBarryReceiptID(now, source)
	updatedLedger := goBarryImportLedger{
		Version:             goBarryMigrationVersion,
		PreferencesSHA256:   ledger.PreferencesSHA256,
		SessionSHA256:       ledger.SessionSHA256,
		PreferencesImported: ledger.PreferencesImported,
		SessionImported:     ledger.SessionImported,
		SessionEntriesAdded: ledger.SessionEntriesAdded,
		ImportedAt:          now,
		LastReceiptID:       receiptID,
	}
	if request.ImportPreferences {
		updatedLedger.PreferencesSHA256 = source.preferencesDigest
		updatedLedger.PreferencesImported = true
	}
	if request.ImportSession {
		updatedLedger.SessionSHA256 = source.sessionDigest
		updatedLedger.SessionImported = true
		updatedLedger.SessionEntriesAdded += entriesAdded
	}
	plannedLedger, err := json.MarshalIndent(updatedLedger, "", "  ")
	if err != nil {
		return GoBarryImportResult{}, fmt.Errorf("encode GoBarryGo import ledger: %w", err)
	}
	plannedLedger = append(plannedLedger, '\n')
	plannedConfig := originalConfig
	plannedConfigExists := configExisted
	if willImportPreferences {
		plannedConfig, err = encodeGoBarryTargetConfig(newConfig)
		if err != nil {
			return GoBarryImportResult{}, err
		}
		plannedConfigExists = true
	}

	receiptDirectory := goBarryReceiptDirectory(targetPaths, receiptID)
	receipt, err := stageGoBarryReceiptBackups(receiptDirectory, receiptID, now, source, originalConfig, configExisted, originalSession, sessionExisted, originalLedger, ledgerFileExisted)
	if err != nil {
		return GoBarryImportResult{}, err
	}
	receipt.TargetConfigAfter = plannedReceiptTarget(plannedConfig, plannedConfigExists)
	receipt.TargetSessionAfter = plannedReceiptTarget(plannedSession, plannedSessionExists)
	receipt.TargetLedgerAfter = plannedReceiptTarget(plannedLedger, true)
	if err := savePendingGoBarryMigration(targetPaths, goBarryPendingImport, receipt); err != nil {
		return GoBarryImportResult{}, err
	}
	rollback := func(cause error) error {
		_, recoveryErr := recoverPendingGoBarryMigration(targetPaths)
		return errors.Join(cause, recoveryErr)
	}
	// All shipped ProtoPeek writers cooperate on the engine lock. This immediate
	// hash boundary refuses a cooperative writer before the first import write;
	// manual editors remain outside advisory-lock guarantees.
	if err := ensureGoBarryReceiptTargets(targetPaths, receipt, false); err != nil {
		return GoBarryImportResult{}, rollback(err)
	}

	result := GoBarryImportResult{SourcePreserved: true}
	if willImportPreferences {
		if err := writeAtomicPrivate(targetPaths.ConfigFile, plannedConfig); err != nil {
			return GoBarryImportResult{}, rollback(fmt.Errorf("save imported transfer preferences: %w", err))
		}
		if err := ensureGoBarryReceiptTarget(targetPaths.ConfigFile, maxGoBarryPreferencesSize, receipt.TargetConfigAfter); err != nil {
			return GoBarryImportResult{}, rollback(err)
		}
		result.PreferencesImported = true
	}
	if willImportSession {
		if err := writeAtomicPrivate(targetPaths.SessionFile, plannedSession); err != nil {
			return GoBarryImportResult{}, rollback(fmt.Errorf("save imported aria2 session: %w", err))
		}
		if err := ensureGoBarryReceiptTarget(targetPaths.SessionFile, maxGoBarrySessionSize, receipt.TargetSessionAfter); err != nil {
			return GoBarryImportResult{}, rollback(err)
		}
		result.SessionImported = true
		result.SessionEntriesAdded = entriesAdded
	}

	if err := writeAtomicPrivate(ledgerPath, plannedLedger); err != nil {
		return GoBarryImportResult{}, rollback(fmt.Errorf("save GoBarryGo import ledger: %w", err))
	}
	if err := ensureGoBarryReceiptTarget(ledgerPath, maxGoBarryPreferencesSize, receipt.TargetLedgerAfter); err != nil {
		return GoBarryImportResult{}, rollback(err)
	}

	unchanged, err := goBarrySourceUnchanged(sourcePaths, source)
	if err != nil || !unchanged {
		if err == nil {
			err = errors.New("GoBarryGo source state changed during import")
		}
		return GoBarryImportResult{}, rollback(err)
	}
	if err := ensureGoBarryReceiptTargets(targetPaths, receipt, true); err != nil {
		return GoBarryImportResult{}, rollback(err)
	}
	if err := saveGoBarryReceipt(receiptDirectory, receipt); err != nil {
		return GoBarryImportResult{}, rollback(err)
	}
	if err := removeGoBarryPending(targetPaths); err != nil {
		return GoBarryImportResult{}, fmt.Errorf("migration committed but pending marker cleanup failed: %w", err)
	}
	service.mu.Lock()
	service.config = newConfig
	service.mu.Unlock()
	result.Imported = result.PreferencesImported || result.SessionImported
	result.ImportedAt = &now
	result.ReceiptID = receiptID
	result.Message = "GoBarryGo state imported into ProtoPeek. The original GoBarryGo files were left untouched."
	return result, nil
}

func buildGoBarryPreview(source goBarrySource, current HostConfig, targetPaths Paths, running bool) (GoBarryMigrationPreview, error) {
	if !source.preferencesFound && !source.sessionFound {
		return GoBarryMigrationPreview{}, ErrGoBarryNotFound
	}
	preview := GoBarryMigrationPreview{
		Available:               true,
		PreferencesFound:        source.preferencesFound,
		SessionFound:            source.sessionFound,
		PreferencesSHA256:       source.preferencesDigest,
		SessionSHA256:           source.sessionDigest,
		SessionBytes:            int64(len(source.sessionBytes)),
		SessionEntries:          source.sessionEntries,
		ProposedConfig:          current,
		SettingChanges:          []GoBarrySettingChange{},
		PreservedButUnsupported: []string{},
		Warnings:                []string{},
		EngineMustBeStopped:     running,
		CanImport:               !running,
	}
	preview.TargetConfigExists = regularTargetExists(targetPaths.ConfigFile)
	preview.TargetSessionExists = regularTargetExists(targetPaths.SessionFile)
	if source.preferencesFound {
		preview.ProposedConfig, preview.SettingChanges, preview.PreservedButUnsupported, preview.Warnings = mapGoBarryPreferences(current, source.preferences)
		if err := ValidateHostConfig(preview.ProposedConfig); err != nil {
			return GoBarryMigrationPreview{}, fmt.Errorf("validate mapped GoBarryGo preferences: %w", err)
		}
	}
	ledger, exists, err := loadGoBarryLedger(goBarryLedgerPath(targetPaths))
	if err != nil {
		return GoBarryMigrationPreview{}, err
	}
	if exists {
		preferencesMatch := !source.preferencesFound || (ledger.PreferencesImported && ledger.PreferencesSHA256 == source.preferencesDigest)
		sessionMatch := !source.sessionFound || (ledger.SessionImported && ledger.SessionSHA256 == source.sessionDigest)
		preview.AlreadyImported = preferencesMatch && sessionMatch
		preview.LastReceiptID = ledger.LastReceiptID
	}
	return preview, nil
}

func mapGoBarryPreferences(current HostConfig, source goBarryPreferences) (HostConfig, []GoBarrySettingChange, []string, []string) {
	proposed := current
	changes := []GoBarrySettingChange{}
	unsupported := []string{
		"desktop completion and error notifications are not imported because ProtoPeek does not claim a native notification surface.",
	}
	warnings := []string{}
	change := func(key, before, after, note string) {
		if before == after {
			return
		}
		changes = append(changes, GoBarrySettingChange{Key: key, Before: before, After: after, Note: note})
	}

	if path := strings.TrimSpace(source.Aria2Binary); path != "" {
		if containsControl(path) {
			warnings = append(warnings, "The configured GoBarryGo aria2 path contains an unsafe control character and was not imported.")
		} else if executable, err := validateGoBarryExecutable(path); err != nil {
			warnings = append(warnings, "The configured GoBarryGo aria2 executable is not currently usable and was not imported.")
		} else {
			change("aria2Path", proposed.Aria2Path, executable, "Uses the same validated external aria2c executable.")
			proposed.Aria2Path = executable
		}
	}
	if directory := strings.TrimSpace(source.DownloadDirectory); directory != "" {
		if filepath.IsAbs(directory) && !containsControl(directory) {
			change("downloadDirectory", proposed.DownloadDirectory, directory, "Keeps the existing download destination.")
			proposed.DownloadDirectory = directory
		} else {
			warnings = append(warnings, "The GoBarryGo download directory was not an absolute safe path and was not imported.")
		}
	}

	active := clampInt(source.MaxConcurrentDownloads, 1, 16, proposed.MaxActiveJobs)
	change("maxActiveJobs", strconv.Itoa(proposed.MaxActiveJobs), strconv.Itoa(active), clampNote(source.MaxConcurrentDownloads, active, 16))
	proposed.MaxActiveJobs = active
	if proposed.MaxQueuedJobs < active {
		proposed.MaxQueuedJobs = active
	}
	if proposed.MaxTrackedJobs < active {
		proposed.MaxTrackedJobs = active
	}
	split := clampInt(source.Split, 1, 16, proposed.Split)
	change("split", strconv.Itoa(proposed.Split), strconv.Itoa(split), clampNote(source.Split, split, 16))
	proposed.Split = split
	connections := clampInt(source.MaxConnectionsPerServer, 1, 16, proposed.MaxConnectionsPerHost)
	change("maxConnectionsPerHost", strconv.Itoa(proposed.MaxConnectionsPerHost), strconv.Itoa(connections), clampNote(source.MaxConnectionsPerServer, connections, 16))
	proposed.MaxConnectionsPerHost = connections
	if size, err := parseAria2Size(source.MinSplitSize); err == nil {
		if size < minSplitSizeBytes {
			size = minSplitSizeBytes
		}
		if size > maxSplitSizeBytes {
			size = maxSplitSizeBytes
		}
		change("minSplitSizeBytes", strconv.FormatInt(proposed.MinSplitSizeBytes, 10), strconv.FormatInt(size, 10), "Converted from aria2 size syntax.")
		proposed.MinSplitSizeBytes = size
	} else if strings.TrimSpace(source.MinSplitSize) != "" {
		warnings = append(warnings, "The GoBarryGo minimum split size was not valid aria2 size syntax and was not imported.")
	}
	change("continuePartialDownloads", strconv.FormatBool(proposed.ContinuePartialDownloads), strconv.FormatBool(source.ContinueDownloads), "Preserves partial-download continuation.")
	proposed.ContinuePartialDownloads = source.ContinueDownloads
	change("alwaysResume", strconv.FormatBool(proposed.AlwaysResume), strconv.FormatBool(source.AlwaysResume), "Preserves GoBarryGo's separate aria2 resume policy.")
	proposed.AlwaysResume = source.AlwaysResume
	allocation := strings.TrimSpace(source.FileAllocation)
	switch allocation {
	case "none", "prealloc", "trunc", "falloc":
		change("fileAllocation", proposed.FileAllocation, allocation, "Preserves aria2 file-allocation behavior.")
		proposed.FileAllocation = allocation
	default:
		warnings = append(warnings, "The GoBarryGo file-allocation value was not recognized and was not imported.")
	}
	change("autoRenameConflictingFiles", strconv.FormatBool(proposed.AutoRenameConflictingFiles), strconv.FormatBool(source.AutoRename), "Preserves conflict-safe automatic renaming.")
	proposed.AutoRenameConflictingFiles = source.AutoRename
	if source.AutoRename {
		proposed.AllowOverwriteExistingFiles = false
	}
	userAgent := strings.TrimSpace(source.UserAgent)
	if userAgent != "" && userAgent != goBarryDefaultUserAgent && !strings.HasPrefix(userAgent, "GoBarryGo/") && len(userAgent) <= maxUserAgentLength && !containsControl(userAgent) {
		change("userAgent", proposed.UserAgent, userAgent, "Preserves a custom user agent.")
		proposed.UserAgent = userAgent
	} else if strings.HasPrefix(userAgent, "GoBarryGo/") {
		warnings = append(warnings, "The old GoBarryGo product user agent was replaced by ProtoPeek instead of carrying retired branding forward.")
		change("userAgent", proposed.UserAgent, "ProtoPeek", "Normalizes the retired product identifier.")
		proposed.UserAgent = "ProtoPeek"
	}
	return proposed, changes, unsupported, warnings
}

func validateGoBarryExecutable(path string) (string, error) {
	resolved := path
	if !filepath.IsAbs(resolved) {
		var err error
		resolved, err = exec.LookPath(resolved)
		if err != nil {
			return "", err
		}
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("aria2 executable is not a regular file")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
		return "", errors.New("aria2 executable is not executable")
	}
	return resolved, nil
}

func readGoBarrySource(paths GoBarryPaths) (goBarrySource, error) {
	if paths.PreferencesFile == "" || paths.SessionFile == "" || !filepath.IsAbs(paths.PreferencesFile) || !filepath.IsAbs(paths.SessionFile) {
		return goBarrySource{}, fmt.Errorf("%w: source paths must be absolute", ErrGoBarryUnsafeState)
	}
	var source goBarrySource
	preferences, found, err := readRegularSource(paths.PreferencesFile, maxGoBarryPreferencesSize)
	if err != nil {
		return source, err
	}
	if found {
		if err := validateGoBarryPreferenceFields(preferences); err != nil {
			return source, fmt.Errorf("%w: %v", ErrGoBarryUnsafeState, err)
		}
		decoder := json.NewDecoder(bytes.NewReader(preferences))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&source.preferences); err != nil {
			return source, fmt.Errorf("%w: decode GoBarryGo preferences: %v", ErrGoBarryUnsafeState, err)
		}
		if err := ensureJSONEOF(decoder); err != nil {
			return source, fmt.Errorf("%w: %v", ErrGoBarryUnsafeState, err)
		}
		source.preferencesFound = true
		source.preferencesBytes = preferences
		source.preferencesDigest = digestHex(preferences)
	}
	session, found, err := readRegularSource(paths.SessionFile, maxGoBarrySessionSize)
	if err != nil {
		return source, err
	}
	if found {
		entries, err := validateAria2Session(session)
		if err != nil {
			return source, fmt.Errorf("%w: %v", ErrGoBarryUnsafeState, err)
		}
		source.sessionFound = true
		source.sessionBytes = normalizeSessionNewlines(session)
		source.sessionDigest = digestHex(session)
		source.sessionEntries = entries
	}
	return source, nil
}

func validateGoBarryPreferenceFields(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return fmt.Errorf("decode GoBarryGo preferences: %w", err)
	}
	for _, required := range []string{
		"aria2Binary",
		"downloadDirectory",
		"maxConcurrentDownloads",
		"split",
		"maxConnectionsPerServer",
		"minSplitSize",
		"fileAllocation",
		"continueDownloads",
		"alwaysResume",
		"autoRename",
		"userAgent",
		"notifyOnCompletion",
		"notifyOnError",
	} {
		if _, exists := fields[required]; !exists {
			return fmt.Errorf("GoBarryGo preferences are missing required field %q", required)
		}
	}
	return nil
}

func readRegularSource(path string, maximum int64) ([]byte, bool, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("inspect GoBarryGo source: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, false, fmt.Errorf("%w: source must be a regular file, not a link or special file", ErrGoBarryUnsafeState)
	}
	if info.Size() > maximum {
		return nil, false, fmt.Errorf("%w: source exceeds the %d-byte limit", ErrGoBarryUnsafeState, maximum)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, false, fmt.Errorf("open GoBarryGo source: %w", err)
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, false, fmt.Errorf("inspect opened GoBarryGo source: %w", err)
	}
	if !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
		return nil, false, fmt.Errorf("%w: source changed or became a link while it was opened", ErrGoBarryUnsafeState)
	}
	if openedInfo.Size() > maximum {
		return nil, false, fmt.Errorf("%w: source exceeds the %d-byte limit", ErrGoBarryUnsafeState, maximum)
	}
	data, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil {
		return nil, false, fmt.Errorf("read GoBarryGo source: %w", err)
	}
	if int64(len(data)) > maximum {
		return nil, false, fmt.Errorf("%w: source exceeds the %d-byte limit", ErrGoBarryUnsafeState, maximum)
	}
	return data, true, nil
}

func validateAria2Session(data []byte) (int, error) {
	if bytes.IndexByte(data, 0) >= 0 {
		return 0, errors.New("aria2 session contains a NUL byte")
	}
	entries := 0
	scanner := bytes.Split(normalizeSessionNewlines(data), []byte{'\n'})
	haveEntry := false
	for _, raw := range scanner {
		if len(raw) > maxGoBarrySessionLine {
			return 0, fmt.Errorf("aria2 session line exceeds %d bytes", maxGoBarrySessionLine)
		}
		line := string(raw)
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if line[0] == ' ' || line[0] == '\t' {
			if !haveEntry {
				return 0, errors.New("aria2 session option appears before a source")
			}
			key, _, _ := strings.Cut(strings.TrimSpace(line), "=")
			key = strings.ToLower(strings.TrimSpace(key))
			if _, allowed := goBarrySessionOptionAllowlist[key]; !allowed {
				return 0, fmt.Errorf("aria2 session contains disallowed option %q", key)
			}
			continue
		}
		for _, rawSource := range strings.Fields(line) {
			parsed, err := url.Parse(rawSource)
			if err != nil || !parsed.IsAbs() || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
				return 0, errors.New("aria2 session source must be an absolute HTTP(S) URL without user information")
			}
		}
		haveEntry = true
		entries++
		if entries > maxGoBarrySessionEntries {
			return 0, fmt.Errorf("aria2 session contains more than %d entries", maxGoBarrySessionEntries)
		}
	}
	return entries, nil
}

var goBarrySessionOptionAllowlist = map[string]struct{}{
	"allow-overwrite":           {},
	"auto-file-renaming":        {},
	"check-certificate":         {},
	"checksum":                  {},
	"connect-timeout":           {},
	"continue":                  {},
	"dir":                       {},
	"dry-run":                   {},
	"file-allocation":           {},
	"gid":                       {},
	"header":                    {},
	"http-accept-gzip":          {},
	"http-auth-challenge":       {},
	"http-no-cache":             {},
	"http-passwd":               {},
	"http-user":                 {},
	"index-out":                 {},
	"lowest-speed-limit":        {},
	"max-connection-per-server": {},
	"max-download-limit":        {},
	"max-file-not-found":        {},
	"max-tries":                 {},
	"min-split-size":            {},
	"out":                       {},
	"parameterized-uri":         {},
	"pause":                     {},
	"piece-length":              {},
	"proxy-method":              {},
	"referer":                   {},
	"remote-time":               {},
	"retry-wait":                {},
	"select-file":               {},
	"split":                     {},
	"stream-piece-selector":     {},
	"timeout":                   {},
	"uri-selector":              {},
	"use-head":                  {},
	"user-agent":                {},
	"always-resume":             {},
}

func goBarrySessionEntryLimit(config HostConfig) int {
	limit := maxGoBarrySessionEntries
	if config.MaxQueuedJobs < limit {
		limit = config.MaxQueuedJobs
	}
	if config.MaxTrackedJobs < limit {
		limit = config.MaxTrackedJobs
	}
	return limit
}

func mergeAria2Sessions(target, source []byte, maximumEntries int) ([]byte, int, error) {
	if maximumEntries < 1 || maximumEntries > maxGoBarrySessionEntries {
		return nil, 0, fmt.Errorf("invalid merged aria2 session entry limit %d", maximumEntries)
	}
	target = normalizeSessionNewlines(target)
	source = normalizeSessionNewlines(source)
	if _, err := validateAria2Session(target); err != nil {
		return nil, 0, fmt.Errorf("existing ProtoPeek aria2 session is invalid: %w", err)
	}
	if _, err := validateAria2Session(source); err != nil {
		return nil, 0, fmt.Errorf("GoBarryGo aria2 session is invalid: %w", err)
	}
	targetBlocks := sessionBlocks(target)
	seen := make(map[string]struct{}, len(targetBlocks))
	for _, block := range targetBlocks {
		seen[digestHex(sessionBlockIdentity(block))] = struct{}{}
	}
	added := 0
	for _, block := range sessionBlocks(source) {
		block = forceSessionBlockPaused(block)
		digest := digestHex(sessionBlockIdentity(block))
		if _, exists := seen[digest]; exists {
			continue
		}
		seen[digest] = struct{}{}
		targetBlocks = append(targetBlocks, block)
		added++
	}
	if len(targetBlocks) == 0 {
		return []byte{}, 0, nil
	}
	merged := append(bytes.Join(targetBlocks, []byte{'\n'}), '\n')
	if int64(len(merged)) > maxGoBarrySessionSize {
		return nil, 0, fmt.Errorf("merged aria2 session exceeds %d bytes", maxGoBarrySessionSize)
	}
	entries, err := validateAria2Session(merged)
	if err != nil {
		return nil, 0, fmt.Errorf("merged aria2 session is invalid: %w", err)
	}
	if entries > maximumEntries {
		return nil, 0, fmt.Errorf("merged aria2 session contains %d entries; configured limit is %d", entries, maximumEntries)
	}
	return merged, added, nil
}

func sessionBlockIdentity(block []byte) []byte {
	lines := bytes.Split(block, []byte{'\n'})
	identity := make([][]byte, 0, len(lines))
	for _, line := range lines {
		if len(line) > 0 && (line[0] == ' ' || line[0] == '\t') {
			key, _, _ := strings.Cut(strings.TrimSpace(string(line)), "=")
			if strings.EqualFold(strings.TrimSpace(key), "pause") {
				continue
			}
		}
		identity = append(identity, bytes.TrimSpace(line))
	}
	return bytes.Join(identity, []byte{'\n'})
}

func forceSessionBlockPaused(block []byte) []byte {
	lines := bytes.Split(block, []byte{'\n'})
	found := false
	for index, line := range lines {
		if len(line) == 0 || (line[0] != ' ' && line[0] != '\t') {
			continue
		}
		key, _, _ := strings.Cut(strings.TrimSpace(string(line)), "=")
		if strings.EqualFold(strings.TrimSpace(key), "pause") {
			lines[index] = []byte(" pause=true")
			found = true
		}
	}
	if !found {
		lines = append(lines, []byte(" pause=true"))
	}
	return bytes.Join(lines, []byte{'\n'})
}

func sessionBlocks(data []byte) [][]byte {
	lines := bytes.Split(normalizeSessionNewlines(data), []byte{'\n'})
	blocks := make([][]byte, 0)
	var current [][]byte
	flush := func() {
		if len(current) == 0 {
			return
		}
		block := bytes.TrimSpace(bytes.Join(current, []byte{'\n'}))
		if len(block) != 0 {
			blocks = append(blocks, append([]byte(nil), block...))
		}
		current = nil
	}
	for _, line := range lines {
		trimmed := bytes.TrimSpace(line)
		if len(trimmed) == 0 || bytes.HasPrefix(trimmed, []byte{'#'}) {
			flush()
			continue
		}
		if len(line) > 0 && line[0] != ' ' && line[0] != '\t' {
			flush()
		}
		current = append(current, line)
	}
	flush()
	return blocks
}

func normalizeSessionNewlines(data []byte) []byte {
	return bytes.ReplaceAll(bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n")), []byte("\r"), []byte("\n"))
}

func parseAria2Size(raw string) (int64, error) {
	value := strings.ToUpper(strings.TrimSpace(raw))
	if value == "" {
		return 0, errors.New("size is empty")
	}
	multiplier := int64(1)
	suffixes := []struct {
		suffix     string
		multiplier int64
	}{{"KIB", 1 << 10}, {"MIB", 1 << 20}, {"GIB", 1 << 30}, {"TIB", 1 << 40}, {"KB", 1 << 10}, {"MB", 1 << 20}, {"GB", 1 << 30}, {"TB", 1 << 40}, {"K", 1 << 10}, {"M", 1 << 20}, {"G", 1 << 30}, {"T", 1 << 40}}
	for _, candidate := range suffixes {
		if strings.HasSuffix(value, candidate.suffix) {
			value = strings.TrimSpace(strings.TrimSuffix(value, candidate.suffix))
			multiplier = candidate.multiplier
			break
		}
	}
	number, err := strconv.ParseInt(value, 10, 64)
	if err != nil || number < 0 || (number != 0 && number > (1<<62)/multiplier) {
		return 0, errors.New("invalid aria2 size")
	}
	return number * multiplier, nil
}

func decodeGoBarryTargetConfig(data []byte, exists bool, fallback HostConfig, resetMissing bool) (HostConfig, error) {
	if !exists {
		if resetMissing {
			return DefaultHostConfig(), nil
		}
		return fallback, nil
	}
	config := DefaultHostConfig()
	config.Version = 0
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return HostConfig{}, fmt.Errorf("decode migration target config: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return HostConfig{}, err
	}
	if err := ValidateHostConfig(config); err != nil {
		return HostConfig{}, fmt.Errorf("validate migration target config: %w", err)
	}
	return config, nil
}

func encodeGoBarryTargetConfig(config HostConfig) ([]byte, error) {
	if err := ValidateHostConfig(config); err != nil {
		return nil, fmt.Errorf("validate imported transfer preferences: %w", err)
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode imported transfer preferences: %w", err)
	}
	return append(data, '\n'), nil
}

func loadGoBarryLedger(path string) (goBarryImportLedger, bool, error) {
	data, found, err := readOptionalTarget(path, maxGoBarryPreferencesSize)
	if err != nil {
		return goBarryImportLedger{}, false, err
	}
	return decodeGoBarryLedger(data, found)
}

func decodeGoBarryLedger(data []byte, found bool) (goBarryImportLedger, bool, error) {
	if !found {
		return goBarryImportLedger{}, false, nil
	}
	var ledger goBarryImportLedger
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&ledger); err != nil {
		return ledger, true, fmt.Errorf("decode GoBarryGo import ledger: %w", err)
	}
	if err := ensureGoBarryJSONEOF(decoder, "GoBarryGo import ledger"); err != nil {
		return ledger, true, err
	}
	if ledger.Version != goBarryMigrationVersion {
		return ledger, true, fmt.Errorf("unsupported GoBarryGo import ledger version %d", ledger.Version)
	}
	return ledger, true, nil
}

func plannedReceiptTarget(data []byte, exists bool) goBarryReceiptFile {
	target := goBarryReceiptFile{Exists: exists}
	if exists {
		target.SHA256 = digestHex(data)
	}
	return target
}

func readOptionalTarget(path string, maximum int64) ([]byte, bool, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("inspect migration target: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, false, fmt.Errorf("migration target must be a regular file")
	}
	if info.Size() > maximum {
		return nil, false, fmt.Errorf("migration target exceeds %d bytes", maximum)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, false, fmt.Errorf("open migration target: %w", err)
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, false, fmt.Errorf("inspect opened migration target: %w", err)
	}
	if !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
		return nil, false, errors.New("migration target changed or became a link while it was opened")
	}
	if openedInfo.Size() > maximum {
		return nil, false, fmt.Errorf("migration target exceeds %d bytes", maximum)
	}
	data, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil {
		return nil, false, fmt.Errorf("read migration target: %w", err)
	}
	if int64(len(data)) > maximum {
		return nil, false, fmt.Errorf("migration target exceeds %d bytes", maximum)
	}
	return data, true, nil
}

func restoreOptionalTarget(path string, data []byte, existed bool, mode os.FileMode) error {
	if !existed {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove partial migration target: %w", err)
		} else if err == nil {
			if err := syncDirectory(filepath.Dir(path)); err != nil {
				return fmt.Errorf("sync removed migration target: %w", err)
			}
		}
		return nil
	}
	if mode == 0 {
		mode = 0o600
	}
	return writeAtomic(path, data, mode)
}

func writeAtomicPrivate(path string, data []byte) error {
	return writeAtomic(path, data, 0o600)
}

func writeAtomic(path string, data []byte, mode os.FileMode) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create migration target directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".gobarry-import-*")
	if err != nil {
		return fmt.Errorf("create migration staging file: %w", err)
	}
	temporaryPath := temporary.Name()
	committed := false
	defer func() {
		_ = temporary.Close()
		if !committed {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(mode); err != nil {
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	if err := syncDirectory(directory); err != nil {
		return fmt.Errorf("sync migration target directory: %w", err)
	}
	committed = true
	return nil
}

func goBarryLedgerPath(paths Paths) string {
	return filepath.Join(paths.StateDirectory, "gobarry-import.json")
}

func goBarryReceiptDirectory(paths Paths, receiptID string) string {
	return filepath.Join(paths.StateDirectory, "migrations", "gobarry", "receipts", receiptID)
}

func goBarryPendingPath(paths Paths) string {
	return filepath.Join(paths.StateDirectory, "migrations", "gobarry", "pending.json")
}

func newGoBarryReceiptID(now time.Time, source goBarrySource) string {
	digest := digestHex([]byte(source.preferencesDigest + "\n" + source.sessionDigest))
	if len(digest) > 12 {
		digest = digest[:12]
	}
	return now.UTC().Format("20060102T150405.000000000Z") + "-" + digest
}

func validGoBarryReceiptID(value string) bool {
	if len(value) < 16 || len(value) > 96 || filepath.Base(value) != value {
		return false
	}
	for _, character := range value {
		if !((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '.' || character == '-') {
			return false
		}
	}
	return true
}

func stageGoBarryReceiptBackups(
	directory, receiptID string,
	importedAt time.Time,
	source goBarrySource,
	config []byte,
	configExists bool,
	session []byte,
	sessionExists bool,
	ledger []byte,
	ledgerExists bool,
) (goBarryMigrationReceipt, error) {
	if !validGoBarryReceiptID(receiptID) {
		return goBarryMigrationReceipt{}, errors.New("invalid migration receipt id")
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return goBarryMigrationReceipt{}, fmt.Errorf("create migration receipt directory: %w", err)
	}
	receipt := goBarryMigrationReceipt{
		Version:           goBarryMigrationVersion,
		ReceiptID:         receiptID,
		ImportedAt:        importedAt,
		PreferencesSHA256: source.preferencesDigest,
		SessionSHA256:     source.sessionDigest,
	}
	var err error
	if receipt.TargetConfigBefore, err = stageReceiptBackup(directory, "transfers.before.json", config, configExists); err != nil {
		return receipt, err
	}
	if receipt.TargetSessionBefore, err = stageReceiptBackup(directory, "session.before.aria2", session, sessionExists); err != nil {
		return receipt, err
	}
	if receipt.TargetLedgerBefore, err = stageReceiptBackup(directory, "ledger.before.json", ledger, ledgerExists); err != nil {
		return receipt, err
	}
	return receipt, nil
}

func stageReceiptBackup(directory, name string, data []byte, exists bool) (goBarryReceiptFile, error) {
	record := goBarryReceiptFile{Exists: exists}
	if !exists {
		return record, nil
	}
	if filepath.Base(name) != name {
		return record, errors.New("invalid migration backup name")
	}
	record.SHA256 = digestHex(data)
	record.Backup = name
	if err := writeAtomicPrivate(filepath.Join(directory, name), data); err != nil {
		return record, fmt.Errorf("stage migration backup: %w", err)
	}
	return record, nil
}

func snapshotReceiptTarget(path string, maximum int64) (goBarryReceiptFile, error) {
	data, exists, err := readOptionalTarget(path, maximum)
	if err != nil {
		return goBarryReceiptFile{}, err
	}
	result := goBarryReceiptFile{Exists: exists}
	if exists {
		result.SHA256 = digestHex(data)
	}
	return result, nil
}

func saveGoBarryReceipt(directory string, receipt goBarryMigrationReceipt) error {
	data, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		return fmt.Errorf("encode GoBarryGo migration receipt: %w", err)
	}
	if err := writeAtomicPrivate(filepath.Join(directory, "receipt.json"), append(data, '\n')); err != nil {
		return fmt.Errorf("save GoBarryGo migration receipt: %w", err)
	}
	return nil
}

func loadGoBarryReceipt(directory, receiptID string) (goBarryMigrationReceipt, error) {
	data, found, err := readOptionalTarget(filepath.Join(directory, "receipt.json"), maxGoBarryPreferencesSize)
	if err != nil {
		return goBarryMigrationReceipt{}, err
	}
	if !found {
		return goBarryMigrationReceipt{}, errGoBarryReceiptNotFound
	}
	var receipt goBarryMigrationReceipt
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&receipt); err != nil {
		return receipt, fmt.Errorf("decode GoBarryGo migration receipt: %w", err)
	}
	if err := ensureGoBarryJSONEOF(decoder, "GoBarryGo migration receipt"); err != nil {
		return receipt, err
	}
	if receipt.Version != goBarryMigrationVersion || receipt.ReceiptID != receiptID {
		return receipt, errors.New("GoBarryGo migration receipt identity or version does not match")
	}
	return receipt, nil
}

func savePendingGoBarryMigration(paths Paths, operation string, receipt goBarryMigrationReceipt) error {
	if operation != goBarryPendingImport && operation != goBarryPendingRollback {
		return errors.New("invalid pending GoBarryGo migration operation")
	}
	journal := goBarryPendingJournal{
		Version:   goBarryMigrationVersion,
		Operation: operation,
		Receipt:   receipt,
	}
	data, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		return fmt.Errorf("encode pending GoBarryGo migration: %w", err)
	}
	if err := writeAtomicPrivate(goBarryPendingPath(paths), append(data, '\n')); err != nil {
		return fmt.Errorf("save pending GoBarryGo migration: %w", err)
	}
	return nil
}

func loadPendingGoBarryMigration(paths Paths) (goBarryPendingJournal, bool, error) {
	data, found, err := readOptionalTarget(goBarryPendingPath(paths), maxGoBarryPreferencesSize)
	if err != nil || !found {
		return goBarryPendingJournal{}, found, err
	}
	var journal goBarryPendingJournal
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&journal); err != nil {
		return journal, true, fmt.Errorf("decode pending GoBarryGo migration: %w", err)
	}
	if err := ensureGoBarryJSONEOF(decoder, "pending GoBarryGo migration"); err != nil {
		return journal, true, err
	}
	if journal.Version != goBarryMigrationVersion ||
		(journal.Operation != goBarryPendingImport && journal.Operation != goBarryPendingRollback) ||
		journal.Receipt.Version != goBarryMigrationVersion ||
		!validGoBarryReceiptID(journal.Receipt.ReceiptID) {
		return journal, true, errors.New("pending GoBarryGo migration identity, operation, or version does not match")
	}
	return journal, true, nil
}

func recoverPendingGoBarryMigration(paths Paths) (bool, error) {
	journal, found, err := loadPendingGoBarryMigration(paths)
	if err != nil || !found {
		return false, err
	}
	pending := journal.Receipt
	receiptDirectory := goBarryReceiptDirectory(paths, pending.ReceiptID)
	finalReceipt, finalErr := loadGoBarryReceipt(receiptDirectory, pending.ReceiptID)
	if journal.Operation == goBarryPendingImport && finalErr == nil {
		if finalReceipt != pending {
			return false, errors.New("completed GoBarryGo migration receipt does not match its pending journal")
		}
		if err := ensureGoBarryReceiptTargets(paths, pending, true); err != nil {
			return false, err
		}
		if err := removeGoBarryPending(paths); err != nil {
			return false, err
		}
		return true, nil
	}
	if journal.Operation == goBarryPendingImport && !errors.Is(finalErr, errGoBarryReceiptNotFound) {
		return false, finalErr
	}
	if journal.Operation == goBarryPendingRollback {
		if finalErr != nil {
			return false, fmt.Errorf("load receipt for pending GoBarryGo rollback: %w", finalErr)
		}
		if finalReceipt != pending {
			return false, errors.New("GoBarryGo rollback receipt does not match its pending journal")
		}
	}

	ledgerPath := goBarryLedgerPath(paths)
	for _, check := range []struct {
		path    string
		maximum int64
		before  goBarryReceiptFile
		after   goBarryReceiptFile
	}{
		{paths.ConfigFile, maxGoBarryPreferencesSize, pending.TargetConfigBefore, pending.TargetConfigAfter},
		{paths.SessionFile, maxGoBarrySessionSize, pending.TargetSessionBefore, pending.TargetSessionAfter},
		{ledgerPath, maxGoBarryPreferencesSize, pending.TargetLedgerBefore, pending.TargetLedgerAfter},
	} {
		actual, snapshotErr := snapshotReceiptTarget(check.path, check.maximum)
		if snapshotErr != nil {
			return false, snapshotErr
		}
		if !sameReceiptTarget(actual, check.before) && !sameReceiptTarget(actual, check.after) {
			return false, fmt.Errorf("%w: pending migration target no longer matches its before or planned state", ErrGoBarryRollbackConflict)
		}
	}
	originalConfig, err := receiptBackupBytes(receiptDirectory, pending.TargetConfigBefore, maxGoBarryPreferencesSize)
	if err != nil {
		return false, err
	}
	originalSession, err := receiptBackupBytes(receiptDirectory, pending.TargetSessionBefore, maxGoBarrySessionSize)
	if err != nil {
		return false, err
	}
	originalLedger, err := receiptBackupBytes(receiptDirectory, pending.TargetLedgerBefore, maxGoBarryPreferencesSize)
	if err != nil {
		return false, err
	}
	if err := restoreOptionalTarget(paths.ConfigFile, originalConfig, pending.TargetConfigBefore.Exists, 0o600); err != nil {
		return false, err
	}
	if err := restoreOptionalTarget(paths.SessionFile, originalSession, pending.TargetSessionBefore.Exists, 0o600); err != nil {
		return false, err
	}
	if err := restoreOptionalTarget(ledgerPath, originalLedger, pending.TargetLedgerBefore.Exists, 0o600); err != nil {
		return false, err
	}
	if err := ensureGoBarryReceiptTargets(paths, pending, false); err != nil {
		return false, fmt.Errorf("verify recovered GoBarryGo migration: %w", err)
	}
	if journal.Operation == goBarryPendingRollback {
		_, markerFound, err := loadGoBarryRollbackMarker(receiptDirectory, pending.ReceiptID)
		if err != nil {
			return false, fmt.Errorf("validate recovered GoBarryGo rollback marker: %w", err)
		}
		if !markerFound {
			if err := saveGoBarryRollbackMarker(receiptDirectory, goBarryRollbackMarker{
				Version:      goBarryMigrationVersion,
				ReceiptID:    pending.ReceiptID,
				RolledBackAt: time.Now().UTC(),
			}); err != nil {
				return false, fmt.Errorf("state was restored but rollback marker could not be saved: %w", err)
			}
		}
	}
	if err := removeGoBarryPending(paths); err != nil {
		return false, err
	}
	return true, nil
}

func saveGoBarryRollbackMarker(directory string, marker goBarryRollbackMarker) error {
	if marker.Version != goBarryMigrationVersion || !validGoBarryReceiptID(marker.ReceiptID) || marker.RolledBackAt.IsZero() {
		return errors.New("invalid GoBarryGo rollback marker")
	}
	data, err := json.MarshalIndent(marker, "", "  ")
	if err != nil {
		return fmt.Errorf("encode GoBarryGo rollback marker: %w", err)
	}
	if err := writeAtomicPrivate(filepath.Join(directory, "rolled-back.json"), append(data, '\n')); err != nil {
		return fmt.Errorf("save GoBarryGo rollback marker: %w", err)
	}
	return nil
}

func loadGoBarryRollbackMarker(directory, receiptID string) (goBarryRollbackMarker, bool, error) {
	data, found, err := readOptionalTarget(filepath.Join(directory, "rolled-back.json"), maxGoBarryPreferencesSize)
	if err != nil || !found {
		return goBarryRollbackMarker{}, found, err
	}
	var marker goBarryRollbackMarker
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&marker); err != nil {
		return marker, true, fmt.Errorf("decode GoBarryGo rollback marker: %w", err)
	}
	if err := ensureGoBarryJSONEOF(decoder, "GoBarryGo rollback marker"); err != nil {
		return marker, true, err
	}
	if marker.Version != goBarryMigrationVersion || marker.ReceiptID != receiptID || marker.RolledBackAt.IsZero() {
		return marker, true, errors.New("GoBarryGo rollback marker identity or version does not match")
	}
	return marker, true, nil
}

func ensureGoBarryReceiptTargets(paths Paths, receipt goBarryMigrationReceipt, after bool) error {
	ledgerPath := goBarryLedgerPath(paths)
	checks := []struct {
		path     string
		maximum  int64
		expected goBarryReceiptFile
	}{
		{paths.ConfigFile, maxGoBarryPreferencesSize, receipt.TargetConfigBefore},
		{paths.SessionFile, maxGoBarrySessionSize, receipt.TargetSessionBefore},
		{ledgerPath, maxGoBarryPreferencesSize, receipt.TargetLedgerBefore},
	}
	if after {
		checks[0].expected = receipt.TargetConfigAfter
		checks[1].expected = receipt.TargetSessionAfter
		checks[2].expected = receipt.TargetLedgerAfter
	}
	for _, check := range checks {
		if err := ensureGoBarryReceiptTarget(check.path, check.maximum, check.expected); err != nil {
			return err
		}
	}
	return nil
}

func ensureGoBarryReceiptTarget(path string, maximum int64, expected goBarryReceiptFile) error {
	actual, err := snapshotReceiptTarget(path, maximum)
	if err != nil {
		return err
	}
	if !sameReceiptTarget(actual, expected) {
		return ErrGoBarryRollbackConflict
	}
	return nil
}

func sameReceiptTarget(left, right goBarryReceiptFile) bool {
	return left.Exists == right.Exists && left.SHA256 == right.SHA256
}

func removeGoBarryPending(paths Paths) error {
	path := goBarryPendingPath(paths)
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("remove pending GoBarryGo migration: %w", err)
	}
	if err := syncDirectory(filepath.Dir(path)); err != nil {
		return fmt.Errorf("sync pending GoBarryGo migration removal: %w", err)
	}
	return nil
}

func ensureGoBarryJSONEOF(decoder *json.Decoder, label string) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return fmt.Errorf("%s must contain exactly one JSON value", label)
	}
	return nil
}

func (service *Service) acquireGoBarryMigrationLock(paths Paths) (Lock, error) {
	lease, err := service.locker.TryLock(paths.LockFile)
	if err != nil {
		if errors.Is(err, ErrLockHeld) {
			return nil, fmt.Errorf("%w: %w", ErrGoBarryImportActive, err)
		}
		return nil, fmt.Errorf("acquire GoBarryGo migration lock: %w", err)
	}
	if lease == nil {
		return nil, errors.New("acquire GoBarryGo migration lock: locker returned no lease")
	}
	return lease, nil
}

func receiptBackupBytes(directory string, record goBarryReceiptFile, maximum int64) ([]byte, error) {
	if !record.Exists {
		return nil, nil
	}
	if record.Backup == "" || filepath.Base(record.Backup) != record.Backup {
		return nil, errors.New("migration receipt backup name is invalid")
	}
	data, found, err := readOptionalTarget(filepath.Join(directory, record.Backup), maximum)
	if err != nil {
		return nil, err
	}
	if !found || digestHex(data) != record.SHA256 {
		return nil, errors.New("migration receipt backup is missing or does not match its hash")
	}
	return data, nil
}

func goBarrySourceUnchanged(paths GoBarryPaths, source goBarrySource) (bool, error) {
	current, err := readGoBarrySource(paths)
	if err != nil {
		return false, err
	}
	return current.preferencesFound == source.preferencesFound && current.sessionFound == source.sessionFound && current.preferencesDigest == source.preferencesDigest && current.sessionDigest == source.sessionDigest, nil
}

func regularTargetExists(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0
}

func digestHex(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func clampInt(value, minimum, maximum, fallback int) int {
	if value < minimum {
		return fallback
	}
	if value > maximum {
		return maximum
	}
	return value
}

func clampNote(original, mapped, maximum int) string {
	if original > maximum && mapped == maximum {
		return fmt.Sprintf("Clamped from %d to ProtoPeek's bounded maximum of %d.", original, maximum)
	}
	return ""
}
