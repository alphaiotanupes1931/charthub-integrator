// Downscale + JPEG-compress an image File so it fits comfortably inside the
// chat request body cap. Preserves aspect ratio.
export async function compressImage(
  file: File,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<{ dataUrl: string; blob: Blob; mediaType: string; name: string }> {
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.82;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // Fallback: return original as data URL.
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    return { dataUrl, blob: file, mediaType: file.type || "image/png", name: file.name || "screenshot.png" };
  }

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b as Blob), "image/jpeg", quality),
  );
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  const base = (file.name || "screenshot").replace(/\.[a-z0-9]+$/i, "");
  return { dataUrl, blob, mediaType: "image/jpeg", name: `${base}.jpg` };
}

// Daily screenshot upload quota (client-side; server also enforces size cap).
const QUOTA_KEY = "trademind.screenshotUploads.v1";
const DAILY_LIMIT = 5;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function getScreenshotQuota(): { used: number; limit: number; remaining: number } {
  if (typeof window === "undefined") return { used: 0, limit: DAILY_LIMIT, remaining: DAILY_LIMIT };
  try {
    const raw = window.localStorage.getItem(QUOTA_KEY);
    const parsed = raw ? (JSON.parse(raw) as { date: string; used: number }) : null;
    const used = parsed && parsed.date === todayKey() ? parsed.used : 0;
    return { used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used) };
  } catch {
    return { used: 0, limit: DAILY_LIMIT, remaining: DAILY_LIMIT };
  }
}

export function bumpScreenshotQuota() {
  if (typeof window === "undefined") return;
  const q = getScreenshotQuota();
  const next = { date: todayKey(), used: q.used + 1 };
  try { window.localStorage.setItem(QUOTA_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}
