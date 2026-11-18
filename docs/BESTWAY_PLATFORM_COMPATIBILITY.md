# Platform compatibility

| Target | Existing distribution path | Verified during this session |
| --- | --- | --- |
| Windows 10/11 x64 | Tauri NSIS and signed updater | Downloaded and verified the prior Windows updater against the repository key. Candidate launch, upgrade, kiosk exit and DPI remain unverified. |
| macOS Intel x64 | Tauri DMG and signed app archive | Candidate runtime, recording and notarization unverified. The existing workflow checks architecture, microphone metadata, audio entitlement and local code signing. |
| macOS Apple Silicon arm64 | Tauri DMG and signed app archive | Candidate runtime, recording and notarization unverified. |
| Linux x64 | Tauri AppImage and DEB, with signed updater entries for both | Local Rust tests, compile checks and amd64 debug DEB and AppImage packages. The local AppImage failed to launch because its WebKitGTK child executable was missing. The signed baseline AppImage contains the child executables, and the new hosted-build check requires both of them. |
| Android | APK, package `uz.bestwayec.app`, min API 24 and target API 34 | Unsigned local build contains no native ABI payload. Device coverage, installation over the previous production APK and store distribution remain unverified. |
| Windows ARM64, Linux ARM64 and iOS | No established release path in this repository | Unsupported by the validated matrix. |

The historical Windows performance report describes a debug host, three launch-to-window samples and one 4 GB hardware configuration. This session obtained no independent Windows release measurements, time-to-UI-ready samples or production speedup baseline. Chromium IndexedDB tests exercised correctness only. Physical microphone, camera, DPI, battery, low-memory and extended exam-session checks remain unrun.
