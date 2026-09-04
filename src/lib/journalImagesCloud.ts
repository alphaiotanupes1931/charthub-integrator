// Cloud mirror for trade journal screenshots.
// Images used to live only in this device's IndexedDB, so a trade logged on a
// laptop showed no chart on the phone. Every screenshot is now also stored in a
// private bucket under `<userId>/<tradeId>/<index>.jpg` and pulled back on any
// other device when the local copy is missing.
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "journal-images";

async function userId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function objectPath(uid: string, tradeId: string, index: number): string {
  // Trade ids are generated locally, so keep the path free of separators.
  return `${uid}/${encodeURIComponent(tradeId)}/${index}.jpg`;
}

/** Mirror screenshots up. Failures are non-fatal: the local copy still works. */
export async function uploadTradeImages(tradeId: string, blobs: Blob[]): Promise<void> {
  const uid = await userId();
  if (!uid || !blobs.length) return;
  await Promise.all(
    blobs.map(async (blob, i) => {
      try {
        await supabase.storage
          .from(BUCKET)
          .upload(objectPath(uid, tradeId, i), blob, { upsert: true, contentType: blob.type || "image/jpeg" });
      } catch {
        /* offline or over quota: local copy stands in */
      }
    }),
  );
}

/** Pull the cloud copies of a trade's screenshots, in order. */
export async function downloadTradeImages(tradeId: string, count: number): Promise<Blob[]> {
  const uid = await userId();
  if (!uid) return [];
  const out: Blob[] = [];
  for (let i = 0; i < Math.max(1, count || 1); i += 1) {
    try {
      const { data } = await supabase.storage.from(BUCKET).download(objectPath(uid, tradeId, i));
      if (data) out.push(data);
      else break;
    } catch {
      break;
    }
  }
  return out;
}

/** Remove a trade's cloud screenshots when the trade is deleted. */
export async function removeTradeImages(tradeId: string, count = 12): Promise<void> {
  const uid = await userId();
  if (!uid) return;
  const paths = Array.from({ length: Math.max(1, count) }, (_, i) => objectPath(uid, tradeId, i));
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    /* ignore */
  }
}
