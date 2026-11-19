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

The installed Linux Debian test package completed HTTPS login, classroom and Studio navigation, process restart with the existing file fallback, and recorded-audio playback into a virtual PulseAudio sink. The Windows job installs and launches the NSIS test artifact on the hosted Windows runner and records startup and app working-set measurements. The Android runner attempts offline emulator install and launch using the debug APK. See the PR Checks page for the selected commit's outcome. Physical hardware, signed release artifacts, Windows and Android authenticated integration, and native exam recovery remain open.

[Desktop checks](https://github.com/bestwayec/bw-tauri/pull/38/checks)

[Cross-repository release gates](https://github.com/bestwayec/bestway/blob/feat/bestway-next-00-03/docs/BESTWAY_NEXT_RELEASE_GATES.md)
