import postgres from "postgres";

type PostgresRow = Record<string, unknown>;
type PostgresRows = PostgresRow[] & {
  columns?: Array<{ name: string; type: number }>;
  count?: number | null;
};
type ExecuteQuery = (query: string, values: readonly unknown[]) => Promise<PostgresRows>;

type ConvertedQuery = {
  text: string;
  parameterCount: number;
};

/**
 * Converts D1/SQLite positional parameters to PostgreSQL parameters without
 * touching question marks inside strings, quoted identifiers, or comments.
 */
export function toPostgresPlaceholders(query: string): ConvertedQuery {
  let parameterCount = 0;
  let converted = "";

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    const next = query[index + 1];

    if (character === "'") {
      converted += character;
      for (index += 1; index < query.length; index += 1) {
        converted += query[index];
        if (query[index] !== "'") continue;
        if (query[index + 1] === "'") {
          converted += query[index + 1];
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (character === '"') {
      converted += character;
      for (index += 1; index < query.length; index += 1) {
        converted += query[index];
        if (query[index] !== '"') continue;
        if (query[index + 1] === '"') {
          converted += query[index + 1];
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (character === "-" && next === "-") {
      const lineEnd = query.indexOf("\n", index + 2);
      if (lineEnd === -1) {
        converted += query.slice(index);
        break;
      }
      converted += query.slice(index, lineEnd + 1);
      index = lineEnd;
      continue;
    }

    if (character === "/" && next === "*") {
      let depth = 1;
      converted += "/*";
      index += 2;
      for (; index < query.length && depth > 0; index += 1) {
        if (query[index] === "/" && query[index + 1] === "*") {
          converted += "/*";
          index += 1;
          depth += 1;
        } else if (query[index] === "*" && query[index + 1] === "/") {
          converted += "*/";
          index += 1;
          depth -= 1;
        } else {
          converted += query[index];
        }
      }
      index -= 1;
      continue;
    }

    if (character === "$") {
      const dollarQuote = query.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (dollarQuote) {
        const quoteEnd = query.indexOf(dollarQuote, index + dollarQuote.length);
        if (quoteEnd === -1) {
          converted += query.slice(index);
          break;
        }
        converted += query.slice(index, quoteEnd + dollarQuote.length);
        index = quoteEnd + dollarQuote.length - 1;
        continue;
      }
      if (/\d/.test(next ?? "")) {
        throw new Error("D1 queries must not contain PostgreSQL positional parameters");
      }
    }

    if (character === "?") {
      if (/\d/.test(next ?? "")) {
        throw new Error("Numbered SQLite parameters are not supported; use bare ? parameters");
      }
      parameterCount += 1;
      converted += `$${parameterCount}`;
      continue;
    }

    converted += character;
  }

  return { text: converted, parameterCount };
}

function toD1Result<T>(rows: PostgresRows): D1Result<T> {
  const changes = Number(rows.count ?? 0);
  const int8Columns = new Set(
    (rows.columns ?? []).filter((column) => column.type === 20).map((column) => column.name),
  );
  const results = rows.map((row) => {
    if (int8Columns.size === 0) return row;
    const normalized = { ...row };
    for (const column of int8Columns) {
      const value = normalized[column];
      if (typeof value !== "string") continue;
      const number = Number(value);
      if (Number.isSafeInteger(number)) normalized[column] = number;
    }
    return normalized;
  });
  return {
    // postgres.js intentionally returns int8 (including COUNT(*)) as strings.
    // D1 returns safe integer values as numbers, so keep that behavior here.
    results: results as unknown as T[],
    success: true,
    meta: { changes: Number.isFinite(changes) ? changes : 0 },
  };
}

class PostgresPreparedStatement implements D1PreparedStatement {
  private readonly converted: ConvertedQuery;

  constructor(
    readonly databaseToken: symbol,
    private readonly query: string,
    private readonly executeQuery: ExecuteQuery,
    private readonly values: readonly unknown[] = [],
  ) {
    this.converted = toPostgresPlaceholders(query);
  }

  bind(...values: unknown[]): PostgresPreparedStatement {
    return new PostgresPreparedStatement(
      this.databaseToken,
      this.query,
      this.executeQuery,
      values,
    );
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.execute<T>();
    return result.results[0] ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  executeWith<T = unknown>(executeQuery: ExecuteQuery): Promise<D1Result<T>> {
    return this.execute<T>(executeQuery);
  }

  private async execute<T>(executeQuery = this.executeQuery): Promise<D1Result<T>> {
    if (this.values.length !== this.converted.parameterCount) {
      throw new Error(
        `SQL parameter mismatch: expected ${this.converted.parameterCount}, received ${this.values.length}`,
      );
    }
    const rows = await executeQuery(this.converted.text, this.values);
    return toD1Result<T>(rows);
  }
}

class PostgresD1Database implements D1Database {
  private readonly databaseToken = Symbol("postgres-d1-database");
  private readonly executeQuery: ExecuteQuery;

  constructor(private readonly client: ReturnType<typeof postgres>) {
    this.executeQuery = async (query, values) =>
      (await client.unsafe(query, [...values] as never[])) as unknown as PostgresRows;
  }

  prepare(query: string): PostgresPreparedStatement {
    return new PostgresPreparedStatement(this.databaseToken, query, this.executeQuery);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    for (const statement of statements) {
      if (
        !(statement instanceof PostgresPreparedStatement) ||
        statement.databaseToken !== this.databaseToken
      ) {
        throw new Error("PostgreSQL batches only accept statements prepared by the same database");
      }
    }

    const results = await this.client.begin(async (transaction) => {
      const executeInTransaction: ExecuteQuery = async (query, values) =>
        (await transaction.unsafe(query, [...values] as never[])) as unknown as PostgresRows;
      const batchResults: D1Result<T>[] = [];
      for (const statement of statements as PostgresPreparedStatement[]) {
        batchResults.push(await statement.executeWith<T>(executeInTransaction));
      }
      return batchResults;
    });
    return results as D1Result<T>[];
  }
}

const protectedTableNames = [
  "users",
  "user_profiles",
  "user_ai_preferences",
  "global_ai_settings",
  "managed_ai_usage",
  "token_wallets",
  "token_transactions",
  "token_topups",
  "payment_orders",
  "sermon_drafts",
  "sermon_alternatives",
  "sermon_generation_runs",
  "sermon_generation_items",
  "sermon_generation_claims",
  "sermon_generation_parts",
  "sermon_versions",
  "sermons",
  "notification_preferences",
  "consultations",
  "consultation_messages",
  "notification_deliveries",
] as const;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'preacher', created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
    ministry_role TEXT NOT NULL DEFAULT '담임목사', church TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_ai_preferences (
    user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
    engine TEXT NOT NULL DEFAULT 'openai', endpoint TEXT NOT NULL, model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL DEFAULT 'low', updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS global_ai_settings (
    id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
    engine TEXT NOT NULL DEFAULT 'openai', endpoint TEXT NOT NULL, model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL DEFAULT 'low',
    max_output_tokens INTEGER,
    api_key_encrypted TEXT,
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS managed_ai_usage (
    user_id TEXT NOT NULL, usage_date TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_ai_usage_user_date
    ON managed_ai_usage(user_id, usage_date)`,
  `CREATE TABLE IF NOT EXISTS token_wallets (
    user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 200 CHECK (balance >= 0),
    lifetime_purchased INTEGER NOT NULL DEFAULT 0, lifetime_spent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS token_transactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
    reference_id TEXT NOT NULL, description TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_token_transactions_reference
    ON token_transactions(reference_id)`,
  `CREATE INDEX IF NOT EXISTS idx_token_transactions_user_created
    ON token_transactions(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS token_topups (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, usd_cents INTEGER NOT NULL CHECK (usd_cents >= 100),
    token_amount INTEGER NOT NULL CHECK (token_amount >= 200), status TEXT NOT NULL DEFAULT 'pending',
    stripe_checkout_session_id TEXT, stripe_payment_intent_id TEXT,
    created_at TEXT NOT NULL, completed_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_token_topups_checkout_session
    ON token_topups(stripe_checkout_session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_token_topups_user_created
    ON token_topups(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_token_topups_status ON token_topups(status)`,
  `CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payment_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'portone', payment_method TEXT NOT NULL,
    amount_krw INTEGER NOT NULL CHECK (amount_krw >= 1000),
    token_amount INTEGER NOT NULL CHECK (token_amount >= 200),
    status TEXT NOT NULL DEFAULT 'pending', transaction_id TEXT,
    created_at TEXT NOT NULL, completed_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_payment_id
    ON payment_orders(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created
    ON payment_orders(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status)`,
  `CREATE TABLE IF NOT EXISTS sermon_drafts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, topic TEXT NOT NULL,
    scripture TEXT NOT NULL DEFAULT '', sermon_type TEXT NOT NULL,
    audience TEXT NOT NULL, point_count INTEGER NOT NULL, duration INTEGER NOT NULL,
    emotion TEXT NOT NULL, reference_mode TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL DEFAULT 'options_valid', active_generation_id TEXT,
    selected_alternative_id TEXT,
    revision_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sermon_drafts_user_updated ON sermon_drafts(user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sermon_drafts_status ON sermon_drafts(status)`,
  `CREATE TABLE IF NOT EXISTS sermon_alternatives (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, position INTEGER NOT NULL,
    title TEXT NOT NULL, scripture TEXT NOT NULL, introduction TEXT NOT NULL,
    body_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_alternatives_draft_position ON sermon_alternatives(draft_id, position)`,
  `CREATE INDEX IF NOT EXISTS idx_alternatives_draft ON sermon_alternatives(draft_id)`,
  `CREATE TABLE IF NOT EXISTS sermon_generation_runs (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, user_id TEXT NOT NULL,
    expected_count INTEGER NOT NULL, ai_signature TEXT NOT NULL,
    managed_allowed INTEGER NOT NULL DEFAULT -1, status TEXT NOT NULL DEFAULT 'generating',
    provider TEXT NOT NULL DEFAULT 'pending', model TEXT, reasoning_effort TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sermon_generation_items (
    id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, position INTEGER NOT NULL,
    alternative_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_items_run_position
    ON sermon_generation_items(generation_id, position)`,
  `CREATE TABLE IF NOT EXISTS sermon_generation_claims (
    id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, position INTEGER NOT NULL,
    lease_token TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_claims_run_position
    ON sermon_generation_claims(generation_id, position)`,
  `CREATE TABLE IF NOT EXISTS sermon_generation_parts (
    id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, position INTEGER NOT NULL,
    step INTEGER NOT NULL, part_json TEXT NOT NULL, provider TEXT NOT NULL,
    model TEXT, reasoning_effort TEXT, elapsed_ms INTEGER NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_parts_run_position_step
    ON sermon_generation_parts(generation_id, position, step)`,
  `CREATE TABLE IF NOT EXISTS sermon_versions (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, version_number INTEGER NOT NULL,
    instruction TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, body_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_draft_number ON sermon_versions(draft_id, version_number)`,
  `CREATE TABLE IF NOT EXISTS sermons (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, draft_id TEXT, title TEXT NOT NULL,
    scripture TEXT NOT NULL, sermon_type TEXT NOT NULL, audience TEXT NOT NULL,
    point_count INTEGER NOT NULL, duration INTEGER NOT NULL, emotion TEXT NOT NULL,
    body_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sermons_draft ON sermons(draft_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sermons_user_created ON sermons(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sermons_user_title ON sermons(user_id, title)`,
  `CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY, email_enabled INTEGER NOT NULL DEFAULT 1,
    push_enabled INTEGER NOT NULL DEFAULT 0, completion_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS consultations (
    id TEXT PRIMARY KEY, sermon_id TEXT NOT NULL, user_id TEXT NOT NULL, expert_id TEXT,
    reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
    queue_position INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_consultations_sermon_user ON consultations(sermon_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_consultations_user_updated ON consultations(user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_consultations_expert_status ON consultations(expert_id, status)`,
  `CREATE TABLE IF NOT EXISTS consultation_messages (
    id TEXT PRIMARY KEY, consultation_id TEXT NOT NULL, sender_id TEXT NOT NULL,
    sender_role TEXT NOT NULL, body TEXT NOT NULL, section TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_consultation_created ON consultation_messages(consultation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, sermon_id TEXT, channel TEXT NOT NULL,
    status TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_user_created ON notification_deliveries(user_id, created_at)`,
  // These application tables live in Supabase's public schema, but the browser
  // only needs Auth. No Data API policy is created, so anon/authenticated access
  // remains denied while the server's direct owner connection keeps working.
  ...protectedTableNames.map(
    (table) => `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
  ),
];

let database: D1Database | null = null;
let databaseUrl: string | null = null;
let schemaReady = false;
let schemaInitialization: Promise<void> | null = null;

export function getD1(): D1Database | null {
  const configuredUrl =
    process.env.POSTGRES_URL?.trim() || process.env.POSTGRES_URL_NON_POOLING?.trim();
  if (!configuredUrl || configuredUrl.startsWith("[")) return null;

  if (!database || databaseUrl !== configuredUrl) {
    const client = postgres(configuredUrl, {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 1,
      prepare: false,
      ssl: "require",
    });
    database = new PostgresD1Database(client);
    databaseUrl = configuredUrl;
    schemaReady = false;
    schemaInitialization = null;
  }
  return database;
}

export async function ensureDatabase(db: D1Database): Promise<void> {
  if (schemaReady) return;
  if (!schemaInitialization) {
    schemaInitialization = (async () => {
      // Separate Vercel instances can cold-start at the same time. PostgreSQL's
      // CREATE TABLE IF NOT EXISTS still races while catalog rows are being
      // created, so serialize the complete bootstrap transaction per database.
      await db.batch([
        db.prepare("SELECT pg_advisory_xact_lock(731202608)"),
        ...schemaStatements.map((statement) => db.prepare(statement)),
      ]);
      const columns = await db
        .prepare(
          `SELECT column_name AS name
           FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'user_ai_preferences'`,
        )
        .all<{ name: string }>();
      if (!columns.results.some((column) => column.name === "engine")) {
        throw new Error("AI engine migration is required");
      }
      const globalAiColumns = await db
        .prepare(
          `SELECT column_name AS name
           FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'global_ai_settings'`,
        )
        .all<{ name: string }>();
      if (!globalAiColumns.results.some((column) => column.name === "api_key_encrypted")) {
        await db
          .prepare(
            "ALTER TABLE global_ai_settings ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT",
          )
          .run();
      }
      if (!globalAiColumns.results.some((column) => column.name === "max_output_tokens")) {
        await db
          .prepare(
            "ALTER TABLE global_ai_settings ADD COLUMN IF NOT EXISTS max_output_tokens INTEGER",
          )
          .run();
      }
      const draftColumns = await db
        .prepare(
          `SELECT column_name AS name
           FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'sermon_drafts'`,
        )
        .all<{ name: string }>();
      if (!draftColumns.results.some((column) => column.name === "active_generation_id")) {
        await db
          .prepare(
            "ALTER TABLE sermon_drafts ADD COLUMN IF NOT EXISTS active_generation_id TEXT",
          )
          .run();
      }
      await db
        .prepare(
          `UPDATE user_ai_preferences
           SET engine = 'custom'
           WHERE engine = 'openai'
             AND lower(rtrim(endpoint, '/')) <> 'https://api.openai.com/v1/responses'`,
        )
        .run();
      schemaReady = true;
    })().catch((error) => {
      schemaInitialization = null;
      throw error;
    });
  }
  await schemaInitialization;
}

export async function withDatabase<T>(operation: (db: D1Database) => Promise<T>): Promise<T | null> {
  const db = getD1();
  if (!db) return null;
  await ensureDatabase(db);
  return operation(db);
}

export async function claimManagedAiQuota(
  db: D1Database,
  userId: string,
  dailyLimit = 10,
): Promise<boolean> {
  const now = new Date();
  const usageDate = now.toISOString().slice(0, 10);
  const result = await db
    .prepare(
      `INSERT INTO managed_ai_usage (user_id, usage_date, request_count, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, usage_date) DO UPDATE SET
         request_count = managed_ai_usage.request_count + 1,
         updated_at = excluded.updated_at
       WHERE managed_ai_usage.request_count < ?`,
    )
    .bind(userId, usageDate, now.toISOString(), dailyLimit)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
