export type PersistenceMode = 'postgres' | 'kv' | 'disk' | 'unconfigured';

export interface PersistenceStatusInfo {
  persistent: boolean;
  mode: PersistenceMode;
  provider: string | null;
  message: string;
}

export function getPostgresUrl(): string | null {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  ];
  for (const raw of candidates) {
    const trimmed = (raw || '').trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function isPostgresConfigured(): boolean {
  return getPostgresUrl() !== null;
}

export function getKvConfig(): { url: string; token: string } | null {
  const url = (
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const token = (
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    ''
  ).trim();

  if (!url || !token) return null;
  return { url, token };
}

export function isKvConfigured(): boolean {
  return getKvConfig() !== null;
}

export function isRemoteStoreConfigured(): boolean {
  return isKvConfigured();
}

export function isDiskPersistenceAllowed(): boolean {
  if (process.env.CHURNSIGHT_DATA_DIR && process.env.CHURNSIGHT_DATA_DIR.trim()) {
    return true;
  }
  // On Vercel serverless, local filesystem (/tmp) is ephemeral across cold starts and never persistent
  if (process.env.VERCEL) {
    return false;
  }
  return true;
}

export function getPersistenceStatus(): PersistenceStatusInfo {
  if (isPostgresConfigured()) {
    return {
      persistent: true,
      mode: 'postgres',
      provider: 'PostgreSQL',
      message: 'Connected to persistent PostgreSQL database.',
    };
  }
  if (isKvConfigured()) {
    return {
      persistent: true,
      mode: 'kv',
      provider: 'Upstash Redis / Vercel KV',
      message: 'Connected to persistent Upstash Redis / Vercel KV store.',
    };
  }
  if (isDiskPersistenceAllowed()) {
    return {
      persistent: true,
      mode: 'disk',
      provider: 'Local Persistent Disk (.data)',
      message: 'Using local filesystem persistence directory.',
    };
  }
  return {
    persistent: false,
    mode: 'unconfigured',
    provider: null,
    message:
      'No persistent database is configured for this Vercel deployment. Connect DATABASE_URL (PostgreSQL) or KV_REST_API_URL + KV_REST_API_TOKEN (Upstash Redis) in Vercel Project Settings -> Environment Variables.',
  };
}

async function kvCommand<T = unknown>(command: (string | number)[]): Promise<T | null> {
  const cfg = getKvConfig();
  if (!cfg) return null;

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!res.ok) {
    throw new Error(`KV command ${String(command[0])} failed with HTTP ${res.status}`);
  }

  const data = (await res.json()) as { result?: T; error?: string };
  if (data.error) {
    throw new Error(data.error);
  }
  return data.result ?? null;
}

export async function kvPing(): Promise<boolean> {
  try {
    const res = await kvCommand<string>(['PING']);
    return String(res || '').toUpperCase() === 'PONG';
  } catch {
    return false;
  }
}

export async function remoteGetJson<T>(key: string): Promise<T | null> {
  const raw = await kvCommand<unknown>(['GET', key]);
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  if (typeof raw === 'string') {
    return JSON.parse(raw) as T;
  }
  return raw as T;
}

export async function remoteSetJson(
  key: string,
  value: unknown,
  ttlSeconds?: number | null
): Promise<void> {
  const cfg = getKvConfig();
  if (!cfg) return;
  const serialized = JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await kvCommand(['SET', key, serialized, 'EX', Math.ceil(ttlSeconds)]);
  } else {
    await kvCommand(['SET', key, serialized]);
  }
}

export async function remoteDeleteKey(key: string): Promise<void> {
  const cfg = getKvConfig();
  if (!cfg) return;
  await kvCommand(['DEL', key]);
}

export async function remoteSetAdd(setKey: string, member: string): Promise<void> {
  const cfg = getKvConfig();
  if (!cfg) return;
  await kvCommand(['SADD', setKey, member]);
}

export async function remoteSetRemove(setKey: string, member: string): Promise<void> {
  const cfg = getKvConfig();
  if (!cfg) return;
  await kvCommand(['SREM', setKey, member]);
}

export async function remoteSetMembers(setKey: string): Promise<string[]> {
  const cfg = getKvConfig();
  if (!cfg) return [];
  const res = await kvCommand<unknown>(['SMEMBERS', setKey]);
  return Array.isArray(res) ? res.map((v) => String(v)) : [];
}

export async function remoteMGetJson<T>(keys: string[]): Promise<(T | null)[]> {
  const cfg = getKvConfig();
  if (!cfg || keys.length === 0) return [];
  const res = await kvCommand<unknown[]>(['MGET', ...keys]);
  if (!Array.isArray(res)) return keys.map(() => null);
  return res.map((item) => {
    if (item === null || item === undefined || item === '') return null;
    if (typeof item === 'string') {
      try {
        return JSON.parse(item) as T;
      } catch {
        return null;
      }
    }
    return item as T;
  });
}
