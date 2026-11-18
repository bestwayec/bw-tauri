# Release test matrix

| Surface | Result | Evidence and scope |
| --- | --- | --- |
| Frontend install, TypeScript and Vite | Passed locally | Frozen npm install, TypeScript compilation and Vite production build on the feature checkout |
| Frontend unit tests | Passed locally | 450 tests in 54 Vitest files |
| Browser integration | Passed locally | 3 Playwright tests with Chromium and the repository mock API. Covers login and restore, writing draft recovery and submission, and speaking upload recovery and acknowledgement using real browser IndexedDB and synthetic audio. |
| Rust | Passed locally | `cargo check --locked`, 33 Rust tests, and Clippy with `-D warnings` |
| Android JVM | Passed locally | 9 Kotlin tests, including OAuth state and callback helper coverage and new origin validation |
| Android packaging | Passed locally | Gradle 8.6, Temurin 17 and SDK 34 built the unsigned release APK. Package `uz.bestwayec.app`, version `1.0.12`, code 10120, min SDK 24, target SDK 34. |
| Release tooling | Passed locally | 44 Node tests, including the coordinator against a mock GitHub server and the missing-APK case. `actionlint` passed. |
| Android production signature and install | Unverified | Local artifact is unsigned. No device or emulator acceptance. The older public APK on `v1.0.10` passed certificate verification and has embedded version `1.0.6`, code 1060. |
| Production Google OAuth | Blocked | Production web and API hosts returned proxy 403. JVM tests and simulated OAuth checks cover local behavior. |
| Windows production NSIS, upgrade and WebView2 | Unrun | Required final-SHA Windows Actions and Windows device evidence unavailable. |
| macOS Intel and Apple Silicon | Unrun | No candidate DMGs, launch, microphone hardware, Developer ID signing or notarization verified. |
| Linux x64 local packaging | Debug packages passed | Tauri generated an amd64 DEB and an x86-64 AppImage for 1.0.12. Package metadata and SHA-256 checksums were inspected. |
| Linux x64 local AppImage launch | Failed | Xvfb launch reached the Tauri process, then failed because the cloud-built AppImage lacked `WebKitNetworkProcess`. The published baseline image contains the WebKit helpers. |
| Linux x64 production AppImage and DEB | Unrun | A new hosted-runner check requires amd64 metadata, the DEB WebKit dependency and the AppImage WebKit executables. No signed production Linux artifact was built from a candidate SHA. |
| Published baseline updater | Passed | The public Latest endpoint returned `1.0.11`. Downloaded all five unique updater artifacts and verified their minisign signatures with the key in Tauri configuration. |
| Candidate updater and GitHub Latest | Unrun | No candidate tag, published artifact or manifest. |
