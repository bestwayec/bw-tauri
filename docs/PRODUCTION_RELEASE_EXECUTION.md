# Production release execution

| Milestone | Evidence |
| --- | --- |
| Remote baseline | Git returned main at `19e9ec9d13c343d059d55e55356dd89c6d3f8e31` and PR #37 at `d7c8a4aa2ec5fd4336137a062b0ea084390b80b9`. The PR page showed Draft. The public Latest redirect resolved to `v1.0.11`. Git returned an existing `v1.0.12` tag and no `v1.0.13` tag. |
| Exam integrity | IndexedDB read errors propagate to the speaking recovery and submission checks. The IELTS recorder blocks replacement while a take is pending. A Chromium regression exercises interrupted upload, reload, failed storage access, retry and server acknowledgement with the repository mock API. |
| Android | WebView navigation, hardware permissions and Google OAuth initiation now use parsed HTTPS origins. Kotlin JVM coverage includes authority, port and user-info cases. The release-mode APK assembled locally with no production signature. |
| Release coordination | The desktop workflow creates the draft once and calls the Android workflow with the same approved SHA. Stable publication depends on verified Android bytes, all desktop assets, the signed manifest and all three main-branch CI workflows. The previous stable updater key and installer-specific manifest aliases remain in use. |
| Network recovery | Saved a restricted cloud environment draft for the three denied domains. The current instance still needs the network settings applied and the release credentials verified. |
| Local Linux bundling | Debug Tauri builds produced an amd64 DEB and AppImage after using the workspace GTK module paths. Production Linux signing and install acceptance remain outstanding. |
| Release decision | GitHub API and the production auth endpoints returned proxy 403 responses. CI for the feature changes, production signing, real authentication and required platform acceptance are outstanding. No merge, version bump, tag or publication occurred. |
