package transfer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGoBarryPreviewMapsBoundedPreferencesWithoutWriting(t *testing.T) {
	root := t.TempDir()
	sourcePaths := GoBarryPaths{
		PreferencesFile: filepath.Join(root, "gobarrygo", "preferences.json"),
		SessionFile:     filepath.Join(root, "gobarrygo", "session.aria2"),
	}
	targetPaths := migrationTestPaths(filepath.Join(root, "protopeek"))
	writeMigrationFixture(t, sourcePaths.PreferencesFile, `{
  "aria2Binary": "",
  "downloadDirectory": "/tmp/gobarry-downloads",
  "maxConcurrentDownloads": 64,
  "split": 32,
  "maxConnectionsPerServer": 12,
  "minSplitSize": "2M",
  "fileAllocation": "prealloc",
  "continueDownloads": true,
  "alwaysResume": true,
  "autoRename": true,
  "userAgent": "GoBarryGo/0.0.9 (CHITRA)",
  "notifyOnCompletion": true,
  "notifyOnError": true
}`)
	writeMigrationFixture(t, sourcePaths.SessionFile, "https://example.com/archive.zip\n dir=/tmp/gobarry-downloads\n out=archive.zip\n")

	service := newMigrationTestService(t, targetPaths)
	preview, err := service.previewGoBarry(context.Background(), sourcePaths)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if !preview.Available || !preview.PreferencesFound || !preview.SessionFound || preview.SessionEntries != 1 {
		t.Fatalf("unexpected preview: %#v", preview)
	}
	if preview.ProposedConfig.MaxActiveJobs != 16 || preview.ProposedConfig.Split != 16 || preview.ProposedConfig.MaxConnectionsPerHost != 12 {
		t.Fatalf("bounded mapping mismatch: %#v", preview.ProposedConfig)
	}
	if preview.ProposedConfig.MinSplitSizeBytes != 2<<20 || preview.ProposedConfig.UserAgent != "ProtoPeek" {
		t.Fatalf("mapping mismatch: %#v", preview.ProposedConfig)
	}
	if len(preview.PreservedButUnsupported) != 1 || len(preview.Warnings) == 0 {
		t.Fatalf("expected explicit unsupported fields and branding warning: %#v", preview)
	}
	if _, err := os.Stat(targetPaths.ConfigFile); !os.IsNotExist(err) {
		t.Fatalf("preview wrote config: %v", err)
	}
	if _, err := os.Stat(targetPaths.SessionFile); !os.IsNotExist(err) {
		t.Fatalf("preview wrote session: %v", err)
	}
}

