import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { getPostgresUrl } from './remoteStore.ts';

let poolInstance: Pool | null = null;
let poolConnectionString: string | null = null;
let schemaInitPromise: Promise<void> | null = null;
let schemaReadyForUrl: string | null = null;

function shouldUseSsl(connectionString: string): boolean {
  const lower = connectionString.toLowerCase();
  if (lower.includes('sslmode=disable') || lower.includes('ssl=false')) {
    return false;
  }
  if (
    lower.includes('sslmode=require') ||
    lower.includes('sslmode=verify-full') ||
    lower.includes('sslmode=verify-ca') ||
    lower.includes('ssl=true')
  ) {
    return true;
  }
  if (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('::1')
  ) {
    return false;
  }
  return true;
}

export function getPgPool(): Pool | null {
  const connStr = getPostgresUrl();
  if (!connStr) {
    return null;
  }
  if (poolInstance && poolConnectionString === connStr) {
    return poolInstance;
  }
  if (poolInstance) {
    poolInstance.end().catch(() => undefined);
    poolInstance = null;
    schemaInitPromise = null;
    schemaReadyForUrl = null;
  }

  poolConnectionString = connStr;
  poolInstance = new Pool({
    connectionString: connStr,
    max: process.env.VERCEL ? 4 : 10,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    ...(shouldUseSsl(connStr) ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  poolInstance.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
  });

  return poolInstance;
}

export async function ensurePgSchema(): Promise<boolean> {
  const connStr = getPostgresUrl();
  const pool = getPgPool();
  if (!pool || !connStr) return false;

  if (schemaReadyForUrl === connStr) {
    return true;
  }

  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS companies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          name_lower TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL,
          registration_number TEXT,
          logo_data_url TEXT,
          industry TEXT NOT NULL DEFAULT 'telecommunications',
          custom_industry_name TEXT,
          country TEXT NOT NULL DEFAULT 'Malaysia',
          business_type TEXT NOT NULL DEFAULT 'B2C',
          business_model TEXT NOT NULL DEFAULT 'Subscription / Recurring',
          customer_relationship_type TEXT,
          subscription_plan TEXT NOT NULL DEFAULT 'free_trial',
          satisfaction_scale TEXT NOT NULL DEFAULT '1-5',
          churn_definition JSONB,
          privacy_settings JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          full_name TEXT NOT NULL,
          email TEXT NOT NULL,
          email_lower TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          avatar_data_url TEXT,
          permissions JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          remember_me BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

        CREATE TABLE IF NOT EXISTS company_workspaces (
          company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
          payload JSONB NOT NULL,
          storage_bytes_used INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS uploaded_datasets (
          dataset_id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          file_name TEXT NOT NULL,
          source_format TEXT NOT NULL,
          upload_pathway TEXT,
          upload_mode TEXT,
          customer_count INTEGER NOT NULL DEFAULT 0,
          ticket_count INTEGER NOT NULL DEFAULT 0,
          import_status TEXT NOT NULL DEFAULT 'Active',
          is_active BOOLEAN NOT NULL DEFAULT FALSE,
          state JSONB NOT NULL,
          rows JSONB NOT NULL,
          ticket_rows JSONB,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_uploaded_datasets_company_id ON uploaded_datasets(company_id);

        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          actor_email TEXT NOT NULL,
          actor_role TEXT NOT NULL,
          action TEXT NOT NULL,
          resource TEXT NOT NULL,
          details TEXT NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_audit_logs_company_time ON audit_logs(company_id, timestamp DESC);
      `);
      schemaReadyForUrl = connStr;
    })().catch((err) => {
      schemaInitPromise = null;
      schemaReadyForUrl = null;
      throw err;
    });
  }

  await schemaInitPromise;
  return true;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL connection pool is not configured.');
  }
  await ensurePgSchema();
  return pool.query<T>(sql, params);
}

export async function pgWithTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPgPool();
  if (!pool) {
    throw new Error('PostgreSQL connection pool is not configured.');
  }
  await ensurePgSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function pgHealthCheck(): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) return false;
  try {
    await ensurePgSchema();
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('PostgreSQL health check failed:', err);
    return false;
  }
}
