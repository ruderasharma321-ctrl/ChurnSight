import { handleDemoApiRequest } from '../demo/demoApiRouter';

const SESSION_TOKEN_STORAGE_KEY = 'churnsight_session_token';
let inMemorySessionToken: string | null = null;
const unauthorizedListeners = new Set<() => void>();

export const IS_DEMO_MODE = import.meta.env?.VITE_REMOTE_API_ONLY !== 'true';

export function subscribeUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function getClientSessionToken(): string | null {
  if (inMemorySessionToken) {
    return inMemorySessionToken;
  }
  try {
    const stored =
      window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY) ||
      window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (stored) {
      inMemorySessionToken = stored;
    }
    return stored;
  } catch {
    return inMemorySessionToken;
  }
}

export function setClientSessionToken(
  token: string | null | undefined,
  persist = true
): void {
  inMemorySessionToken = token || null;
  try {
    if (token) {
      if (persist) {
        window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
        window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
        window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
      }
    } else {
      window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction errors; inMemorySessionToken remains active
  }
}

const RAW_API_BASE = (import.meta.env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

function isEmbeddedOrCrossOrigin(): boolean {
  if (RAW_API_BASE) return true;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function resolveApiUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string' && input.startsWith('/') && RAW_API_BASE) {
    return `${RAW_API_BASE}${input}`;
  }
  return input;
}

function resolveInputUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

function isLocalApiRoute(urlStr: string): boolean {
  return urlStr.startsWith('/api/') || urlStr === '/api' || /^https?:\/\/[^/]+\/api(\/|\?|$)/.test(urlStr);
}

const PUBLIC_AUTH_401_ENDPOINTS = [
  '/api/auth/login',
  '/api/auth/register-company',
  '/api/auth/forgot-password',
  '/api/auth/status',
  '/api/auth/me',
];

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getClientSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (isEmbeddedOrCrossOrigin() && !headers.has('X-ChurnSight-Embedded')) {
    headers.set('X-ChurnSight-Embedded', '1');
  }

  const urlStr = resolveInputUrlString(input);

  const res =
    IS_DEMO_MODE && isLocalApiRoute(urlStr)
      ? await handleDemoApiRequest(urlStr, { ...init, headers }, token)
      : await fetch(resolveApiUrl(input), {
          ...init,
          credentials: init.credentials ?? 'include',
          cache: init.cache ?? 'no-store',
          headers,
        });

  if (res.status === 401) {
    setClientSessionToken(null);
    const isPublicAuthCall = PUBLIC_AUTH_401_ENDPOINTS.some((ep) => urlStr.includes(ep));
    if (!isPublicAuthCall) {
      unauthorizedListeners.forEach((cb) => {
        try {
          cb();
        } catch {
          // ignore listener errors
        }
      });
    }
  }

  return res;
}

export async function downloadProtectedCsv(url: string, fallbackFileName: string): Promise<void> {
  const res = await apiFetch(url);
  if (!res.ok) {
    let message = 'Failed to download file.';
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // Ignore non-JSON error body
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fallbackFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