func TestGoBarryImportIsExplicitPreservingAndIdempotent(t *testing.T) {
	root := t.TempDir()
	sourcePaths := GoBarryPaths{
		PreferencesFile: filepath.Join(root, "gobarrygo", "preferences.json"),
		SessionFile:     filepath.Join(root, "gobarrygo", "session.aria2"),
	}
	targetPaths := migrationTestPaths(filepath.Join(root, "protopeek"))
	downloadDirectory := filepath.Join(root, "gobarry-downloads")
	preferences := `{
  "aria2Binary": "",
  "downloadDirectory": ` + fmt.Sprintf("%q", downloadDirectory) + `,
  "maxConcurrentDownloads": 4,
  "split": 8,
  "maxConnectionsPerServer": 8,
  "minSplitSize": "1M",
  "fileAllocation": "prealloc",
  "continueDownloads": true,
  "alwaysResume": true,
  "autoRename": true,
  "userAgent": "CustomFetcher/1.0",
  "notifyOnCompletion": true,
  "notifyOnError": true
}`
	session := "https://example.com/one.zip\n out=one.zip\n\nhttps://example.com/two.zip\n out=two.zip\n"
	writeMigrationFixture(t, sourcePaths.PreferencesFile, preferences)
	writeMigrationFixture(t, sourcePaths.SessionFile, session)
	writeMigrationFixture(t, targetPaths.SessionFile, "https://example.com/one.zip\n out=one.zip\n")
	originalPreferences := mustReadMigrationFile(t, sourcePaths.PreferencesFile)
	originalSession := mustReadMigrationFile(t, sourcePaths.SessionFile)

	service := newMigrationTestService(t, targetPaths)
	if _, err := service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{ImportPreferences: true, ImportSession: true}); err == nil {
		t.Fatal("import without preservation acknowledgement succeeded")
	}
	result, err := service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{
		ImportPreferences:          true,
		ImportSession:              true,
		AcknowledgeSourcePreserved: true,
	})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if !result.Imported || !result.PreferencesImported || !result.SessionImported || !result.SourcePreserved || result.SessionEntriesAdded != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.ReceiptID == "" {
		t.Fatal("import did not produce a rollback receipt")
	}
	if string(mustReadMigrationFile(t, sourcePaths.PreferencesFile)) != string(originalPreferences) || string(mustReadMigrationFile(t, sourcePaths.SessionFile)) != string(originalSession) {
		t.Fatal("source files changed")
	}
	config, exists, err := NewConfigStore(targetPaths.ConfigFile).Load()
	if err != nil || !exists {
		t.Fatalf("load imported config: exists=%v err=%v", exists, err)
	}
	if config.DownloadDirectory != downloadDirectory || config.UserAgent != "CustomFetcher/1.0" {
		t.Fatalf("imported config mismatch: %#v", config)
	}
	merged := string(mustReadMigrationFile(t, targetPaths.SessionFile))
	if strings.Count(merged, "https://example.com/one.zip") != 1 || strings.Count(merged, "https://example.com/two.zip") != 1 {
		t.Fatalf("session merge mismatch: %q", merged)
	}
	if strings.Count(merged, "pause=true") != 1 {
		t.Fatalf("new imported jobs must be paused without mutating existing jobs: %q", merged)
	}

	second, err := service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{
		ImportPreferences:          true,
		ImportSession:              true,
		AcknowledgeSourcePreserved: true,
	})
	if err != nil {
		t.Fatalf("repeat import: %v", err)
	}
	if !second.AlreadyImported || second.Imported {
		t.Fatalf("repeat import was not idempotent: %#v", second)
	}
	if after := string(mustReadMigrationFile(t, targetPaths.SessionFile)); after != merged {
		t.Fatal("repeat import changed session")
	}
	rolledBack, err := service.RollbackGoBarry(context.Background(), GoBarryRollbackRequest{
		ReceiptID:                    result.ReceiptID,
		AcknowledgeCurrentStateCheck: true,
	})
	if err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if !rolledBack.RolledBack || !rolledBack.SourcePreserved {
		t.Fatalf("rollback result: %#v", rolledBack)
	}
	if _, err := os.Stat(targetPaths.ConfigFile); !os.IsNotExist(err) {
		t.Fatalf("rollback did not restore absent config: %v", err)
	}
	if string(mustReadMigrationFile(t, targetPaths.SessionFile)) != "https://example.com/one.zip\n out=one.zip\n" {
		t.Fatalf("rollback did not restore original session: %q", mustReadMigrationFile(t, targetPaths.SessionFile))
	}
	if _, err := os.Stat(goBarryLedgerPath(targetPaths)); !os.IsNotExist(err) {
		t.Fatalf("rollback did not restore absent ledger: %v", err)
	}
	repeatedRollback, err := service.RollbackGoBarry(context.Background(), GoBarryRollbackRequest{
		ReceiptID:                    result.ReceiptID,
		AcknowledgeCurrentStateCheck: true,
	})
	if err != nil {
		t.Fatalf("repeat rollback: %v", err)
	}
	if !repeatedRollback.RolledBack || repeatedRollback.RolledBackAt == nil ||
		rolledBack.RolledBackAt == nil || !repeatedRollback.RolledBackAt.Equal(*rolledBack.RolledBackAt) {
		t.Fatalf("repeat rollback was not idempotent: first=%#v second=%#v", rolledBack, repeatedRollback)
	}
}

func TestGoBarryRollbackRefusesChangedTargetState(t *testing.T) {
	root := t.TempDir()
	sourcePaths := GoBarryPaths{
		PreferencesFile: filepath.Join(root, "gobarrygo", "preferences.json"),
		SessionFile:     filepath.Join(root, "gobarrygo", "session.aria2"),
	}
	targetPaths := migrationTestPaths(filepath.Join(root, "protopeek"))
	writeMigrationFixture(t, sourcePaths.PreferencesFile, `{
  "aria2Binary":"", "downloadDirectory":"/tmp", "maxConcurrentDownloads":4,
  "split":8, "maxConnectionsPerServer":8, "minSplitSize":"1M",
  "fileAllocation":"prealloc", "continueDownloads":true, "alwaysResume":true,
  "autoRename":true, "userAgent":"GoBarryGo/0.0.9 (CHITRA)",
  "notifyOnCompletion":true, "notifyOnError":true
}`)
	writeMigrationFixture(t, sourcePaths.SessionFile, "https://example.com/file.zip\n out=file.zip\n")
	service := newMigrationTestService(t, targetPaths)
	result, err := service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{
		ImportPreferences:          true,
		ImportSession:              true,
		AcknowledgeSourcePreserved: true,
	})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	writeMigrationFixture(t, targetPaths.SessionFile, "https://example.com/new-user-job.zip\n")
	_, err = service.RollbackGoBarry(context.Background(), GoBarryRollbackRequest{
		ReceiptID:                    result.ReceiptID,
		AcknowledgeCurrentStateCheck: true,
	})
	if !errors.Is(err, ErrGoBarryRollbackConflict) {
		t.Fatalf("rollback conflict error = %v", err)
	}
	if string(mustReadMigrationFile(t, targetPaths.SessionFile)) != "https://example.com/new-user-job.zip\n" {
		t.Fatal("conflicting rollback changed current user state")
	}
}

