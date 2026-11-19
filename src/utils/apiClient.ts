const SESSION_TOKEN_STORAGE_KEY = 'churnsight_session_token';
let inMemorySessionToken: string | null = null;

export function getClientSessionToken(): string | null {
  if (inMemorySessionToken) {
    return inMemorySessionToken;
  }
  try {
    const stored = window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    if (stored) {
      inMemorySessionToken = stored;
    }
    return stored;
  } catch {
    return inMemorySessionToken;
  }
}

export function setClientSessionToken(token: string | null | undefined): void {
  inMemorySessionToken = token || null;
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction errors; inMemorySessionToken remains active
  }
}

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function resolveApiUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string' && input.startsWith('/') && RAW_API_BASE) {
    return `${RAW_API_BASE}${input}`;
  }
  return input;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getClientSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(resolveApiUrl(input), {
    ...init,
    credentials: init.credentials ?? 'include',
    cache: init.cache ?? 'no-store',
    headers,
  });

  if (res.status === 401) {
    setClientSessionToken(null);
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
