---
name: systematic-debugging
description: Reproduce and fix an evidenced Technique Quiz failure with focused regression verification.
---

Reproduce using the smallest existing fixture. Save only relevant state/phase, connection role, turn ID and failing assertion; exclude secrets/tokens. Form a root-cause hypothesis and test it before editing. Add a regression test when behavior/state risk warrants it, then make a minimal correction. Rerun the failure and related checks via docs/QA.md. Distinguish codec/autoplay limitations from state defects. Preserve failing diagnostics rather than disabling assertions. Report observed before/after behavior and remaining uncertainty.