func TestGoBarryImportRejectsUnsafeOrActiveState(t *testing.T) {
	root := t.TempDir()
	sourcePaths := GoBarryPaths{
		PreferencesFile: filepath.Join(root, "gobarrygo", "preferences.json"),
		SessionFile:     filepath.Join(root, "gobarrygo", "session.aria2"),
	}
	targetPaths := migrationTestPaths(filepath.Join(root, "protopeek"))
	writeMigrationFixture(t, sourcePaths.PreferencesFile, `{
  "aria2Binary":"", "downloadDirectory":"/tmp", "maxConcurrentDownloads":4,
  "split":8, "maxConnectionsPerServer":8, "minSplitSize":"1M",
  "fileAllocation":"prealloc", "continueDownloads":true, "alwaysResume":true,
  "autoRename":true, "userAgent":"GoBarryGo/0.0.9 (CHITRA)",
  "notifyOnCompletion":true, "notifyOnError":true
}`)
	writeMigrationFixture(t, sourcePaths.SessionFile, "https://example.com/file\n on-download-complete=/tmp/run-me\n")
	service := newMigrationTestService(t, targetPaths)
	if _, err := service.previewGoBarry(context.Background(), sourcePaths); !errors.Is(err, ErrGoBarryUnsafeState) {
		t.Fatalf("unsafe session error = %v", err)
	}

	writeMigrationFixture(t, sourcePaths.SessionFile, "")
	service.mu.Lock()
	service.starting = true
	service.mu.Unlock()
	_, err := service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{
		ImportPreferences:          true,
		AcknowledgeSourcePreserved: true,
	})
	if !errors.Is(err, ErrGoBarryImportActive) {
		t.Fatalf("active import error = %v", err)
	}
}

func TestGoBarryMigrationUsesEngineFileLockForImportAndRollback(t *testing.T) {
	root := t.TempDir()
	sourcePaths := GoBarryPaths{
		PreferencesFile: filepath.Join(root, "gobarrygo", "preferences.json"),
		SessionFile:     filepath.Join(root, "gobarrygo", "session.aria2"),
	}
	targetPaths := migrationTestPaths(filepath.Join(root, "protopeek"))
	writeMigrationFixture(t, sourcePaths.SessionFile, "https://example.com/file.zip\n")
	service, err := NewServiceWithDependencies(DefaultHostConfig(), targetPaths, &fakeLauncher{}, FileLocker{})
	if err != nil {
		t.Fatal(err)
	}

	held, err := (FileLocker{}).TryLock(targetPaths.LockFile)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{
		ImportSession:              true,
		AcknowledgeSourcePreserved: true,
	})
	if !errors.Is(err, ErrGoBarryImportActive) || !errors.Is(err, ErrLockHeld) {
		t.Fatalf("locked import error = %v", err)
	}
	if _, statErr := os.Stat(targetPaths.SessionFile); !os.IsNotExist(statErr) {
		t.Fatalf("locked import changed target session: %v", statErr)
	}
	if err := held.Release(); err != nil {
		t.Fatal(err)
	}

	result, err := service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{
		ImportSession:              true,
		AcknowledgeSourcePreserved: true,
	})
	if err != nil {
		t.Fatalf("unlocked import: %v", err)
	}
	importedSession := append([]byte(nil), mustReadMigrationFile(t, targetPaths.SessionFile)...)
	held, err = (FileLocker{}).TryLock(targetPaths.LockFile)
	if err != nil {
		t.Fatalf("successful import did not release lock: %v", err)
	}
	_, err = service.RollbackGoBarry(context.Background(), GoBarryRollbackRequest{
		ReceiptID:                    result.ReceiptID,
		AcknowledgeCurrentStateCheck: true,
	})
	if !errors.Is(err, ErrGoBarryImportActive) || !errors.Is(err, ErrLockHeld) {
		t.Fatalf("locked rollback error = %v", err)
	}
	if got := mustReadMigrationFile(t, targetPaths.SessionFile); string(got) != string(importedSession) {
		t.Fatal("locked rollback changed target session")
	}
	if err := held.Release(); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RollbackGoBarry(context.Background(), GoBarryRollbackRequest{
		ReceiptID:                    result.ReceiptID,
		AcknowledgeCurrentStateCheck: true,
	}); err != nil {
		t.Fatalf("unlocked rollback: %v", err)
	}
}

