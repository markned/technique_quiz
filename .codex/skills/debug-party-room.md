# Technique Quiz workflow

Use the discoverable project skills in `.agents/skills/` and [QA commands](../../docs/QA.md).

Use Node24 and PartyServer/Wrangler. Accelerated fixtures require `npm run party:test`; `party:dev` uses normal timing. Preserve local `.wrangler` state unless an isolated disposable test directory was explicitly selected. Never deploy or load-test production as part of debugging.
