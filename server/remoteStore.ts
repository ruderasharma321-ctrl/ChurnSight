export type PersistenceMode = 'kv' | 'disk' | 'ephemeral_tmp';

export interface PersistenceStatusInfo {
  persistent: boolean;
  mode: PersistenceMode;
}

function getKvConfig(): { url: string; token: string } | null {
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

export function isRemoteStoreConfigured(): boolean {
  return getKvConfig() !== null;
}

export function getPersistenceStatus(): PersistenceStatusInfo {
  if (isRemoteStoreConfigured()) {
    return { persistent: true, mode: 'kv' };
  }
  if (process.env.CHURNSIGHT_DATA_DIR || !process.env.VERCEL) {
    return { persistent: true, mode: 'disk' };
  }
  return { persistent: false, mode: 'ephemeral_tmp' };
}

export async function remoteGetJson<T>(key: string): Promise<T | null> {
  const cfg = getKvConfig();
  if (!cfg) return null;

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['GET', key]),
  });

  if (!res.ok) {
    throw new Error(`Remote store GET "${key}" failed with HTTP ${res.status}`);
  }

  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) {
    throw new Error(data.error);
  }
  if (data.result === null || data.result === undefined || data.result === '') {
    return null;
  }
  if (typeof data.result === 'string') {
    return JSON.parse(data.result) as T;
  }
  return data.result as T;
}

export async function remoteSetJson(key: string, value: unknown): Promise<void> {
  const cfg = getKvConfig();
  if (!cfg) return;

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(['SET', key, JSON.stringify(value)]),
  });

  if (!res.ok) {
    throw new Error(`Remote store SET "${key}" failed with HTTP ${res.status}`);
  }

  const data = (await res.json()) as { error?: string };
  if (data.error) {
    throw new Error(data.error);
  }
}