func TestGoBarrySessionMergeEnforcesEffectiveAndHardEntryLimits(t *testing.T) {
	target := migrationSessionFixture("target", 1, 0)
	source := target + migrationSessionFixture("source", 1, 0) + migrationSessionFixture("source", 1, 0)
	merged, added, err := mergeAria2Sessions([]byte(target), []byte(source), 2)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := validateAria2Session(merged)
	if err != nil || entries != 2 || added != 1 {
		t.Fatalf("duplicate-aware exact-cap merge entries=%d added=%d err=%v", entries, added, err)
	}

	hardLimitTarget := migrationSessionFixture("hard", maxGoBarrySessionEntries, 0)
	if _, _, err := mergeAria2Sessions([]byte(hardLimitTarget), []byte(migrationSessionFixture("overflow", 1, 0)), maxGoBarrySessionEntries); err == nil {
		t.Fatal("combined session exceeding the 4096-entry hard cap succeeded")
	}

	root := t.TempDir()
	sourcePaths := GoBarryPaths{
		PreferencesFile: filepath.Join(root, "gobarrygo", "preferences.json"),
		SessionFile:     filepath.Join(root, "gobarrygo", "session.aria2"),
	}
	targetPaths := migrationTestPaths(filepath.Join(root, "protopeek"))
	originalTarget := migrationSessionFixture("existing", 2, 0)
	writeMigrationFixture(t, targetPaths.SessionFile, originalTarget)
	writeMigrationFixture(t, sourcePaths.SessionFile, migrationSessionFixture("new", 1, 0))
	service := newMigrationTestService(t, targetPaths)
	config := DefaultHostConfig()
	config.MaxActiveJobs = 1
	config.MaxQueuedJobs = 2
	config.MaxTrackedJobs = 3
	if err := service.Configure(config); err != nil {
		t.Fatal(err)
	}
	_, err = service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{
		ImportSession:              true,
		AcknowledgeSourcePreserved: true,
	})
	if err == nil || !strings.Contains(err.Error(), "configured limit is 2") {
		t.Fatalf("configured session bound error = %v", err)
	}
	if got := string(mustReadMigrationFile(t, targetPaths.SessionFile)); got != originalTarget {
		t.Fatal("entry-limit refusal changed the target session")
	}
	assertGoBarryImportCreatedNoState(t, targetPaths)
}

func TestGoBarrySessionMergeRefusesOversizedCombinedTargetAtomically(t *testing.T) {
	root := t.TempDir()
	sourcePaths := GoBarryPaths{
		PreferencesFile: filepath.Join(root, "gobarrygo", "preferences.json"),
		SessionFile:     filepath.Join(root, "gobarrygo", "session.aria2"),
	}
	targetPaths := migrationTestPaths(filepath.Join(root, "protopeek"))
	originalTarget := migrationSessionFixture("large-target", 130, 65000)
	source := migrationSessionFixture("large-source", 130, 65000)
	if len(originalTarget) >= int(maxGoBarrySessionSize) || len(source) >= int(maxGoBarrySessionSize) {
		t.Fatal("test fixture must remain valid as two individually bounded source files")
	}
	writeMigrationFixture(t, targetPaths.SessionFile, originalTarget)
	writeMigrationFixture(t, sourcePaths.SessionFile, source)
	service := newMigrationTestService(t, targetPaths)
	config := DefaultHostConfig()
	config.MaxQueuedJobs = maxGoBarrySessionEntries
	config.MaxTrackedJobs = maxGoBarrySessionEntries
	if err := service.Configure(config); err != nil {
		t.Fatal(err)
	}
	_, err := service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{
		ImportSession:              true,
		AcknowledgeSourcePreserved: true,
	})
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("combined byte bound error = %v", err)
	}
	if got := string(mustReadMigrationFile(t, targetPaths.SessionFile)); got != originalTarget {
		t.Fatal("byte-limit refusal changed the target session")
	}
	assertGoBarryImportCreatedNoState(t, targetPaths)
}

