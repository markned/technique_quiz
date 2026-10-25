# Free-tier deployment

Use Workers Free, SQLite Durable Objects, and one private R2 Standard bucket. Do not upgrade Workers or enable public R2 domains, S3 clients, replication, lifecycle transitions to Infrequent Access, or other chargeable services for this deployment.

## Application limits

Every R2 get (including ranges and missing objects) and put passes through `server/freeTier.ts` in the single Community Durable Object:

| Resource | Application cap |
| --- | --- |
| Bytes reserved for all uploaded tracks | 1,000,000,000 bytes total |
| R2 puts | 1,000 per UTC day |
| R2 gets | 10,000 per UTC day |
| Individual upload | 25 MiB |

Counters commit transactionally **before** contacting R2. Concurrent requests cannot spend the same remaining allowance. Storage errors prevent R2 access. Failed operations, orphaned uploads and any future deletions do not refund bytes; this deliberately sacrifices capacity to avoid undercounting. Daily operation counters reset at UTC midnight; reserved storage never resets. Redeploys/restarts preserve the ledger. HTTP 429 with a user-facing explanation is returned when a cap is reached.

Even across 32 UTC dates, these caps allow at most 32,000 puts and 320,000 gets, well below R2 Standard's monthly free operations. The 1 GB total storage cap is also below its 10 GB-month allowance. Audio embedded in the static site does not use R2. The initial deployment creates an empty dedicated bucket; do not import preexisting objects without reconciling the ledger.

## What this protection covers

Workers Free and SQLite Durable Objects fail when their free quotas are exhausted rather than charging overages. R2 is a separate usage-based subscription: the application caps protect only operations through this code. There is **no account-wide billing guarantee** from application code. Other buckets/Workers, direct dashboard/S3 operations, public R2 domains, deleting/restoring the budget ledger independently from R2, account plan changes, and future Cloudflare pricing changes are outside this guard. Keep the bucket private, keep the ledger, and do not reuse it with another uploader. A dashboard budget alert is a notification, not a spending stop.

Verified source documentation (2026-10-25):

- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/

The `/health` endpoint advertises `freeTierGuard: r2-v1` and its caps. Pages publication checks this marker before publishing.
