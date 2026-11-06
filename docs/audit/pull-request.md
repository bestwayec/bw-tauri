Legacy OAuth token callbacks bypassed state validation, plaintext token copies bypassed the native session owner, and overlapping refresh/autosave paths could revoke sessions or discard newer drafts. This change routes credentials through one owner, keeps refresh tokens out of native snapshots, validates all callback states, and preserves drafts until the server acknowledges the exact answer snapshot.

The exam runner now restores the owning student's unfinished session after restart, blocks finalization after failed saves, verifies upload/submission receipts, and respects camera opt-out. Native media paths are confined to the video cache, range allocations are bounded, downloads require TLS in production, and compatible TLS/updater security dependencies are patched. Separate browser and Windows installer validation workflows do not publish releases.

Validation:
- 394 Vitest tests, TypeScript check, and production build passed.
- 17 release-planning/signing configuration checks passed.
- 2 real Chromium tests passed, covering encrypted login persistence and writing recovery through an API outage, restart, retry, camera opt-out, and confirmed submission.
- Full Linux cargo check, clippy and 30 Rust tests passed in a disposable container with system WebKit dependencies.
- 77 selected Django backend contract tests passed against the unchanged backend checkout, including 4 checks using isolated PostgreSQL.
- npm audit: zero advisories; RustSec: zero vulnerability entries, with upstream GTK/glib unsoundness and maintenance warnings retained in the report.

Release gates remain: Windows CI artifact build, Windows install/uninstall/upgrade, real microphone/camera and native kiosk behavior, signed updater installation, and production connectivity. No production release or student data was changed. See docs/audit/production-audit.md and docs/audit/reviewed-files.txt for scope, evidence, limitations and remaining risks.
