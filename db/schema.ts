import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["preacher", "expert"] }).notNull().default("preacher"),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  statusReason: text("status_reason"),
  suspendedUntil: text("suspended_until"),
  statusChangedAt: text("status_changed_at"),
  statusChangedBy: text("status_changed_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
  lastSeenAt: text("last_seen_at"),
  version: integer("version").notNull().default(0),
}, (table) => [
  uniqueIndex("idx_users_email").on(table.email),
  index("idx_users_created").on(table.createdAt, table.id),
  index("idx_users_status_created").on(table.status, table.createdAt, table.id),
  index("idx_users_role_created").on(table.role, table.createdAt, table.id),
]);

export const userAuthSessions = sqliteTable("user_auth_sessions", {
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  revokedAt: text("revoked_at"),
  revokedBy: text("revoked_by"),
}, (table) => [
  uniqueIndex("idx_user_auth_sessions_user_session").on(table.userId, table.sessionId),
  index("idx_user_auth_sessions_user_revoked").on(table.userId, table.revokedAt),
]);

export const adminAuditLogs = sqliteTable("admin_audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").notNull(),
  targetUserId: text("target_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  reason: text("reason").notNull(),
  beforeJson: text("before_json").notNull().default("{}"),
  afterJson: text("after_json").notNull().default("{}"),
  requestId: text("request_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_admin_audit_logs_target_created").on(table.targetUserId, table.createdAt),
  index("idx_admin_audit_logs_actor_created").on(table.actorUserId, table.createdAt),
  uniqueIndex("idx_admin_audit_logs_request").on(table.requestId),
]);

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  ministryRole: text("ministry_role").notNull().default("담임목사"),
  denomination: text("denomination").notNull().default(""),
  theology: text("theology").notNull().default(""),
  church: text("church").notNull().default(""),
  phone: text("phone").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const userAiPreferences = sqliteTable("user_ai_preferences", {
  userId: text("user_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  engine: text("engine", {
    enum: ["openai", "anthropic", "gemini", "openrouter", "custom"],
  }).notNull().default("openai"),
  endpoint: text("endpoint").notNull(),
  model: text("model").notNull(),
  reasoningEffort: text("reasoning_effort").notNull().default("low"),
  updatedAt: text("updated_at").notNull(),
});

export const globalAiSettings = sqliteTable("global_ai_settings", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  engine: text("engine", {
    enum: ["openai", "anthropic", "gemini", "openrouter", "deepseek", "custom"],
  }).notNull().default("openai"),
  endpoint: text("endpoint").notNull(),
  model: text("model").notNull(),
  reasoningEffort: text("reasoning_effort").notNull().default("low"),
  maxOutputTokens: integer("max_output_tokens"),
  apiKeyEncrypted: text("api_key_encrypted"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const managedAiUsage = sqliteTable("managed_ai_usage", {
  userId: text("user_id").notNull(),
  usageDate: text("usage_date").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_managed_ai_usage_user_date").on(table.userId, table.usageDate),
]);

export const aiAgentUsage = sqliteTable("ai_agent_usage", {
  userId: text("user_id").notNull(),
  usageDate: text("usage_date").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  activeRequestId: text("active_request_id"),
  activeStartedAt: text("active_started_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_ai_agent_usage_user_date").on(table.userId, table.usageDate),
]);

export const sermonResourceUsage = sqliteTable("sermon_resource_usage", {
  userId: text("user_id").notNull(),
  usageDate: text("usage_date").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  activeRequestId: text("active_request_id"),
  activeStartedAt: text("active_started_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sermon_resource_usage_user_date").on(table.userId, table.usageDate),
]);

export const tokenWallets = sqliteTable("token_wallets", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(200),
  lifetimePurchased: integer("lifetime_purchased").notNull().default(0),
  lifetimeSpent: integer("lifetime_spent").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tokenTransactions = sqliteTable("token_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind", {
    enum: ["welcome", "topup", "generation", "agent", "refund", "admin_adjustment"],
  }).notNull(),
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  referenceId: text("reference_id").notNull(),
  description: text("description").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_token_transactions_reference").on(table.referenceId),
  index("idx_token_transactions_user_created").on(table.userId, table.createdAt),
]);

export const tokenAdjustments = sqliteTable("token_adjustments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  transactionId: text("transaction_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_token_adjustments_idempotency").on(table.idempotencyKey),
  uniqueIndex("idx_token_adjustments_transaction").on(table.transactionId),
  index("idx_token_adjustments_user_created").on(table.userId, table.createdAt),
]);

export const tokenTopups = sqliteTable("token_topups", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  usdCents: integer("usd_cents").notNull(),
  tokenAmount: integer("token_amount").notNull(),
  status: text("status", {
    enum: ["pending", "processing", "completed", "failed", "cancelled"],
  }).notNull().default("pending"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("idx_token_topups_checkout_session").on(table.stripeCheckoutSessionId),
  index("idx_token_topups_user_created").on(table.userId, table.createdAt),
  index("idx_token_topups_status").on(table.status),
]);

export const paymentOrders = sqliteTable("payment_orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  paymentId: text("payment_id").notNull(),
  provider: text("provider").notNull().default("portone"),
  paymentMethod: text("payment_method", {
    enum: ["card", "kakaopay", "naverpay"],
  }).notNull(),
  amountKrw: integer("amount_krw").notNull(),
  tokenAmount: integer("token_amount").notNull(),
  status: text("status", {
    enum: ["pending", "processing", "completed", "failed", "cancelled"],
  }).notNull().default("pending"),
  transactionId: text("transaction_id"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("idx_payment_orders_payment_id").on(table.paymentId),
  index("idx_payment_orders_user_created").on(table.userId, table.createdAt),
  index("idx_payment_orders_status").on(table.status),
]);

