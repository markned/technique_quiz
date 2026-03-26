import type { Round } from "../types";

const DB_NAME = "technique_quiz_preview_v1";
const STORE = "preview";
const KEY = "round";

let dbOpenPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbOpenPromise) {
    dbOpenPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onerror = () => {
        dbOpenPromise = null;
        reject(req.error ?? new Error("indexedDB.open failed"));
      };
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }
  return dbOpenPromise;
}

export function idbPutPreviewRound(round: Round): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("idb write"));
        tx.objectStore(STORE).put(round, KEY);
      }),
  );
}

export function idbGetPreviewRound(): Promise<Round | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains(STORE)) {
          resolve(null);
          return;
        }
        const tx = db.transaction(STORE, "readonly");
        const r = tx.objectStore(STORE).get(KEY);
        r.onerror = () => reject(r.error ?? new Error("idb read"));
        r.onsuccess = () => resolve((r.result as Round | undefined) ?? null);
      }),
  );
}

export function idbDeletePreviewRound(): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains(STORE)) {
          resolve();
          return;
        }
        const tx = db.transaction(STORE, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("idb delete"));
        tx.objectStore(STORE).delete(KEY);
      }),
  );
}
