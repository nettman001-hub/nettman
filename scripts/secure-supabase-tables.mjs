import postgres from "postgres";

const protectedTables = [
  "users",
  "user_profiles",
  "user_ai_preferences",
  "managed_ai_usage",
  "sermon_resource_usage",
  "token_wallets",
  "token_transactions",
  "token_topups",
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
];

const databaseUrl =
  process.env.POSTGRES_URL?.trim() ||
  process.env.POSTGRES_URL_NON_POOLING?.trim();

if (!databaseUrl || databaseUrl.startsWith("[")) {
  console.log("Database security bootstrap skipped: no deployment database URL.");
  process.exit(0);
}

const sql = postgres(databaseUrl, {
  connect_timeout: 10,
  idle_timeout: 10,
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(731202608)`;

    for (const table of protectedTables) {
      await transaction.unsafe(
        `ALTER TABLE IF EXISTS public."${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
  });

  console.log("Supabase application tables are protected by RLS.");
} finally {
  await sql.end({ timeout: 5 });
}
