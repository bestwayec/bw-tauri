# Bestway production release report

**RELEASE BLOCKED — ACTION REQUIRED**

PR #37 was publicly visible as Draft with remote head `d7c8a4aa2ec5fd4336137a062b0ea084390b80b9`. Remote main resolved to `19e9ec9d13c343d059d55e55356dd89c6d3f8e31`. The public Latest redirect and desktop updater manifest both identified `v1.0.11`. The authenticated Releases API was inaccessible. Local implementation head is `b0609f030f6ddc5afbef8b4b0b7967b5003e524b`. The feature commits are local. No merge commit, version commit, release tag or new public installer set was created. [PR #37](https://github.com/bestwayec/bw-tauri/pull/37) · [Existing Latest](https://github.com/bestwayec/bw-tauri/releases/latest)

The local feature changes prevent speaking finalization from treating unreadable storage as an empty recording queue, exercise upload recovery with IndexedDB and the mock API, and tighten Android WebView and OAuth origin checks. The release workflow uses one coordinator for draft creation and publication. It requires CI on the exact tagged main commit and coordinates desktop and Android builds from that SHA. The publish job validates Android artifact checksums, updater signatures and the draft source and asset checks before marking the draft Latest.

- [Execution ledger](PRODUCTION_RELEASE_EXECUTION.md)
- [Verification matrix](BESTWAY_RELEASE_TEST_MATRIX.md)
- [Platform compatibility](BESTWAY_PLATFORM_COMPATIBILITY.md)
- [Release blockers](BESTWAY_RELEASE_BLOCKERS.md)
