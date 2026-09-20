/**
 * Read/write access to parakeet.js's IndexedDB cache.
 *
 * parakeet.js stores downloaded files under keys of the form
 *   hf-<repoId>-<revision>-<subfolder>-<filename>
 * in the `parakeet-cache-db` / `file-store` database. We open the same database
 * so the model manager can report per-model status and delete a single model
 * instead of wiping the whole cache.
 */
const DB_NAME = "parakeet-cache-db";
const STORE = "file-store";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
  });
}

async function cacheKeys() {
  try {
    const db = await openDb();
    if (!db) return [];
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], "readonly");
      const request = tx.objectStore(STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result.map((k) => String(k)));
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

function keysForRepo(keys, repoId) {
  const prefix = `hf-${repoId}-`;
  return keys.filter((k) => k.startsWith(prefix));
}

// A repo counts as cached once both the encoder and decoder graphs are stored.
export async function isParakeetRepoCached(repoId) {
  const keys = keysForRepo(await cacheKeys(), repoId);
  const hasEncoder = keys.some(
    (k) => k.includes("encoder-model") && k.endsWith(".onnx"),
  );
  const hasDecoder = keys.some(
    (k) => k.includes("decoder_joint-model") && k.endsWith(".onnx"),
  );
  return hasEncoder && hasDecoder;
}

export async function deleteParakeetRepo(repoId) {
  try {
    const db = await openDb();
    if (!db) return;
    const doomed = keysForRepo(await cacheKeys(), repoId);
    if (!doomed.length) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE], "readwrite");
      const store = tx.objectStore(STORE);
      doomed.forEach((key) => store.delete(key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
