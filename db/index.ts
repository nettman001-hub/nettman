import postgres from "postgres";

type PostgresRow = Record<string, unknown>;
type PostgresRows = PostgresRow[] & {
  columns?: Array<{ name: string; type: number }>;
  count?: number | null;
};
type ExecuteQuery = (query: string, values: readonly unknown[]) => Promise<PostgresRows>;
type CancelablePostgresQuery<T> = PromiseLike<T> & { cancel(): unknown };

const DATABASE_QUERY_TIMEOUT_MS = 15_000;
type TransactionIdleTimeout = "30s" | "60s";

/**
 * Structured failure log for operational diagnosis. Only allowlisted
 * identifier fields are read from the error: message, detail, hint, query,
 * and parameters can carry bind values or connection details and are never
 * logged.
 */
function logDatabaseQueryFailure(
  stage: "deadline_exceeded" | "query_failed",
  error: unknown,
  elapsedMs: number,
): void {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  console.warn("[db]", {
    stage,
    elapsedMs,
    errorName: typeof record.name === "string" ? record.name.slice(0, 40) : undefined,
    code: typeof record.code === "string" ? record.code.slice(0, 32) : undefined,
  });
}

async function executeWithDatabaseDeadline<T>(
  query: CancelablePostgresQuery<T>,
): Promise<T> {
  let settled = false;
  const startedAt = Date.now();
  const deadline = setTimeout(() => {
    if (settled) return;
    logDatabaseQueryFailure("deadline_exceeded", null, Date.now() - startedAt);
    try {
      void Promise.resolve(query.cancel()).catch(() => undefined);
    } catch {
      // The query promise remains authoritative if cancellation itself fails.
    }
  }, DATABASE_QUERY_TIMEOUT_MS);
  try {
    return await query;
  } catch (error) {
    logDatabaseQueryFailure("query_failed", error, Date.now() - startedAt);
    throw error;
  } finally {
    settled = true;
    clearTimeout(deadline);
  }
}

async function applyTransactionDeadlines(
  executeQuery: ExecuteQuery,
  idleTimeout: TransactionIdleTimeout,
): Promise<void> {
  // set_config(..., true) is transaction-local, so these limits remain safe
  // behind Supavisor transaction pooling and cost a single round trip.
  await executeQuery(
    `SELECT
       set_config('statement_timeout', '15s', true),
       set_config('lock_timeout', '5s', true),
       set_config('idle_in_transaction_session_timeout', $1, true)`,
    [idleTimeout],
  );
}

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
      (await executeWithDatabaseDeadline(
        client.unsafe(query, [...values] as never[]),
      )) as unknown as PostgresRows;
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
        (await executeWithDatabaseDeadline(
          transaction.unsafe(query, [...values] as never[]),
        )) as unknown as PostgresRows;
      await applyTransactionDeadlines(executeInTransaction, "30s");
      const batchResults: D1Result<T>[] = [];
      for (const statement of statements as PostgresPreparedStatement[]) {
        batchResults.push(await statement.executeWith<T>(executeInTransaction));
      }
      return batchResults;
    });
    return results as D1Result<T>[];
  }

  async withAdvisoryLock<T>(
    lockKey: number,
    operation: (lockedDb: D1Database) => Promise<T>,
  ): Promise<T> {
    const result = await this.client.begin(async (transaction) => {
      const executeInTransaction: ExecuteQuery = async (query, values) =>
        (await executeWithDatabaseDeadline(
          transaction.unsafe(query, [...values] as never[]),
        )) as unknown as PostgresRows;
      // Advisory-lock operations can legitimately wait on a bounded external
      // Supabase request while the transaction is otherwise idle.
      await applyTransactionDeadlines(executeInTransaction, "60s");
      const lockedDb = new PostgresTransactionDatabase(executeInTransaction);
      await lockedDb
        .prepare("SELECT pg_advisory_xact_lock(?)")
        .bind(lockKey)
        .run();
      return operation(lockedDb);
    });
    return result as unknown as T;
  }
}

