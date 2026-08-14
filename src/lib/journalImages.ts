// Local-only image store for trade screenshots.
// Images are kept in the user's IndexedDB on this device. They never touch
// the network or our database - keeps storage costs at zero.

const DB_NAME = "trademind.journal";
const STORE = "images";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putTradeImage(tradeId: string, blob: Blob): Promise<void> {
  await withStore("readwrite", (s) => s.put(blob, tradeId));
}

export async function getTradeImage(tradeId: string): Promise<Blob | null> {
  try {
    const v = await withStore<Blob | undefined>("readonly", (s) => s.get(tradeId) as IDBRequest<Blob | undefined>);
    return v ?? null;
  } catch {
    return null;
  }
}

export async function deleteTradeImage(tradeId: string): Promise<void> {
  try { await withStore("readwrite", (s) => s.delete(tradeId)); } catch { /* ignore */ }
}

// Downscale a screenshot before storing so device storage stays lean.
export async function compressImageFile(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
  return blob ?? file;
}

// ---------------------------------------------------------------------------
// Multiple screenshots per trade.
// The first image keeps the bare trade id as its key so older single-image
// trades keep working; extras are stored under `<tradeId>#<n>`.
export function tradeImageKey(tradeId: string, index: number): string {
  return index <= 0 ? tradeId : `${tradeId}#${index}`;
}

export async function putTradeImages(tradeId: string, blobs: Blob[]): Promise<void> {
  for (let i = 0; i < blobs.length; i += 1) {
    const blob = blobs[i];
    if (blob) await putTradeImage(tradeImageKey(tradeId, i), blob);
  }
}

/** Read every stored screenshot for a trade, in order. */
export async function getTradeImages(tradeId: string, count: number): Promise<Blob[]> {
  const total = Math.max(1, count || 1);
  const out: Blob[] = [];
  for (let i = 0; i < total; i += 1) {
    const blob = await getTradeImage(tradeImageKey(tradeId, i));
    if (blob) out.push(blob);
  }
  return out;
}

/** Remove all screenshots for a trade (used on delete / replace-all). */
export async function deleteTradeImages(tradeId: string, count = 12): Promise<void> {
  for (let i = 0; i < Math.max(1, count); i += 1) {
    await deleteTradeImage(tradeImageKey(tradeId, i));
  }
}