func TestGoBarryImportReloadsCanonicalDiskConfigUnderMigrationLock(t *testing.T) {
	root := t.TempDir()
	sourcePaths := GoBarryPaths{
		PreferencesFile: filepath.Join(root, "gobarrygo", "preferences.json"),
		SessionFile:     filepath.Join(root, "gobarrygo", "session.aria2"),
	}
	targetPaths := migrationTestPaths(filepath.Join(root, "protopeek"))
	service := newMigrationTestService(t, targetPaths)
	diskConfig := DefaultHostConfig()
	diskConfig.MaxActiveJobs = 1
	diskConfig.MaxQueuedJobs = 2
	diskConfig.MaxTrackedJobs = 3
	diskConfig.UserAgent = "CanonicalDiskConfig/1"
	if err := NewConfigStore(targetPaths.ConfigFile).Save(diskConfig); err != nil {
		t.Fatal(err)
	}
	originalTarget := migrationSessionFixture("existing", 2, 0)
	writeMigrationFixture(t, targetPaths.SessionFile, originalTarget)
	writeMigrationFixture(t, sourcePaths.SessionFile, migrationSessionFixture("new", 1, 0))
	_, err := service.importGoBarry(context.Background(), sourcePaths, GoBarryImportRequest{
		ImportSession:              true,
		AcknowledgeSourcePreserved: true,
	})
	if err == nil || !strings.Contains(err.Error(), "configured limit is 2") {
		t.Fatalf("canonical disk config bound error = %v", err)
	}
	service.mu.RLock()
	loadedInMemory := service.config
	service.mu.RUnlock()
	if loadedInMemory.MaxQueuedJobs != 2 || loadedInMemory.UserAgent != "CanonicalDiskConfig/1" {
		t.Fatalf("service did not reload canonical disk config: %#v", loadedInMemory)
	}
	if got := string(mustReadMigrationFile(t, targetPaths.SessionFile)); got != originalTarget {
		t.Fatal("canonical-config refusal changed target session")
	}
	assertGoBarryImportCreatedNoState(t, targetPaths)
}

func TestGoBarryPendingJournalRecoversAtomicCrashPoints(t *testing.T) {
	for _, phase := range []int{1, 2, 3} {
		t.Run(fmt.Sprintf("after-target-write-%d", phase), func(t *testing.T) {
			fixture := newPendingCrashFixture(t)
			if phase >= 1 {
				if err := writeAtomicPrivate(fixture.paths.ConfigFile, fixture.afterConfig); err != nil {
					t.Fatal(err)
				}
			}
			if phase >= 2 {
				if err := writeAtomicPrivate(fixture.paths.SessionFile, fixture.afterSession); err != nil {
					t.Fatal(err)
				}
			}
			if phase >= 3 {
				if err := writeAtomicPrivate(goBarryLedgerPath(fixture.paths), fixture.afterLedger); err != nil {
					t.Fatal(err)
				}
			}
			recovered, err := recoverPendingGoBarryMigration(fixture.paths)
			if err != nil || !recovered {
				t.Fatalf("recover pending migration: recovered=%v err=%v", recovered, err)
			}
			fixture.assertBefore(t)
			if _, err := os.Stat(goBarryPendingPath(fixture.paths)); !os.IsNotExist(err) {
				t.Fatalf("recovery left pending journal: %v", err)
			}
		})
	}
}

func TestGoBarryRollbackJournalRecoversAtomicCrashPoints(t *testing.T) {
	for _, phase := range []int{0, 1, 2, 3, 4} {
		t.Run(fmt.Sprintf("after-rollback-write-%d", phase), func(t *testing.T) {
			fixture := newPendingCrashFixture(t)
			receiptDirectory := goBarryReceiptDirectory(fixture.paths, fixture.receipt.ReceiptID)
			if err := writeAtomicPrivate(fixture.paths.ConfigFile, fixture.afterConfig); err != nil {
				t.Fatal(err)
			}
			if err := writeAtomicPrivate(fixture.paths.SessionFile, fixture.afterSession); err != nil {
				t.Fatal(err)
			}
			if err := writeAtomicPrivate(goBarryLedgerPath(fixture.paths), fixture.afterLedger); err != nil {
				t.Fatal(err)
			}
			if err := saveGoBarryReceipt(receiptDirectory, fixture.receipt); err != nil {
				t.Fatal(err)
			}
			if err := savePendingGoBarryMigration(fixture.paths, goBarryPendingRollback, fixture.receipt); err != nil {
				t.Fatal(err)
			}
			if phase >= 1 {
				if err := writeAtomicPrivate(fixture.paths.ConfigFile, fixture.beforeConfig); err != nil {
					t.Fatal(err)
				}
			}
			if phase >= 2 {
				if err := writeAtomicPrivate(fixture.paths.SessionFile, fixture.beforeSession); err != nil {
					t.Fatal(err)
				}
			}
			if phase >= 3 {
				if err := writeAtomicPrivate(goBarryLedgerPath(fixture.paths), fixture.beforeLedger); err != nil {
					t.Fatal(err)
				}
			}
			markerTime := time.Date(2026, 8, 24, 1, 2, 3, 0, time.UTC)
			if phase >= 4 {
				if err := saveGoBarryRollbackMarker(receiptDirectory, goBarryRollbackMarker{
					Version:      goBarryMigrationVersion,
					ReceiptID:    fixture.receipt.ReceiptID,
					RolledBackAt: markerTime,
				}); err != nil {
					t.Fatal(err)
				}
			}

			recovered, err := recoverPendingGoBarryMigration(fixture.paths)
			if err != nil || !recovered {
				t.Fatalf("recover pending rollback: recovered=%v err=%v", recovered, err)
			}
			fixture.assertBefore(t)
			marker, found, err := loadGoBarryRollbackMarker(receiptDirectory, fixture.receipt.ReceiptID)
			if err != nil || !found {
				t.Fatalf("load recovered rollback marker: found=%v err=%v", found, err)
			}
			if phase >= 4 && !marker.RolledBackAt.Equal(markerTime) {
				t.Fatalf("recovery replaced an already durable rollback marker: %#v", marker)
			}
			if _, err := os.Stat(goBarryPendingPath(fixture.paths)); !os.IsNotExist(err) {
				t.Fatalf("rollback recovery left pending journal: %v", err)
			}
		})
	}
}