export const sermonDrafts = sqliteTable("sermon_drafts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  topic: text("topic").notNull(),
  scripture: text("scripture").notNull().default(""),
  sermonType: text("sermon_type").notNull(),
  audience: text("audience").notNull(),
  audienceSituation: text("audience_situation").notNull().default("일반"),
  pointCount: integer("point_count").notNull(),
  duration: integer("duration").notNull(),
  emotion: text("emotion").notNull(),
  referenceMode: text("reference_mode").notNull().default("auto"),
  status: text("status").notNull().default("options_valid"),
  activeGenerationId: text("active_generation_id"),
  selectedAlternativeId: text("selected_alternative_id"),
  revisionCount: integer("revision_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_sermon_drafts_user_updated").on(table.userId, table.updatedAt),
  index("idx_sermon_drafts_status").on(table.status),
]);

export const sermonAlternatives = sqliteTable("sermon_alternatives", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull(),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  scripture: text("scripture").notNull(),
  introduction: text("introduction").notNull(),
  bodyJson: text("body_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_alternatives_draft_position").on(table.draftId, table.position),
  index("idx_alternatives_draft").on(table.draftId),
]);

export const sermonGenerationRuns = sqliteTable("sermon_generation_runs", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull(),
  userId: text("user_id").notNull(),
  expectedCount: integer("expected_count").notNull(),
  aiSignature: text("ai_signature").notNull(),
  managedAllowed: integer("managed_allowed").notNull().default(-1),
  status: text("status").notNull().default("generating"),
  provider: text("provider").notNull().default("pending"),
  model: text("model"),
  reasoningEffort: text("reasoning_effort"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sermonGenerationItems = sqliteTable("sermon_generation_items", {
  id: text("id").primaryKey(),
  generationId: text("generation_id").notNull(),
  position: integer("position").notNull(),
  alternativeJson: text("alternative_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_generation_items_run_position").on(
    table.generationId,
    table.position,
  ),
]);

export const sermonGenerationClaims = sqliteTable("sermon_generation_claims", {
  id: text("id").primaryKey(),
  generationId: text("generation_id").notNull(),
  position: integer("position").notNull(),
  leaseToken: text("lease_token").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_generation_claims_run_position").on(
    table.generationId,
    table.position,
  ),
]);

export const sermonGenerationParts = sqliteTable("sermon_generation_parts", {
  id: text("id").primaryKey(),
  generationId: text("generation_id").notNull(),
  position: integer("position").notNull(),
  step: integer("step").notNull(),
  partJson: text("part_json").notNull(),
  provider: text("provider").notNull(),
  model: text("model"),
  reasoningEffort: text("reasoning_effort"),
  elapsedMs: integer("elapsed_ms").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_generation_parts_run_position_step").on(
    table.generationId,
    table.position,
    table.step,
  ),
]);

export const sermonVersions = sqliteTable("sermon_versions", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  instruction: text("instruction").notNull().default(""),
  title: text("title").notNull(),
  bodyJson: text("body_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_versions_draft_number").on(table.draftId, table.versionNumber),
]);

export const sermons = sqliteTable("sermons", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  draftId: text("draft_id"),
  title: text("title").notNull(),
  scripture: text("scripture").notNull(),
  sermonType: text("sermon_type").notNull(),
  audience: text("audience").notNull(),
  audienceSituation: text("audience_situation").notNull().default("일반"),
  pointCount: integer("point_count").notNull(),
  duration: integer("duration").notNull(),
  emotion: text("emotion").notNull(),
  bodyJson: text("body_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("idx_sermons_draft").on(table.draftId),
  index("idx_sermons_user_created").on(table.userId, table.createdAt),
  index("idx_sermons_user_title").on(table.userId, table.title),
]);

export const notificationPreferences = sqliteTable("notification_preferences", {
  userId: text("user_id").primaryKey(),
  emailEnabled: integer("email_enabled", { mode: "boolean" }).notNull().default(true),
  pushEnabled: integer("push_enabled", { mode: "boolean" }).notNull().default(false),
  completionEnabled: integer("completion_enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
});

export const consultations = sqliteTable("consultations", {
  id: text("id").primaryKey(),
  sermonId: text("sermon_id").notNull(),
  userId: text("user_id").notNull(),
  expertId: text("expert_id"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("waiting"),
  queuePosition: integer("queue_position").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_consultations_sermon_user").on(table.sermonId, table.userId),
  index("idx_consultations_user_updated").on(table.userId, table.updatedAt),
  index("idx_consultations_expert_status").on(table.expertId, table.status),
]);

export const consultationMessages = sqliteTable("consultation_messages", {
  id: text("id").primaryKey(),
  consultationId: text("consultation_id").notNull(),
  senderId: text("sender_id").notNull(),
  senderRole: text("sender_role").notNull(),
  body: text("body").notNull(),
  section: text("section"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_messages_consultation_created").on(table.consultationId, table.createdAt)]);

export const notificationDeliveries = sqliteTable("notification_deliveries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sermonId: text("sermon_id"),
  channel: text("channel").notNull(),
  status: text("status").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  error: text("error"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_deliveries_user_created").on(table.userId, table.createdAt)]);
