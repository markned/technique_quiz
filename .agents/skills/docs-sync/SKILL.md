---
name: docs-sync
description: Align Technique Quiz runbooks and skill instructions with implemented protocol and tooling.
---

Compare changed implementation with README.md, docs/QA.md, .codex and AGENTS.md. Verify Node engine/.nvmrc, npm scripts, message union, phases, environment variables and test fixture gates from source. Update only affected instructions; preserve local/production boundaries and free-tier guards. PartyServer/Wrangler replaces legacy PartyKit instructions. Fast fixtures need party:test, never production. Keep commands in docs/QA.md instead of duplicating runbooks. Validate referenced files/commands; do not claim a check ran unless it did.