func TestGoBarryPendingJournalRefusesUnknownTargetAndFinalizesCommittedReceipt(t *testing.T) {
	t.Run("unknown target", func(t *testing.T) {
		fixture := newPendingCrashFixture(t)
		manualConfig := []byte("{\"manual\":true}\n")
		if err := writeAtomicPrivate(fixture.paths.ConfigFile, manualConfig); err != nil {
			t.Fatal(err)
		}
		if _, err := recoverPendingGoBarryMigration(fixture.paths); !errors.Is(err, ErrGoBarryRollbackConflict) {
			t.Fatalf("unknown target recovery error = %v", err)
		}
		if got := mustReadMigrationFile(t, fixture.paths.ConfigFile); string(got) != string(manualConfig) {
			t.Fatal("conflicted recovery overwrote unknown current state")
		}
		if _, err := os.Stat(goBarryPendingPath(fixture.paths)); err != nil {
			t.Fatalf("conflicted recovery removed its pending evidence: %v", err)
		}
	})

	t.Run("completed receipt", func(t *testing.T) {
		fixture := newPendingCrashFixture(t)
		if err := writeAtomicPrivate(fixture.paths.ConfigFile, fixture.afterConfig); err != nil {
			t.Fatal(err)
		}
		if err := writeAtomicPrivate(fixture.paths.SessionFile, fixture.afterSession); err != nil {
			t.Fatal(err)
		}
		if err := writeAtomicPrivate(goBarryLedgerPath(fixture.paths), fixture.afterLedger); err != nil {
			t.Fatal(err)
		}
		if err := saveGoBarryReceipt(goBarryReceiptDirectory(fixture.paths, fixture.receipt.ReceiptID), fixture.receipt); err != nil {
			t.Fatal(err)
		}
		recovered, err := recoverPendingGoBarryMigration(fixture.paths)
		if err != nil || !recovered {
			t.Fatalf("finalize committed receipt: recovered=%v err=%v", recovered, err)
		}
		fixture.assertAfter(t)
		if _, err := os.Stat(goBarryPendingPath(fixture.paths)); !os.IsNotExist(err) {
			t.Fatalf("committed receipt left pending journal: %v", err)
		}
	})
}

