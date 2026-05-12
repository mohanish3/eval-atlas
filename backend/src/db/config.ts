type DatabaseConfigSource =
  | 'database_url'
  | 'connection_fields'
  | 'supabase_direct'
  | 'supabase_pooler'
  | 'unconfigured';

export interface ResolvedDatabaseConfig {
  configured: boolean;
  source: DatabaseConfigSource;
  connectionString: string | null;
  redactedConnectionString: string | null;
  envKeys: string[];
  label: string;
  sslEnabled: boolean;
  rejectUnauthorized: boolean;
}

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'require', 'required'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off', 'disable', 'disabled'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function buildConnectionString(config: {
  username: string;
  password: string;
  host: string;
  port: string;
  database: string;
  sslEnabled: boolean;
}): string {
  const params = new URLSearchParams();
  if (config.sslEnabled) {
    params.set('sslmode', 'require');
  }

  const query = params.toString();
  return `postgresql://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${encodeURIComponent(config.database)}${query ? `?${query}` : ''}`;
}

function redactConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return connectionString.replace(/:(?:[^:@/]+)@/, ':***@');
  }
}

function buildResolvedConfig(input: {
  source: DatabaseConfigSource;
  connectionString: string;
  envKeys: string[];
  label: string;
  defaultSslEnabled: boolean;
}): ResolvedDatabaseConfig {
  const sslEnabled = parseBooleanEnv(process.env.DATABASE_SSL)
    ?? parseBooleanEnv(process.env.DB_SSL_ENABLED)
    ?? input.defaultSslEnabled;

  return {
    configured: true,
    source: input.source,
    connectionString: input.connectionString,
    redactedConnectionString: redactConnectionString(input.connectionString),
    envKeys: input.envKeys,
    label: input.label,
    sslEnabled,
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

export function resolveDatabaseConfig(): ResolvedDatabaseConfig {
  const databaseUrl = cleanEnv(process.env.DATABASE_URL);
  if (databaseUrl) {
    return buildResolvedConfig({
      source: 'database_url',
      connectionString: databaseUrl,
      envKeys: ['DATABASE_URL'],
      label: 'DATABASE_URL',
      defaultSslEnabled: process.env.NODE_ENV === 'production',
    });
  }

  const host = cleanEnv(process.env.DATABASE_HOST);
  const port = cleanEnv(process.env.DATABASE_PORT) ?? '5432';
  const database = cleanEnv(process.env.DATABASE_NAME);
  const username = cleanEnv(process.env.DATABASE_USER);
  const password = cleanEnv(process.env.DATABASE_PASSWORD);

  if (host && database && username && password) {
    const sslEnabled = parseBooleanEnv(process.env.DATABASE_SSL)
      ?? parseBooleanEnv(process.env.DB_SSL_ENABLED)
      ?? process.env.NODE_ENV === 'production';

    return buildResolvedConfig({
      source: 'connection_fields',
      connectionString: buildConnectionString({
        host,
        port,
        database,
        username,
        password,
        sslEnabled,
      }),
      envKeys: [
        'DATABASE_HOST',
        'DATABASE_PORT',
        'DATABASE_NAME',
        'DATABASE_USER',
        'DATABASE_PASSWORD',
        'DATABASE_SSL',
      ],
      label: 'DATABASE_* fields',
      defaultSslEnabled: sslEnabled,
    });
  }

  const supabaseProjectRef = cleanEnv(process.env.SUPABASE_PROJECT_REF);
  const supabasePassword = cleanEnv(process.env.SUPABASE_DB_PASSWORD);
  const supabaseDatabase = cleanEnv(process.env.SUPABASE_DB_NAME) ?? 'postgres';
  const supabaseUsePooler = parseBooleanEnv(process.env.SUPABASE_USE_POOLER) ?? false;

  if (supabaseProjectRef && supabasePassword) {
    if (supabaseUsePooler) {
      const supabaseRegion = cleanEnv(process.env.SUPABASE_REGION);
      if (supabaseRegion) {
        return buildResolvedConfig({
          source: 'supabase_pooler',
          connectionString: buildConnectionString({
            username: `postgres.${supabaseProjectRef}`,
            password: supabasePassword,
            host: `aws-0-${supabaseRegion}.pooler.supabase.com`,
            port: '6543',
            database: supabaseDatabase,
            sslEnabled: true,
          }),
          envKeys: [
            'SUPABASE_PROJECT_REF',
            'SUPABASE_DB_PASSWORD',
            'SUPABASE_REGION',
            'SUPABASE_USE_POOLER',
            'SUPABASE_DB_NAME',
          ],
          label: 'Supabase pooler fields',
          defaultSslEnabled: true,
        });
      }
    } else {
      return buildResolvedConfig({
        source: 'supabase_direct',
        connectionString: buildConnectionString({
          username: 'postgres',
          password: supabasePassword,
          host: `db.${supabaseProjectRef}.supabase.co`,
          port: '5432',
          database: supabaseDatabase,
          sslEnabled: true,
        }),
        envKeys: [
          'SUPABASE_PROJECT_REF',
          'SUPABASE_DB_PASSWORD',
          'SUPABASE_USE_POOLER',
          'SUPABASE_DB_NAME',
        ],
        label: 'Supabase direct fields',
        defaultSslEnabled: true,
      });
    }
  }

  return {
    configured: false,
    source: 'unconfigured',
    connectionString: null,
    redactedConnectionString: null,
    envKeys: [],
    label: 'Unconfigured',
    sslEnabled: false,
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

export function resolveReadDatabaseUrl(): { connectionString: string | null; envKey: string | null } {
  const readUrl = cleanEnv(process.env.DATABASE_READ_URL);
  if (readUrl) {
    return { connectionString: readUrl, envKey: 'DATABASE_READ_URL' };
  }

  const config = resolveDatabaseConfig();
  return {
    connectionString: config.connectionString,
    envKey: config.configured ? config.label : null,
  };
}
