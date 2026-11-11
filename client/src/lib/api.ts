// Talking to the server. A 401 always means "signed out": the app shows the sign-in page.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let onSignedOut: () => void = () => {};
export function whenSignedOut(fn: () => void): void {
  onSignedOut = fn;
}

const FRIENDLY: Record<string, string> = {
  wrong: "That name or password isn't right.",
  bad_code: "That code isn't right, or it's run out. Make a new one and try again.",
  locked: 'Too many tries. Please wait a few minutes and try again.',
  name_taken: 'Someone already uses that name.',
  not_yourself: "You can't remove yourself.",
  server_error: 'Something went wrong on the server. Please try again.',
  not_found: "That isn't there any more.",
  too_big: 'That photo is too big to send.',
};

export async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  // A photo goes up as it is; everything else as JSON.
  const raw = body instanceof Blob;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': raw ? 'image/jpeg' : 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-nest': '1' } : {}),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach Nest — no signal?", 0, 'offline');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) {
    onSignedOut();
    throw new ApiError('Please sign in again.', 401, 'no_session');
  }
  if (!res.ok || data.ok === false) {
    const code = String(data.error ?? 'error');
    throw new ApiError(FRIENDLY[code] ?? String(data.message ?? 'Something went wrong. Please try again.'), res.status, code, data);
  }
  return data as T;
}

export const get = <T>(url: string) => api<T>('GET', url);
export const post = <T>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const put = <T>(url: string, body: unknown) => api<T>('PUT', url, body);
export const del = <T>(url: string) => api<T>('DELETE', url);
