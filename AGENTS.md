# Technique Quiz development

Use Node24 (.nvmrc); package minimum is22.14. Inspect changed code and direct dependencies before editing. Project skills live in .agents/skills; command policy is in docs/QA.md.

Use focused searches and deterministic checks before broad analysis. Run Quick during development, Multiplayer for protocol/reconnect/UI changes and Release before declaring a release ready. Reuse successful checks only for unchanged code/environment; save detailed logs/traces as artifacts and show concise failures. Review changed files by default. Avoid agents for trivial work and overlapping tools.

Use the active session's authorized browser tools for interactive investigation. Existing Playwright Test remains the repeatable E2E suite; do not bypass browser restrictions with another controller.

No production deployment, main push, production load, production secrets/data/media changes, paid services or reduced security unless explicitly authorized for that action. Load defaults to loopback and test-mode fixtures. Preserve R2 quotas. Never disable failing tests to pass CI or claim checks that were not executed.
