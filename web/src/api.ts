import { saveCached } from './storage.ts';

// The server tags each response, and an unchanged one comes back as an empty 304. Most
// 30 second refreshes are unchanged, so they cost a few hundred bytes.
const etags = new Map<string, { etag: string; data: unknown }>();

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getJson<T>(url: string, options: { signal?: AbortSignal; remember?: boolean } = {}): Promise<T> {
  const known = etags.get(url);
  const response = await fetch(url, {
    ...(options.signal ? { signal: options.signal } : {}),
    headers: known ? { 'If-None-Match': known.etag } : {},
  });
  if (response.status === 304 && known) return known.data as T;
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new HttpError(response.status, body?.error ?? `The server answered ${response.status}`);
  }
  const data = (await response.json()) as T;
  const etag = response.headers.get('ETag');
  if (etag) etags.set(url, { etag, data });
  if (options.remember) saveCached(url, data);
  return data;
}

// Data the server put inside the page for a saved trip link, used once on startup.
export function takeInitialData<T>(): T | null {
  const element = document.getElementById('initial');
  if (!element?.textContent) return null;
  element.remove();
  try {
    return JSON.parse(element.textContent) as T;
  } catch {
    return null;
  }
}
