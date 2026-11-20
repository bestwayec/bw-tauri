# BESTWAY NEXT Stage 05 desktop and Android handoff

[Desktop draft PR #38](https://github.com/bestwayec/bw-tauri/pull/38) · [Companion draft PR #206](https://github.com/bestwayec/bestway/pull/206)

The starting desktop commit was `b0443fd1b98f9f7fee28e8c4b508fea07ed13034`. The recovered Android Kotlin change was revisited before committing. It parses the actual Django exchange response and writes the website’s Secure, HttpOnly, SameSite=Lax cookies. It no longer writes access tokens to the API-domain cookie. Kotlin tests and an exchange from disposable Django/PostgreSQL exercised the contract. The hosted Android job also installs and launches the APK offline.

Stage 05 adds classroom search, direct classroom entry, roster search, workspace landmarks, actionable dashboard links, and controls that show vocabulary pending and selected states. Classroom previews render eight cards at a time and the enrolled roster renders 25 rows at a time. The teacher preview requests five compact rows and an authoritative total. The reduced-motion preference disables the route entrance transition. The exam runner and its recovery rules retain their existing behavior.

## Reproduce

1. Use this PR’s commit and the companion backend marked in the website report. Run `npm ci`, `npm run build` and `npm test`. See Checks for the Rust and browser recovery jobs and installed platform validation.
2. With staged teacher and student accounts, verify teacher classroom search and open a group that is not first. Confirm the classroom ID, roster and membership permissions. Find a learner by name, open their profile with the keyboard, and check Escape and focus restoration.
3. On the student dashboard, use the Vocabulary and Results shortcuts. Open assigned work, inspect the flashcard button focus and pressed state, and follow the installed Linux checklist to verify offline recovery and reconnect.
4. On Android set up the owner’s trusted staging configuration. The wrapper controls the website, API, permitted origin set and login URL in `MainActivity.kt`. Keep redirect URIs on their registered exact app callback and use HTTPS. Run login, refresh after access expiry, process death, logout and a second account, device audio and exam recovery on staged hardware. Inspect cookie flags without copying token values.
5. For Windows use the hosted NSIS validation artifact when it targets your acceptance environment. Repeat the owner checklist with a standard Windows profile, signed update fixture and representative 4 GB machine. Measure the app and WebView children through an active exam, then after logout.

The WebView vocabulary cache stores records in IndexedDB or LocalStorage. It has no application-level data-at-rest encryption. Use separate OS profiles for shared machines. Android and Windows authenticated device tests and sustained Windows memory are UNVERIFIED.

[Native acceptance checklist](BESTWAY_NEXT_NATIVE_ACCEPTANCE.md) · [Desktop checks](https://github.com/bestwayec/bw-tauri/pull/38/checks) · [Cross-repository review report](https://github.com/bestwayec/bestway/blob/feat/bestway-next-00-03/docs/BESTWAY_NEXT_STAGE05_FINAL_REPORT.md)
