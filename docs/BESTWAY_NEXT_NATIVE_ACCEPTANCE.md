# BESTWAY NEXT native acceptance checklist

Use the commit shown on [desktop PR #38](https://github.com/bestwayec/bw-tauri/pull/38). Use a disposable Bestway backend with HTTPS and seeded teacher and student accounts. Record the commit, OS or emulator image, device model, RAM, WebView version, and test result for each case. Keep credentials, protected answers, and student identifiers out of evidence.

## Install and start

- Linux desktop. Run the development binary against the local Vite frontend and a disposable Django API. For packaged acceptance, set `VITE_API_URL` to an isolated HTTPS endpoint on port 443 with a certificate trusted by WebKitGTK. Run `npm run tauri -- build --debug --bundles deb --no-sign --ci --config src-tauri/tauri.manual-installer.conf.json`, then install the generated Debian package in a clean test environment. Use the official release configuration for release acceptance.
- Windows x64. Use the NSIS validation artifact from the PR workflow when it targets the acceptance environment. To build a test installer for a different API, set `VITE_API_URL` and `VITE_WEB_URL`, then run `npm ci` and `npm run tauri build -- --target x86_64-pc-windows-msvc --bundles nsis --config src-tauri/tauri.manual-installer.conf.json`.
- Android. With JDK 17 and Android SDK configured, start an emulator or attach a test device, check `adb devices`, run `gradle -p android :app:assembleDebug` from the repository root, and install the debug APK using `adb install -t android/app/build/outputs/apk/debug/app-debug.apk`. Launch with `adb shell am start -W -n uz.bestwayec.app/.MainActivity`. The current Android wrapper has fixed website and API endpoints. Keep the hosted smoke offline and use an approved acceptance configuration before running authenticated Android journeys. Use the PR Android job for unit and package evidence. Record touchscreen, device secure storage, and audio cases on supported hardware when release policy requires it.

## Run the same scenarios on each platform

| Case | Steps and expected result |
| --- | --- |
| Login and session recovery | Sign in manually, close and restart the app, and open classroom or learner work. Confirm the same session resumes. Repeat after access expiry while the refresh family remains valid. Revoke the family on the server, refocus the app outside an active exam, and confirm the old workspace disappears. |
| Secure storage and account isolation | Switch from a teacher to a student. Confirm the roster, exports, and authoring screens become inaccessible. Check the platform secure-store diagnostic for the expected provider and confirm the refresh token is absent from webview storage and logs. |
| Classroom | Create a disposable group, change its schedule, assign published exam and vocabulary work, and view grades and approved assessment feedback. Transfer the learner and archive the source group. Confirm archived history remains scoped. |
| Vocabulary authoring and practice | Publish a small set and assign it to the fixture class. On the learner account, study and restart the app, click Known while disconnected, reconnect with the study view open, and confirm saved state appears on another signed-in device. Complete a quiz and verify the saved score after collection editing. |
| Audio and keyboard | Play and replay a known audio fixture, test speech synthesis using an installed voice, mute before playback, and confirm that unmute restores playback. Use Tab, Shift+Tab and Enter to move through study and authoring controls. Verify focus moves to the next quiz prompt. |
| Exam recovery and update handling | Answer a question in a disposable exam, disconnect, restart, and resume the attempt. Verify the answer and timers reconcile. Exercise update availability, missing installer and cancel paths with a test feed and record the result outside an active exam. |
| Low-resource device | Repeat the restore, quiz and report scenarios on a representative low-memory device. Record startup duration, peak memory, responsiveness, and WebView errors. |

## Evidence boundary

The installed Linux Debian test package completed HTTPS login, an offline vocabulary edit, process restart with Secret Service restoration, and sync to Django. This flow also passed with the optimized unsigned installer used for acceptance. A previous Linux test exercised recorded-audio playback into a virtual PulseAudio sink. The Windows job installs and launches the NSIS test artifact on the hosted Windows runner and records startup and app working-set measurements. The Android job installs and launches the debug APK offline on an emulator. See the PR Checks page for the selected commit's outcome. Physical hardware, signed release artifacts, Windows and Android authenticated integration, and native exam recovery remain open.

[Desktop checks](https://github.com/bestwayec/bw-tauri/pull/38/checks)

[Cross-repository release gates](https://github.com/bestwayec/bestway/blob/feat/bestway-next-00-03/docs/BESTWAY_NEXT_RELEASE_GATES.md)

## Installed Linux HTTPS and offline progress

Build an installer with the same bundled frontend used by release packaging.

```sh
VITE_API_URL=https://fixture.example.test/v1 VITE_WEB_URL=https://fixture.example.test \
  npm run tauri build -- --bundles deb --config src-tauri/tauri.manual-installer.conf.json
sudo apt install ./src-tauri/target/release/bundle/deb/*.deb
bestway-app
```

Resolve the fixture hostname on the test machine and trust its CA in the operating system. Allow the installed WebView origin on the disposable Django server. Use a dedicated fixture account and verify login, the assigned classroom, a downloaded vocabulary collection, and a test audio recording. Record the installed package checksum and WebKitGTK version.

1. Download an issued vocabulary collection and verify that the app reports it ready for offline study.
2. Disable access to the test backend. Open the downloaded collection and mark a card as known. Verify that the mutation remains pending.
3. Exit the installed process completely. Start it again with the backend unreachable. Verify session restoration, the downloaded collection, and the pending change.
4. Reconnect and sync. Confirm one server revision increment, a zero pending count, and the expected card status on a second signed-in client.
5. Sign out, then sign in as another fixture account in the same OS profile. Verify that the first account's collection and pending changes are absent. A sign-out intentionally discards unsynced vocabulary progress.

The production frontend build rejects a cleartext API address. Use the loopback HTTP configuration for `npm run dev`. Keep credentials, recordings, real student data, and local CA keys out of packages and CI artifacts.

## Physical Windows and Android evidence

Use a disposable HTTPS backend and record the exact build commit. On each device repeat steps 1–5, play the test audio, resume an interrupted exam, and repeat process restart. On Windows, run the installed NSIS app under a standard OS account and record idle, study, and exam working-set measurements on a machine with roughly 4 GB RAM. Exercise the signed updater on a private acceptance channel. On Android, use the approved test backend configuration for authenticated cases, test secure storage after process kill, and repeat with device audio output. Record any unsupported case as UNVERIFIED.