func TestGoBarryLedgerAndReceiptRejectTrailingJSON(t *testing.T) {
	root := t.TempDir()
	ledgerPath := filepath.Join(root, "gobarry-import.json")
	ledgerBytes, err := json.Marshal(goBarryImportLedger{Version: goBarryMigrationVersion})
	if err != nil {
		t.Fatal(err)
	}
	writeMigrationFixture(t, ledgerPath, string(append(append(ledgerBytes, '\n'), []byte("{}\n")...)))
	if _, found, err := loadGoBarryLedger(ledgerPath); !found || err == nil {
		t.Fatalf("ledger with trailing JSON found=%v err=%v", found, err)
	}
	writeMigrationFixture(t, ledgerPath, string(append(ledgerBytes, []byte(" \n\t")...)))
	if _, found, err := loadGoBarryLedger(ledgerPath); !found || err != nil {
		t.Fatalf("ledger with trailing whitespace found=%v err=%v", found, err)
	}

	receiptID := "20260823T000000.000000000Z-abcdef012345"
	receiptDirectory := filepath.Join(root, "receipt")
	receiptBytes, err := json.Marshal(goBarryMigrationReceipt{
		Version:   goBarryMigrationVersion,
		ReceiptID: receiptID,
	})
	if err != nil {
		t.Fatal(err)
	}
	writeMigrationFixture(t, filepath.Join(receiptDirectory, "receipt.json"), string(append(append(receiptBytes, '\n'), []byte("{}\n")...)))
	if _, err := loadGoBarryReceipt(receiptDirectory, receiptID); err == nil {
		t.Fatal("receipt with trailing JSON was accepted")
	}
	writeMigrationFixture(t, filepath.Join(receiptDirectory, "receipt.json"), string(append(receiptBytes, []byte(" \n\t")...)))
	if _, err := loadGoBarryReceipt(receiptDirectory, receiptID); err != nil {
		t.Fatalf("receipt with trailing whitespace: %v", err)
	}
}

func TestGoBarrySourceBoundsAndStrictSchema(t *testing.T) {
	root := t.TempDir()
	sourcePaths := GoBarryPaths{
		PreferencesFile: filepath.Join(root, "preferences.json"),
		SessionFile:     filepath.Join(root, "session.aria2"),
	}
	writeMigrationFixture(t, sourcePaths.PreferencesFile, `{"futureField":true}`)
	if _, err := readGoBarrySource(sourcePaths); !errors.Is(err, ErrGoBarryUnsafeState) {
		t.Fatalf("future schema error = %v", err)
	}
	if err := os.Remove(sourcePaths.PreferencesFile); err != nil {
		t.Fatal(err)
	}
	writeMigrationFixture(t, sourcePaths.SessionFile, strings.Repeat("x", int(maxGoBarrySessionSize)+1))
	if _, err := readGoBarrySource(sourcePaths); !errors.Is(err, ErrGoBarryUnsafeState) {
		t.Fatalf("oversized source error = %v", err)
	}
}

func TestGoBarryMigrationRejectsSourceAndTargetSymlinks(t *testing.T) {
	root := t.TempDir()
	realSource := filepath.Join(root, "real-preferences.json")
	writeMigrationFixture(t, realSource, `{}`)
	linkedSource := filepath.Join(root, "preferences.json")
	if err := os.Symlink(realSource, linkedSource); err != nil {
		t.Skipf("create source symlink: %v", err)
	}
	_, _, err := readRegularSource(linkedSource, maxGoBarryPreferencesSize)
	if !errors.Is(err, ErrGoBarryUnsafeState) {
		t.Fatalf("source symlink error = %v", err)
	}

	realTarget := filepath.Join(root, "real-target.json")
	writeMigrationFixture(t, realTarget, `{}`)
	linkedTarget := filepath.Join(root, "target.json")
	if err := os.Symlink(realTarget, linkedTarget); err != nil {
		t.Skipf("create target symlink: %v", err)
	}
	if _, _, err := readOptionalTarget(linkedTarget, maxGoBarryPreferencesSize); err == nil {
		t.Fatal("migration target symlink was accepted")
	}
}

func TestParseAria2Size(t *testing.T) {
	for input, expected := range map[string]int64{"1M": 1 << 20, "2MiB": 2 << 20, "1024K": 1 << 20, "4096": 4096} {
		actual, err := parseAria2Size(input)
		if err != nil || actual != expected {
			t.Fatalf("parseAria2Size(%q) = %d, %v; want %d", input, actual, err, expected)
		}
	}
	if _, err := parseAria2Size("many"); err == nil {
		t.Fatal("invalid size succeeded")
	}
}

func newMigrationTestService(t *testing.T, paths Paths) *Service {
	t.Helper()
	service, err := NewServiceWithDependencies(DefaultHostConfig(), paths, &fakeLauncher{}, &fakeLocker{lease: &fakeLease{}})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return service
}

func migrationTestPaths(root string) Paths {
	state := filepath.Join(root, "transfers")
	return Paths{
		ConfigFile:       filepath.Join(root, "transfers.json"),
		StateDirectory:   state,
		SessionFile:      filepath.Join(state, "session.aria2"),
		VerificationFile: filepath.Join(state, "verification.json"),
		LockFile:         filepath.Join(state, "engine.lock"),
	}
}

func writeMigrationFixture(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}

func mustReadMigrationFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func migrationSessionFixture(prefix string, count, optionPayloadBytes int) string {
	var builder strings.Builder
	payload := strings.Repeat("x", optionPayloadBytes)
	for index := 0; index < count; index++ {
		_, _ = fmt.Fprintf(&builder, "https://example.com/%s-%04d.bin\n", prefix, index)
		if optionPayloadBytes > 0 {
			_, _ = fmt.Fprintf(&builder, " header=X-Large: %s\n", payload)
		}
	}
	return builder.String()
}

func assertGoBarryImportCreatedNoState(t *testing.T, paths Paths) {
	t.Helper()
	if _, err := os.Stat(goBarryLedgerPath(paths)); !os.IsNotExist(err) {
		t.Fatalf("refused import created ledger: %v", err)
	}
	if _, err := os.Stat(filepath.Join(paths.StateDirectory, "migrations")); !os.IsNotExist(err) {
		t.Fatalf("refused import created receipt state: %v", err)
	}
}

type pendingCrashFixture struct {
	paths         Paths
	receipt       goBarryMigrationReceipt
	beforeConfig  []byte
	beforeSession []byte
	beforeLedger  []byte
	afterConfig   []byte
	afterSession  []byte
	afterLedger   []byte
}

func newPendingCrashFixture(t *testing.T) pendingCrashFixture {
	t.Helper()
	paths := migrationTestPaths(filepath.Join(t.TempDir(), "protopeek"))
	fixture := pendingCrashFixture{
		paths:         paths,
		beforeConfig:  []byte("{\"version\":1,\"state\":\"before\"}\n"),
		beforeSession: []byte("https://example.com/before.bin\n"),
		beforeLedger:  []byte("{\"version\":1,\"state\":\"before\"}\n"),
		afterConfig:   []byte("{\"version\":1,\"state\":\"after\"}\n"),
		afterSession:  []byte("https://example.com/after.bin\n pause=true\n"),
		afterLedger:   []byte("{\"version\":1,\"state\":\"after\"}\n"),
	}
	writeMigrationFixture(t, paths.ConfigFile, string(fixture.beforeConfig))
	writeMigrationFixture(t, paths.SessionFile, string(fixture.beforeSession))
	writeMigrationFixture(t, goBarryLedgerPath(paths), string(fixture.beforeLedger))
	receiptID := "20260824T000000.000000000Z-abcdef012345"
	receiptDirectory := goBarryReceiptDirectory(paths, receiptID)
	receipt, err := stageGoBarryReceiptBackups(
		receiptDirectory,
		receiptID,
		time.Date(2026, 8, 24, 0, 0, 0, 0, time.UTC),
		goBarrySource{preferencesDigest: strings.Repeat("a", 64), sessionDigest: strings.Repeat("b", 64)},
		fixture.beforeConfig,
		true,
		fixture.beforeSession,
		true,
		fixture.beforeLedger,
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	receipt.TargetConfigAfter = plannedReceiptTarget(fixture.afterConfig, true)
	receipt.TargetSessionAfter = plannedReceiptTarget(fixture.afterSession, true)
	receipt.TargetLedgerAfter = plannedReceiptTarget(fixture.afterLedger, true)
	if err := savePendingGoBarryMigration(paths, goBarryPendingImport, receipt); err != nil {
		t.Fatal(err)
	}
	fixture.receipt = receipt
	return fixture
}

func (fixture pendingCrashFixture) assertBefore(t *testing.T) {
	t.Helper()
	for path, expected := range map[string][]byte{
		fixture.paths.ConfigFile:         fixture.beforeConfig,
		fixture.paths.SessionFile:        fixture.beforeSession,
		goBarryLedgerPath(fixture.paths): fixture.beforeLedger,
	} {
		if got := mustReadMigrationFile(t, path); string(got) != string(expected) {
			t.Fatalf("recovered %s = %q, want %q", path, got, expected)
		}
	}
}

func (fixture pendingCrashFixture) assertAfter(t *testing.T) {
	t.Helper()
	for path, expected := range map[string][]byte{
		fixture.paths.ConfigFile:         fixture.afterConfig,
		fixture.paths.SessionFile:        fixture.afterSession,
		goBarryLedgerPath(fixture.paths): fixture.afterLedger,
	} {
		if got := mustReadMigrationFile(t, path); string(got) != string(expected) {
			t.Fatalf("committed %s = %q, want %q", path, got, expected)
		}
	}
}

func TestGoBarryLedgerJSONDoesNotContainSourcePaths(t *testing.T) {
	ledger := goBarryImportLedger{Version: goBarryMigrationVersion, PreferencesSHA256: strings.Repeat("a", 64)}
	data, err := json.Marshal(ledger)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "gobarrygo") || strings.Contains(string(data), "/home/") {
		t.Fatalf("ledger leaks source path: %s", data)
	}
}