class PostgresTransactionDatabase implements D1Database {
  private readonly databaseToken = Symbol("postgres-transaction-d1-database");

  constructor(private readonly executeQuery: ExecuteQuery) {}

  prepare(query: string): PostgresPreparedStatement {
    return new PostgresPreparedStatement(this.databaseToken, query, this.executeQuery);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      if (
        !(statement instanceof PostgresPreparedStatement) ||
        statement.databaseToken !== this.databaseToken
      ) {
        throw new Error("PostgreSQL batches only accept statements prepared by the same database");
      }
      results.push(await statement.executeWith<T>(this.executeQuery));
    }
    return results;
  }
}

const protectedTableNames = [
  "users",
  "user_auth_sessions",
  "admin_audit_logs",
  "user_profiles",
  "user_ai_preferences",
  "global_ai_settings",
  "managed_ai_usage",
  "ai_agent_usage",
  "sermon_resource_usage",
  "token_wallets",
  "token_transactions",
  "token_adjustments",
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
    role TEXT NOT NULL DEFAULT 'preacher',
    is_admin INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active', status_reason TEXT,
    suspended_until TEXT, status_changed_at TEXT, status_changed_by TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '',
    last_seen_at TEXT, version INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS status_changed_at TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS status_changed_by TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_status_created ON users(status, created_at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_role_created ON users(role, created_at, id)`,
  `CREATE TABLE IF NOT EXISTS user_auth_sessions (
    user_id TEXT NOT NULL, session_id TEXT NOT NULL,
    first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
    revoked_at TEXT, revoked_by TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_sessions_user_session
    ON user_auth_sessions(user_id, session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_auth_sessions_user_revoked
    ON user_auth_sessions(user_id, revoked_at)`,
  `CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, target_user_id TEXT,
    action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
    reason TEXT NOT NULL, before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}', request_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_created
    ON admin_audit_logs(target_user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor_created
    ON admin_audit_logs(actor_user_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_audit_logs_request
    ON admin_audit_logs(request_id)`,
  `CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
    ministry_role TEXT NOT NULL DEFAULT '담임목사',
    denomination TEXT NOT NULL DEFAULT '', theology TEXT NOT NULL DEFAULT '',
    church TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS denomination TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS theology TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS user_ai_preferences (
    user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
    engine TEXT NOT NULL DEFAULT 'openai', endpoint TEXT NOT NULL, model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL DEFAULT 'low', updated_at TEXT NOT NULL
  )`,
  `ALTER TABLE user_ai_preferences
    ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'openai'`,
  `UPDATE user_ai_preferences
    SET engine = 'custom'
    WHERE engine = 'openai'
      AND lower(rtrim(endpoint, '/')) <> 'https://api.openai.com/v1/responses'`,
  `CREATE TABLE IF NOT EXISTS global_ai_settings (
    id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
    engine TEXT NOT NULL DEFAULT 'openai', endpoint TEXT NOT NULL, model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL DEFAULT 'low',
    max_output_tokens INTEGER,
    api_key_encrypted TEXT,
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `ALTER TABLE global_ai_settings
    ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT`,
  `ALTER TABLE global_ai_settings
    ADD COLUMN IF NOT EXISTS max_output_tokens INTEGER`,
  `CREATE TABLE IF NOT EXISTS managed_ai_usage (
    user_id TEXT NOT NULL, usage_date TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_managed_ai_usage_user_date
    ON managed_ai_usage(user_id, usage_date)`,
  `CREATE TABLE IF NOT EXISTS ai_agent_usage (
    user_id TEXT NOT NULL, usage_date TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    active_request_id TEXT, active_started_at TEXT, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_agent_usage_user_date
    ON ai_agent_usage(user_id, usage_date)`,
  `CREATE TABLE IF NOT EXISTS sermon_resource_usage (
    user_id TEXT NOT NULL, usage_date TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    active_request_id TEXT, active_started_at TEXT, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sermon_resource_usage_user_date
    ON sermon_resource_usage(user_id, usage_date)`,
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
  `CREATE TABLE IF NOT EXISTS token_adjustments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL,
    reason TEXT NOT NULL, actor_user_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, transaction_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_token_adjustments_idempotency
    ON token_adjustments(idempotency_key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_token_adjustments_transaction
    ON token_adjustments(transaction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_token_adjustments_user_created
    ON token_adjustments(user_id, created_at)`,
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
    audience TEXT NOT NULL, audience_situation TEXT NOT NULL DEFAULT '일반',
    point_count INTEGER NOT NULL, duration INTEGER NOT NULL,
    emotion TEXT NOT NULL, reference_mode TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL DEFAULT 'options_valid', active_generation_id TEXT,
    selected_alternative_id TEXT,
    revision_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `ALTER TABLE sermon_drafts ADD COLUMN IF NOT EXISTS audience_situation TEXT NOT NULL DEFAULT '일반'`,
  `ALTER TABLE sermon_drafts ADD COLUMN IF NOT EXISTS active_generation_id TEXT`,
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
    audience_situation TEXT NOT NULL DEFAULT '일반',
    point_count INTEGER NOT NULL, duration INTEGER NOT NULL, emotion TEXT NOT NULL,
    body_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `ALTER TABLE sermons ADD COLUMN IF NOT EXISTS audience_situation TEXT NOT NULL DEFAULT '일반'`,
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

const requiredSchemaColumns = [
  ["users", "is_admin"],
  ["users", "status"],
  ["users", "status_reason"],
  ["users", "suspended_until"],
  ["users", "status_changed_at"],
  ["users", "status_changed_by"],
  ["users", "updated_at"],
  ["users", "last_seen_at"],
  ["users", "version"],
  ["user_auth_sessions", "user_id"],
  ["user_auth_sessions", "session_id"],
  ["user_auth_sessions", "first_seen_at"],
  ["user_auth_sessions", "last_seen_at"],
  ["user_auth_sessions", "revoked_at"],
  ["user_auth_sessions", "revoked_by"],
  ["admin_audit_logs", "request_id"],
  ["admin_audit_logs", "target_user_id"],
  ["admin_audit_logs", "before_json"],
  ["admin_audit_logs", "after_json"],
  ["token_adjustments", "idempotency_key"],
  ["token_adjustments", "transaction_id"],
  ["token_adjustments", "actor_user_id"],
  ["user_profiles", "denomination"],
  ["user_profiles", "theology"],
  ["user_profiles", "phone"],
  ["user_ai_preferences", "engine"],
  ["global_ai_settings", "api_key_encrypted"],
  ["global_ai_settings", "max_output_tokens"],
  ["ai_agent_usage", "active_request_id"],
  ["ai_agent_usage", "active_started_at"],
  ["sermon_drafts", "active_generation_id"],
  ["sermon_drafts", "audience_situation"],
  ["sermons", "audience_situation"],
  ["sermon_resource_usage", "active_request_id"],
] as const;

const requiredUniqueIndexNames = [
  "idx_users_email",
  "idx_user_auth_sessions_user_session",
  "idx_admin_audit_logs_request",
  "idx_managed_ai_usage_user_date",
  "idx_ai_agent_usage_user_date",
  "idx_sermon_resource_usage_user_date",
  "idx_token_transactions_reference",
  "idx_token_adjustments_idempotency",
  "idx_token_adjustments_transaction",
  "idx_token_topups_checkout_session",
  "idx_payment_orders_payment_id",
  "idx_alternatives_draft_position",
  "idx_generation_items_run_position",
  "idx_generation_claims_run_position",
  "idx_generation_parts_run_position_step",
  "idx_versions_draft_number",
  "idx_sermons_draft",
  "idx_consultations_sermon_user",
] as const;

type SchemaReadinessRow = {
  column_count: number;
  rls_table_count: number;
  unique_index_count: number;
};

async function hasCurrentDatabaseSchema(db: D1Database): Promise<boolean> {
  const requiredColumns = requiredSchemaColumns.map(
    () => "(table_name = ? AND column_name = ?)",
  ).join(" OR ");
  const protectedTables = protectedTableNames.map(() => "?").join(", ");
  const uniqueIndexes = requiredUniqueIndexNames.map(() => "?").join(", ");
  const results = await db.batch<SchemaReadinessRow>([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*)
              FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND (${requiredColumns})) AS column_count,
           (SELECT COUNT(*)
              FROM pg_catalog.pg_class AS protected_table
              JOIN pg_catalog.pg_namespace AS protected_namespace
                ON protected_namespace.oid = protected_table.relnamespace
             WHERE protected_namespace.nspname = current_schema()
               AND protected_table.relkind IN ('r', 'p')
               AND protected_table.relname IN (${protectedTables})
               AND protected_table.relrowsecurity) AS rls_table_count,
           (SELECT COUNT(*)
              FROM pg_catalog.pg_class AS unique_index
              JOIN pg_catalog.pg_namespace AS index_namespace
                ON index_namespace.oid = unique_index.relnamespace
              JOIN pg_catalog.pg_index AS index_metadata
                ON index_metadata.indexrelid = unique_index.oid
             WHERE index_namespace.nspname = current_schema()
               AND unique_index.relkind IN ('i', 'I')
               AND unique_index.relname IN (${uniqueIndexes})
               AND index_metadata.indisunique
               AND index_metadata.indisvalid
               AND index_metadata.indisready) AS unique_index_count`,
      )
      .bind(
        ...requiredSchemaColumns.flat(),
        ...protectedTableNames,
        ...requiredUniqueIndexNames,
      ),
  ]);
  const row = results[0]?.results[0];
  return (
    Number(row?.column_count ?? -1) === requiredSchemaColumns.length &&
    Number(row?.rls_table_count ?? -1) === protectedTableNames.length &&
    Number(row?.unique_index_count ?? -1) === requiredUniqueIndexNames.length
  );
}

let database: D1Database | null = null;
let databaseUrl: string | null = null;
let schemaReady = false;
let schemaInitialization: Promise<void> | null = null;

function databaseConnectionPoolSize(): number {
  const configured = Number.parseInt(process.env.POSTGRES_POOL_MAX ?? "", 10);
  if (!Number.isFinite(configured)) return 4;
  return Math.min(8, Math.max(1, configured));
}

export function getD1(): D1Database | null {
  const configuredUrl =
    process.env.POSTGRES_URL?.trim() || process.env.POSTGRES_URL_NON_POOLING?.trim();
  if (!configuredUrl || configuredUrl.startsWith("[")) return null;

  if (!database || databaseUrl !== configuredUrl) {
    const poolSize = databaseConnectionPoolSize();
    // Operational check for pool sizing: transaction pooling tolerates a
    // larger per-instance pool than a direct connection. Log only the port
    // and the pooler classification; never the host, user, or credentials.
    try {
      const parsed = new URL(configuredUrl);
      console.warn("[db] pool", {
        max: poolSize,
        port: parsed.port || null,
        pooled: parsed.hostname.includes("pooler"),
      });
    } catch {
      console.warn("[db] pool", { max: poolSize, port: null, pooled: null });
    }
    const client = postgres(configuredUrl, {
      connect_timeout: 10,
      idle_timeout: 20,
      // One instance serves concurrent requests, and transactions reserve a
      // whole connection each. A single connection queues sibling requests
      // behind the active transaction until the 15s deadline cancels them,
      // so keep a small bounded pool. Supavisor transaction pooling stays
      // compatible because prepare stays off and every advisory lock and
      // timeout below is transaction-scoped.
      max: poolSize,
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

/**
 * Holds a PostgreSQL transaction-scoped advisory lock while an external side
 * effect is reconciled with database state. Unsupported adapters fail closed.
 */
export async function withDatabaseAdvisoryLock<T>(
  db: D1Database,
  lockKey: number,
  operation: (lockedDb: D1Database) => Promise<T>,
): Promise<T> {
  if (!(db instanceof PostgresD1Database)) {
    throw new Error("Database advisory locks are unavailable");
  }
  return db.withAdvisoryLock(lockKey, operation);
}

export async function ensureDatabase(db: D1Database): Promise<void> {
  if (schemaReady) return;
  if (!schemaInitialization) {
    schemaInitialization = (async () => {
      if (await hasCurrentDatabaseSchema(db)) {
        schemaReady = true;
        return;
      }
      // Separate Vercel instances can cold-start at the same time. PostgreSQL's
      // CREATE TABLE IF NOT EXISTS still races while catalog rows are being
      // created, so serialize the complete bootstrap transaction per database.
      await db.batch([
        db.prepare("SELECT pg_advisory_xact_lock(731202608)"),
        ...schemaStatements.map((statement) => db.prepare(statement)),
      ]);
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

export const SERMON_RESOURCE_DAILY_LIMIT = 20;
const SERMON_RESOURCE_RESERVATION_LEASE_MS = 3 * 60 * 1_000;

export const AI_AGENT_DAILY_LIMIT = 60;
const AI_AGENT_RESERVATION_LEASE_MS = 2 * 60 * 1_000;

export type AiAgentUsageReservation =
  | {
      ok: true;
      userId: string;
      requestId: string;
      usageDate: string;
      dailyLimit: number;
      remainingToday: number;
    }
  | {
      ok: false;
      reason: "daily_limit" | "concurrent";
      usageDate: string;
      dailyLimit: number;
      remainingToday: number;
    };

type AiAgentUsageRow = {
  request_count: number;
  active_request_id: string | null;
  active_started_at: string | null;
};

export type SermonResourceReservation =
  | {
      ok: true;
      userId: string;
      requestId: string;
      usageDate: string;
      dailyLimit: number;
      remainingToday: number;
    }
  | {
      ok: false;
      reason: "daily_limit" | "concurrent";
      usageDate: string;
      dailyLimit: number;
      remainingToday: number;
    };

type SermonResourceUsageRow = {
  request_count: number;
  active_request_id: string | null;
  active_started_at: string | null;
};

function seoulUsageDate(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

/**
 * Counts every provider-bound attempt, including failed or cancelled ones, and
 * grants one concurrent agent slot per user. A killed function cannot hold the
 * slot forever because a later request may replace an expired lease, but that
 * replacement still consumes a new daily use.
 */
export async function reserveAiAgentUsage(
  db: D1Database,
  userId: string,
  dailyLimit = AI_AGENT_DAILY_LIMIT,
): Promise<AiAgentUsageReservation> {
  const now = new Date();
  const nowIso = now.toISOString();
  const usageDate = seoulUsageDate(now);
  const requestId = crypto.randomUUID();
  const staleBefore = new Date(
    now.getTime() - AI_AGENT_RESERVATION_LEASE_MS,
  ).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO ai_agent_usage (
         user_id, usage_date, request_count, active_request_id, active_started_at, updated_at
       ) VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(user_id, usage_date) DO UPDATE SET
         request_count = ai_agent_usage.request_count + 1,
         active_request_id = excluded.active_request_id,
         active_started_at = excluded.active_started_at,
         updated_at = excluded.updated_at
       WHERE ai_agent_usage.request_count < ?
         AND (
           ai_agent_usage.active_request_id IS NULL
           OR ai_agent_usage.active_started_at < ?
         )`,
    )
    .bind(
      userId,
      usageDate,
      requestId,
      nowIso,
      nowIso,
      dailyLimit,
      staleBefore,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT request_count, active_request_id, active_started_at
       FROM ai_agent_usage WHERE user_id = ? AND usage_date = ?`,
    )
    .bind(userId, usageDate)
    .first<AiAgentUsageRow>();
  const requestCount = Math.max(0, Number(row?.request_count ?? 0));
  const remainingToday = Math.max(0, dailyLimit - requestCount);

  if ((result.meta.changes ?? 0) > 0 && row?.active_request_id === requestId) {
    return { userId, requestId, usageDate, dailyLimit, remainingToday, ok: true };
  }
  return {
    ok: false,
    reason: requestCount >= dailyLimit ? "daily_limit" : "concurrent",
    usageDate,
    dailyLimit,
    remainingToday,
  };
}

/** Releases only the matching lease. Daily usage is intentionally never refunded. */
export async function finishAiAgentUsage(
  db: D1Database,
  reservation: Extract<AiAgentUsageReservation, { ok: true }>,
): Promise<void> {
  await db
    .prepare(
      `UPDATE ai_agent_usage SET
         active_request_id = NULL,
         active_started_at = NULL,
         updated_at = ?
       WHERE user_id = ? AND usage_date = ? AND active_request_id = ?`,
    )
    .bind(
      new Date().toISOString(),
      reservation.userId,
      reservation.usageDate,
      reservation.requestId,
    )
    .run();
}

/**
 * Reserves one fair-use request and the user's single concurrent slot atomically.
 * A stale slot is treated as a failed request, so replacing it does not consume
 * another daily use.
 */
export async function reserveSermonResourceUsage(
  db: D1Database,
  userId: string,
  dailyLimit = SERMON_RESOURCE_DAILY_LIMIT,
): Promise<SermonResourceReservation> {
  const now = new Date();
  const nowIso = now.toISOString();
  const usageDate = seoulUsageDate(now);
  const requestId = crypto.randomUUID();
  const staleBefore = new Date(
    now.getTime() - SERMON_RESOURCE_RESERVATION_LEASE_MS,
  ).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO sermon_resource_usage (
         user_id, usage_date, request_count, active_request_id, active_started_at, updated_at
       ) VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(user_id, usage_date) DO UPDATE SET
         request_count = CASE
           WHEN sermon_resource_usage.active_request_id IS NOT NULL
             AND sermon_resource_usage.active_started_at < ?
           THEN sermon_resource_usage.request_count
           ELSE sermon_resource_usage.request_count + 1
         END,
         active_request_id = excluded.active_request_id,
         active_started_at = excluded.active_started_at,
         updated_at = excluded.updated_at
       WHERE (
         sermon_resource_usage.active_request_id IS NULL
         AND sermon_resource_usage.request_count < ?
       ) OR (
         sermon_resource_usage.active_request_id IS NOT NULL
         AND sermon_resource_usage.active_started_at < ?
       )`,
    )
    .bind(
      userId,
      usageDate,
      requestId,
      nowIso,
      nowIso,
      staleBefore,
      dailyLimit,
      staleBefore,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT request_count, active_request_id, active_started_at
       FROM sermon_resource_usage WHERE user_id = ? AND usage_date = ?`,
    )
    .bind(userId, usageDate)
    .first<SermonResourceUsageRow>();
  const requestCount = Math.max(0, Number(row?.request_count ?? 0));
  const remainingToday = Math.max(0, dailyLimit - requestCount);

  if ((result.meta.changes ?? 0) > 0 && row?.active_request_id === requestId) {
    return { ok: true, userId, requestId, usageDate, dailyLimit, remainingToday };
  }
  return {
    ok: false,
    reason: requestCount >= dailyLimit ? "daily_limit" : "concurrent",
    usageDate,
    dailyLimit,
    remainingToday,
  };
}

/** Clears the concurrent slot and refunds the daily use when generation failed. */
export async function finishSermonResourceUsage(
  db: D1Database,
  reservation: Extract<SermonResourceReservation, { ok: true }>,
  failed: boolean,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE sermon_resource_usage SET
         request_count = CASE
           WHEN ? = 1 AND request_count > 0 THEN request_count - 1
           ELSE request_count
         END,
         active_request_id = NULL,
         active_started_at = NULL,
         updated_at = ?
       WHERE user_id = ? AND usage_date = ? AND active_request_id = ?`,
    )
    .bind(
      failed ? 1 : 0,
      nowIso,
      reservation.userId,
      reservation.usageDate,
      reservation.requestId,
    )
    .run();
}
