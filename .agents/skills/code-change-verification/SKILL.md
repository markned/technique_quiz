---
name: code-change-verification
description: Choose and execute relevant verification for Technique Quiz changes, reusing unchanged successful checks.
---

Read docs/QA.md. Run `npm run verify:quick -- --plan` to inspect change-based selection; use --base <ref> for branch comparisons. Quick covers relevant deterministic checks, Multiplayer adds multi-client browser coverage, Release includes full checks and local load. Use --fresh when environment changes invalidate receipts. Inspect actual results; a cached pass applies only to its unchanged fingerprint. Keep logs in .cache/qa; report failures and paths. UI changes need responsive browser evidence in addition to lint/build. Honor the active environment's browser-control restrictions; do not deploy as part of verification.
