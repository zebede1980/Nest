// Photos are shrunk on the phone before they're sent: a 12-megapixel picture would take
// an age on mobile data, and nobody needs that much of a skirting board.

import { api } from './api';

const FULL = 1600;
const THUMB = 480;

export interface PhotoTarget {
  job?: number;
  room?: number;
  cost?: number;
}

async function load(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("That file isn't a photo Nest can read.");
  } finally {
    // The decoded picture stays usable after its address is let go.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

function shrink(img: HTMLImageElement, longest: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const scale = Math.min(1, longest / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // Receipts and screenshots can be see-through; JPEG would turn that black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve({ blob, w, h }) : reject(new Error("That photo couldn't be prepared."))), 'image/jpeg', quality),
  );
}

/** Sends one photo, then its small version for lists. Returns the photo's id. */
export async function uploadPhoto(file: Blob, target: PhotoTarget, caption?: string): Promise<number> {
  const img = await load(file);
  const full = await shrink(img, FULL, 0.82);
  const q = new URLSearchParams({ w: String(full.w), h: String(full.h) });
  if (target.job != null) q.set('job', String(target.job));
  if (target.room != null) q.set('room', String(target.room));
  if (target.cost != null) q.set('cost', String(target.cost));
  if (caption) q.set('caption', caption);
  const { id } = await api<{ id: number }>('POST', `/api/photos?${q}`, full.blob);
  try {
    const thumb = await shrink(img, THUMB, 0.72);
    await api('PUT', `/api/photos/${id}/thumb`, thumb.blob);
  } catch {
    /* lists fall back to the full picture */
  }
  return id;
}
