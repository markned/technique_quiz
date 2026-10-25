import { describe, expect, it, vi } from "vitest";
import {
  FREE_TIER_KEY,
  FREE_TIER_LIMITS,
  reserveMediaBudget,
  readBudgetedMedia,
  writeBudgetedMedia,
  type BudgetStorage,
} from "../server/freeTier";

function ledger() {
  const records = new Map<string, unknown>();
  let pending = Promise.resolve();
  const storage: BudgetStorage = {
    transaction(callback) {
      const result = pending.then(async () => {
        const staged = new Map(records);
        const result = await callback({
          get: async <T>(key: string) => structuredClone(staged.get(key)) as T | undefined,
          put: async (key, value) => {
            staged.set(key, structuredClone(value));
          },
        });
        records.clear();
        for (const [key, value] of staged) records.set(key, value);
        return result;
      });
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  return { records, storage };
}
const today = Date.UTC(2026, 9, 25, 23, 59);

describe("persistent R2 free-tier guard", () => {
  it("serializes concurrent reservations at the storage boundary", async () => {
    const { records, storage } = ledger();
    records.set(FREE_TIER_KEY, {
      day: "2026-10-25",
      reads: FREE_TIER_LIMITS.readsPerDay - 1,
      writes: 0,
      reservedBytes: 0,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveMediaBudget(storage, "read", 0, today)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(9);
  });
  it("resets daily operations at UTC midnight but never the storage reservation", async () => {
    const { records, storage } = ledger();
    records.set(FREE_TIER_KEY, {
      day: "2026-10-25",
      reads: FREE_TIER_LIMITS.readsPerDay,
      writes: FREE_TIER_LIMITS.writesPerDay,
      reservedBytes: FREE_TIER_LIMITS.storedBytes,
    });
    await expect(reserveMediaBudget(storage, "read", 0, today)).rejects.toMatchObject({ status: 429 });
    await reserveMediaBudget(storage, "read", 0, today + 120_000);
    await expect(reserveMediaBudget(storage, "write", 1, today + 120_000)).rejects.toMatchObject({
      status: 429,
    });
    expect(records.get(FREE_TIER_KEY)).toMatchObject({
      reads: 1,
      reservedBytes: FREE_TIER_LIMITS.storedBytes,
    });
  });
  it("blocks reads and writes before touching R2, including range reads", async () => {
    const { records, storage } = ledger();
    records.set(FREE_TIER_KEY, {
      day: new Date().toISOString().slice(0, 10),
      reads: FREE_TIER_LIMITS.readsPerDay,
      writes: FREE_TIER_LIMITS.writesPerDay,
      reservedBytes: 0,
    });
    const get = vi.fn();
    const put = vi.fn();
    await expect(
      readBudgetedMedia(storage, { get }, "track", { range: { offset: 0, length: 10 } }),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      writeBudgetedMedia(storage, { put }, "track", new ArrayBuffer(10), "audio/mpeg"),
    ).rejects.toMatchObject({ status: 429 });
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
  it("reserves bytes before upload and keeps failed uploads charged across instances", async () => {
    const { records, storage } = ledger();
    records.set(FREE_TIER_KEY, {
      day: "old",
      reads: 0,
      writes: 0,
      reservedBytes: FREE_TIER_LIMITS.storedBytes - 10,
    });
    const put = vi.fn(async () => {
      throw new Error("R2 unavailable");
    });
    await expect(
      writeBudgetedMedia(storage, { put }, "track", new ArrayBuffer(10), "audio/mpeg"),
    ).rejects.toThrow("R2 unavailable");
    await expect(
      writeBudgetedMedia(storage, { put }, "other", new ArrayBuffer(1), "audio/mpeg"),
    ).rejects.toMatchObject({ status: 429 });
    expect(put).toHaveBeenCalledTimes(1);
    expect(records.get(FREE_TIER_KEY)).toMatchObject({
      reservedBytes: FREE_TIER_LIMITS.storedBytes,
      writes: 1,
    });
  });
  it("fails closed when the reservation cannot be persisted", async () => {
    const storage = {
      transaction: async () => {
        throw new Error("storage failed");
      },
    };
    const get = vi.fn();
    const put = vi.fn();
    await expect(readBudgetedMedia(storage, { get }, "track", {})).rejects.toThrow("storage failed");
    await expect(
      writeBudgetedMedia(storage, { put }, "track", new ArrayBuffer(1), "audio/mpeg"),
    ).rejects.toThrow("storage failed");
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects invalid reservations", async () => {
    const { storage } = ledger();
    for (const n of [-1, NaN, Infinity, 0.5])
      await expect(reserveMediaBudget(storage, "write", n)).rejects.toThrow();
  });
});
