// Intentionally far below R2's account-wide Standard free allowances.
// Daily UTC caps avoid assuming a particular monthly billing reset date.
export const FREE_TIER_LIMITS = Object.freeze({
  storedBytes: 1_000_000_000,
  writesPerDay: 1_000,
  readsPerDay: 10_000,
});
export const FREE_TIER_KEY = "free-tier-r2-v1";
type Usage = { day: string; writes: number; reads: number; reservedBytes: number };
type Ledger = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<unknown>;
};
export type BudgetStorage = {
  transaction<T>(callback: (tx: Ledger) => Promise<T>): Promise<T>;
};
export class FreeTierLimitError extends Error {
  readonly status = 429;
}
export async function reserveMediaBudget(
  storage: BudgetStorage,
  operation: "read" | "write",
  bytes = 0,
  now = Date.now(),
) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || (operation === "read" && bytes !== 0))
    throw new Error("Invalid media budget reservation");
  const day = new Date(now).toISOString().slice(0, 10);
  await storage.transaction(async (tx) => {
    const previous = await tx.get<Usage>(FREE_TIER_KEY);
    const usage: Usage = {
      day,
      writes: previous?.day === day ? previous.writes : 0,
      reads: previous?.day === day ? previous.reads : 0,
      reservedBytes: previous?.reservedBytes ?? 0,
    };
    if (operation === "read") {
      if (usage.reads >= FREE_TIER_LIMITS.readsPerDay)
        throw new FreeTierLimitError("На сегодня достигнут лимит прослушиваний. Попробуй завтра.");
      usage.reads++;
    } else {
      if (usage.writes >= FREE_TIER_LIMITS.writesPerDay)
        throw new FreeTierLimitError("На сегодня достигнут лимит загрузок. Попробуй завтра.");
      if (bytes > FREE_TIER_LIMITS.storedBytes - usage.reservedBytes)
        throw new FreeTierLimitError("Хранилище треков заполнено. Новые загрузки временно закрыты.");
      usage.writes++;
      usage.reservedBytes += bytes;
    }
    // Commit before R2 I/O. Failures/crashes consume their reservation; never refund
    // uncertain writes or orphaned objects, and never reset bytes at midnight.
    await tx.put(FREE_TIER_KEY, usage);
  });
}

export async function readBudgetedMedia(
  storage: BudgetStorage,
  bucket: Pick<R2Bucket, "get">,
  key: string,
  options: R2GetOptions,
) {
  await reserveMediaBudget(storage, "read");
  return bucket.get(key, options);
}

export async function writeBudgetedMedia(
  storage: BudgetStorage,
  bucket: Pick<R2Bucket, "put">,
  key: string,
  bytes: ArrayBuffer,
  contentType: string,
) {
  await reserveMediaBudget(storage, "write", bytes.byteLength);
  return bucket.put(key, bytes, { httpMetadata: { contentType }, storageClass: "Standard" });
}
