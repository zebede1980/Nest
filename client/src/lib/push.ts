// Notifications: the service worker, the permission, and keeping the server's copy of
// this device's subscription fresh. On iPhone this only works in the Home Screen app.

import { get, post } from './api';

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'off' | 'on';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
let publicKey: string | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!registration) {
    registration =
      'serviceWorker' in navigator
        ? navigator.serviceWorker
            .register('/sw.js', { scope: '/' })
            .then(() => navigator.serviceWorker.ready)
            .catch(() => null)
        : Promise.resolve(null);
  }
  return registration;
}

/** Fetched ahead of time: iOS only shows the permission prompt if it's asked for
 *  straight from a tap, with nothing slow awaited first. */
export async function preloadKey(): Promise<void> {
  if (publicKey) return;
  publicKey = (await get<{ publicKey: string }>('/api/push/key')).publicKey;
}

export async function pushState(): Promise<PushState> {
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Browser';
}

async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  await preloadKey();
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey!) });
}

async function send(sub: PushSubscription): Promise<void> {
  await post('/api/push/subscribe', { subscription: sub.toJSON(), label: deviceLabel() });
}

/** Call straight from a tap. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';
  const reg = await registerServiceWorker();
  if (!reg) return 'unsupported';
  await send(await subscribe(reg));
  return 'on';
}

export async function disablePush(): Promise<void> {
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

/** Every time the app opens: re-sends this device's subscription (making a new one if iOS
 *  dropped it), since iOS doesn't reliably tell the page when it changes. */
export async function syncPush(): Promise<void> {
  if (!supported() || Notification.permission !== 'granted') return;
  const reg = await registerServiceWorker();
  if (!reg) return;
  try {
    await send(await subscribe(reg));
  } catch {
    /* next time */
  }
}

export function setBadge(n: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) void nav.setAppBadge?.(n).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  } catch {
    /* not supported */
  }
}
