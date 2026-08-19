export const MEMBER_ROLES = ["preacher", "expert"] as const;
export const MEMBER_STATUSES = ["active", "suspended"] as const;
export const MEMBER_PROFILE_FILTERS = ["complete", "incomplete"] as const;
export const MEMBER_SORTS = [
  "registered_desc",
  "activity_desc",
  "tokens_desc",
  "name_asc",
] as const;
export const MEMBER_DENOMINATIONS = [
  "장로교",
  "감리교",
  "성결교",
  "순복음",
  "침례교",
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export type MemberListFilters = {
  query: string;
  role: "all" | MemberRole;
  status: "all" | MemberStatus;
  denomination: "all" | (typeof MEMBER_DENOMINATIONS)[number];
  profile: "all" | (typeof MEMBER_PROFILE_FILTERS)[number];
  sort: (typeof MEMBER_SORTS)[number];
  page: number;
};

export type MemberListItem = {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  statusReason: string;
  version: number;
  ministryRole: string;
  denomination: string;
  theology: string;
  church: string;
  sermonCount: number;
  consultationCount: number;
  tokenBalance: number;
  createdAt: string;
  lastActiveAt: string;
  suspendedUntil: string;
};

export type MemberListStats = {
  total: number | null;
  active: number | null;
  suspended: number | null;
  experts: number | null;
};

export type MembersListResponse = {
  items: MemberListItem[];
  stats: MemberListStats;
  total: number;
  page: number;
  limit: number;
  nextCursor: string;
};

export type MemberActivity = {
  sermonCount: number;
  draftCount: number;
  generationCount: number;
  consultationCount: number;
  activeConsultationCount: number;
  aiRequestCount: number;
  resourceRequestCount: number;
  lastActiveAt: string;
};

export type MemberWallet = {
  balance: number;
  lifetimePurchased: number;
  lifetimeSpent: number;
};

export type MemberAuth = {
  available: boolean;
  configured: boolean;
  mailAvailable: boolean;
  privilegedAvailable: boolean;
  emailVerified: boolean | null;
  lastSignInAt: string;
  providers: string[];
  sessionCount: number | null;
  status: MemberStatus;
  suspendedUntil: string;
};

export type MemberPayment = {
  id: string;
  paymentId: string;
  provider: string;
  paymentMethod: string;
  amountKrw: number;
  usdCents: number;
  tokenAmount: number;
  status: string;
  createdAt: string;
  completedAt: string;
  reverifiable: boolean;
};

export type MemberTokenTransaction = {
  id: string;
  kind: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
};

export type MemberConsultation = {
  id: string;
  sermonTitle: string;
  status: string;
  expertName: string;
  createdAt: string;
  updatedAt: string;
};

export type MemberSermon = {
  id: string;
  title: string;
  scripture: string;
  sermonType: string;
  audience: string;
  audienceSituation: string;
  duration: number;
  createdAt: string;
  updatedAt: string;
};

export type MemberAudit = {
  id: string;
  action: string;
  reason: string;
  actor: string;
  createdAt: string;
  summary: string;
};

export type MemberDetail = MemberListItem & {
  phone: string;
  activity: MemberActivity;
  wallet: MemberWallet;
  auth: MemberAuth;
  payments: MemberPayment[];
  tokenTransactions: MemberTokenTransaction[];
  sermons: MemberSermon[];
  consultations: MemberConsultation[];
  audits: MemberAudit[];
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function recordFrom(parent: UnknownRecord, ...keys: string[]): UnknownRecord {
  for (const key of keys) {
    const candidate = record(parent[key]);
    if (Object.keys(candidate).length) return candidate;
  }
  return {};
}

function arrayFrom(parent: UnknownRecord, ...keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(parent[key])) return parent[key];
  }
  return [];
}

function stringFrom(parent: UnknownRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = parent[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberFrom(parent: UnknownRecord, ...keys: string[]): number {
  for (const key of keys) {
    const value = parent[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function nullableNumberFrom(
  parent: UnknownRecord,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    if (!(key in parent)) continue;
    const value = parent[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function booleanFrom(parent: UnknownRecord, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = parent[key];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }
  return null;
}

function memberRole(value: unknown): MemberRole {
  return value === "expert" ? "expert" : "preacher";
}

function memberStatus(parent: UnknownRecord): MemberStatus {
  const raw = stringFrom(
    parent,
    "status",
    "memberStatus",
    "member_status",
    "accountStatus",
    "account_status",
  ).toLowerCase();
  const suspended = booleanFrom(parent, "suspended", "isSuspended", "is_suspended");
  return suspended === true || ["suspended", "blocked", "banned", "disabled"].includes(raw)
    ? "suspended"
    : "active";
}

function sourcePayload(value: unknown): UnknownRecord {
  const root = record(value);
  const data = record(root.data);
  return Object.keys(data).length ? data : root;
}

export function parseMemberListItem(value: unknown): MemberListItem | null {
  const item = record(value);
  const profile = recordFrom(item, "profile", "userProfile", "user_profile");
  const activity = recordFrom(item, "activity", "counts", "usage");
  const wallet = recordFrom(item, "wallet", "tokenWallet", "token_wallet");
  const auth = recordFrom(item, "auth", "authentication");
  const id = stringFrom(item, "id", "userId", "user_id");
  if (!id) return null;

  return {
    id,
    name:
      stringFrom(profile, "displayName", "display_name", "name") ||
      stringFrom(item, "displayName", "display_name", "name") ||
      "이름 미등록",
    email: stringFrom(item, "email"),
    role: memberRole(item.role),
    status: memberStatus({ ...auth, ...item }),
    statusReason: stringFrom(item, "statusReason", "status_reason"),
    version: Math.max(0, Math.trunc(numberFrom(item, "version"))),
    ministryRole:
      stringFrom(profile, "ministryRole", "ministry_role", "role") ||
      stringFrom(item, "ministryRole", "ministry_role"),
    denomination:
      stringFrom(profile, "denomination") || stringFrom(item, "denomination"),
    theology: stringFrom(profile, "theology") || stringFrom(item, "theology"),
    church: stringFrom(profile, "church") || stringFrom(item, "church"),
    sermonCount:
      numberFrom(activity, "sermonCount", "sermon_count", "sermons") ||
      numberFrom(item, "sermonCount", "sermon_count"),
    consultationCount:
      numberFrom(activity, "consultationCount", "consultation_count", "consultations") ||
      numberFrom(activity, "consultationsRequested", "consultations_requested") +
        numberFrom(activity, "consultationsAssigned", "consultations_assigned") ||
      numberFrom(item, "consultationCount", "consultation_count") +
        numberFrom(
          item,
          "expertConsultationCount",
          "expert_consultation_count",
        ),
    tokenBalance:
      numberFrom(wallet, "balance", "tokenBalance", "token_balance") ||
      numberFrom(item, "tokenBalance", "token_balance", "balance"),
    createdAt: stringFrom(
      item,
      "createdAt",
      "created_at",
      "registeredAt",
      "registered_at",
      "serviceRegisteredAt",
      "service_registered_at",
    ),
    lastActiveAt:
      stringFrom(activity, "lastActiveAt", "last_active_at", "lastSeenAt", "last_seen_at") ||
      stringFrom(
        item,
        "lastActiveAt",
        "last_active_at",
        "lastSeenAt",
        "last_seen_at",
        "updatedAt",
        "updated_at",
      ),
    suspendedUntil:
      stringFrom(auth, "suspendedUntil", "suspended_until", "bannedUntil", "banned_until") ||
      stringFrom(item, "suspendedUntil", "suspended_until", "bannedUntil", "banned_until"),
  };
}

export function parseMembersListResponse(value: unknown): MembersListResponse {
  const payload = sourcePayload(value);
  const pagination = recordFrom(payload, "pagination", "pageInfo", "page_info");
  const summary = recordFrom(payload, "stats", "summary", "totals");
  const items = arrayFrom(payload, "items", "members", "users")
    .map(parseMemberListItem)
    .filter((item): item is MemberListItem => Boolean(item));
  const total =
    nullableNumberFrom(pagination, "total", "totalItems", "total_items") ??
    nullableNumberFrom(payload, "total", "totalMembers", "total_members") ??
    nullableNumberFrom(summary, "total", "totalMembers", "total_members") ??
    items.length;

  return {
    items,
    stats: {
      total:
        nullableNumberFrom(summary, "total", "totalMembers", "total_members") ?? total,
      active: nullableNumberFrom(summary, "active", "activeMembers", "active_members"),
      suspended: nullableNumberFrom(
        summary,
        "suspended",
        "suspendedMembers",
        "suspended_members",
      ),
      experts: nullableNumberFrom(summary, "experts", "expertCount", "expert_count"),
    },
    total: Math.max(0, Math.trunc(total)),
    page: Math.max(
      1,
      Math.trunc(
        nullableNumberFrom(pagination, "page", "currentPage", "current_page") ??
          nullableNumberFrom(payload, "page") ??
          1,
      ),
    ),
    limit: Math.max(
      1,
      Math.trunc(
        nullableNumberFrom(pagination, "limit", "pageSize", "page_size") ??
          nullableNumberFrom(payload, "limit") ??
          20,
      ),
    ),
    nextCursor: stringFrom(pagination, "nextCursor", "next_cursor"),
  };
}

function parsePayment(value: unknown): MemberPayment | null {
  const item = record(value);
  const id = stringFrom(item, "id", "paymentId", "payment_id");
  if (!id) return null;
  return {
    id,
    paymentId: stringFrom(item, "paymentId", "payment_id") || id,
    provider: stringFrom(item, "provider"),
    paymentMethod: stringFrom(item, "paymentMethod", "payment_method", "method"),
    amountKrw: numberFrom(item, "amountKrw", "amount_krw", "amount"),
    usdCents: numberFrom(item, "usdCents", "usd_cents"),
    tokenAmount: numberFrom(item, "tokenAmount", "token_amount", "tokens"),
    status: stringFrom(item, "status") || "unknown",
    createdAt: stringFrom(item, "createdAt", "created_at"),
    completedAt: stringFrom(item, "completedAt", "completed_at"),
    reverifiable:
      booleanFrom(item, "reverifiable") ??
      (stringFrom(item, "provider").toLowerCase() === "portone"),
  };
}

function parseConsultation(value: unknown): MemberConsultation | null {
  const item = record(value);
  const id = stringFrom(item, "id");
  if (!id) return null;
  return {
    id,
    sermonTitle: stringFrom(item, "sermonTitle", "sermon_title", "title") || "설교 피드백",
    status: stringFrom(item, "status") || "waiting",
    expertName: stringFrom(item, "expertName", "expert_name"),
    createdAt: stringFrom(item, "createdAt", "created_at"),
    updatedAt: stringFrom(item, "updatedAt", "updated_at"),
  };
}

function parseSermon(value: unknown): MemberSermon | null {
  const item = record(value);
  const id = stringFrom(item, "id", "sermonId", "sermon_id");
  if (!id) return null;
  return {
    id,
    title: stringFrom(item, "title", "sermonTitle", "sermon_title") || "제목 미등록",
    scripture: stringFrom(item, "scripture", "scriptureReference", "scripture_reference"),
    sermonType: stringFrom(item, "sermonType", "sermon_type", "type"),
    audience: stringFrom(item, "audience", "targetAudience", "target_audience"),
    audienceSituation: stringFrom(
      item,
      "audienceSituation",
      "audience_situation",
    ),
    duration: Math.max(0, Math.trunc(numberFrom(item, "duration", "durationMinutes", "duration_minutes"))),
    createdAt: stringFrom(item, "createdAt", "created_at"),
    updatedAt: stringFrom(item, "updatedAt", "updated_at"),
  };
}

function parseTokenTransaction(value: unknown): MemberTokenTransaction | null {
  const item = record(value);
  const id = stringFrom(item, "id");
  if (!id) return null;
  return {
    id,
    kind: stringFrom(item, "kind", "type") || "adjustment",
    amount: numberFrom(item, "amount"),
    balanceAfter: numberFrom(item, "balanceAfter", "balance_after"),
    description: stringFrom(item, "description", "reason"),
    createdAt: stringFrom(item, "createdAt", "created_at"),
  };
}

function parseAudit(value: unknown): MemberAudit | null {
  const item = record(value);
  const id = stringFrom(item, "id") || `${stringFrom(item, "createdAt", "created_at")}:${stringFrom(item, "action")}`;
  if (!id || id === ":") return null;
  const actor = recordFrom(item, "actor", "admin");
  return {
    id,
    action: stringFrom(item, "action", "type") || "관리 작업",
    reason: stringFrom(item, "reason"),
    actor:
      stringFrom(
        item,
        "actorName",
        "actor_name",
        "adminName",
        "admin_name",
        "actorUserId",
        "actor_user_id",
      ) ||
      stringFrom(actor, "name", "email") ||
      "관리자",
    createdAt: stringFrom(item, "createdAt", "created_at"),
    summary: stringFrom(item, "summary", "description", "message"),
  };
}

export function parseMemberDetailResponse(value: unknown): MemberDetail | null {
  const payload = sourcePayload(value);
  const memberSource = recordFrom(payload, "member", "item", "user");
  const member = parseMemberListItem(
    Object.keys(memberSource).length ? memberSource : payload,
  );
  if (!member) return null;

  const profile = recordFrom(memberSource, "profile", "userProfile", "user_profile");
  const activity = recordFrom(payload, "activity", "usage", "counts");
  const memberActivity = recordFrom(memberSource, "activity", "usage", "counts");
  const wallet = recordFrom(payload, "wallet", "tokenWallet", "token_wallet");
  const memberWallet = recordFrom(memberSource, "wallet", "tokenWallet", "token_wallet");
  const auth = recordFrom(payload, "auth", "authentication");
  const memberAuth = recordFrom(memberSource, "auth", "authentication");
  const activitySource = { ...memberActivity, ...activity };
  const walletSource = { ...memberWallet, ...wallet };
  const authSource = { ...memberAuth, ...auth };

  return {
    ...member,
    phone:
      stringFrom(profile, "phone") ||
      stringFrom(memberSource, "phone") ||
      stringFrom(payload, "phone"),
    activity: {
      sermonCount:
        numberFrom(activitySource, "sermonCount", "sermon_count", "sermons") ||
        member.sermonCount,
      draftCount: numberFrom(activitySource, "draftCount", "draft_count", "drafts"),
      generationCount: numberFrom(
        activitySource,
        "generationCount",
        "generation_count",
        "generations",
      ),
      consultationCount:
        numberFrom(activitySource, "consultationCount", "consultation_count") ||
        numberFrom(activitySource, "consultations") +
          numberFrom(
            activitySource,
            "expertConsultations",
            "expert_consultations",
          ) ||
        numberFrom(
          activitySource,
          "consultationsRequested",
          "consultations_requested",
        ) +
          numberFrom(
            activitySource,
            "consultationsAssigned",
            "consultations_assigned",
          ) ||
        member.consultationCount,
      activeConsultationCount: numberFrom(
        activitySource,
        "activeConsultationCount",
        "active_consultation_count",
        "activeExpertConsultations",
        "active_expert_consultations",
      ),
      aiRequestCount: numberFrom(
        activitySource,
        "aiRequestCount",
        "ai_request_count",
        "managedAiRequests",
        "managedAiToday",
        "managed_ai_today",
      ),
      resourceRequestCount: numberFrom(
        activitySource,
        "resourceRequestCount",
        "resource_request_count",
        "resourceRequests",
        "resourcesToday",
        "resources_today",
      ),
      lastActiveAt:
        stringFrom(
          activitySource,
          "lastActiveAt",
          "last_active_at",
          "lastSeenAt",
          "last_seen_at",
        ) || member.lastActiveAt,
    },
    wallet: {
      balance: numberFrom(walletSource, "balance", "tokenBalance", "token_balance"),
      lifetimePurchased: numberFrom(
        walletSource,
        "lifetimePurchased",
        "lifetime_purchased",
      ),
      lifetimeSpent: numberFrom(walletSource, "lifetimeSpent", "lifetime_spent"),
    },
    auth: {
      available: booleanFrom(authSource, "available") === true,
      configured: booleanFrom(authSource, "configured") === true,
      mailAvailable:
        booleanFrom(authSource, "mailAvailable", "mail_available") ??
        booleanFrom(authSource, "available", "configured") === true,
      privilegedAvailable:
        booleanFrom(
          authSource,
          "privilegedAvailable",
          "privileged_available",
        ) ?? booleanFrom(authSource, "available", "configured") === true,
      emailVerified: booleanFrom(
        authSource,
        "emailVerified",
        "email_verified",
        "emailConfirmed",
        "email_confirmed",
      ),
      lastSignInAt: stringFrom(authSource, "lastSignInAt", "last_sign_in_at"),
      providers: arrayFrom(authSource, "providers", "identities")
        .map((provider) =>
          typeof provider === "string"
            ? provider
            : stringFrom(record(provider), "provider", "name"),
        )
        .filter(Boolean),
      sessionCount:
        nullableNumberFrom(authSource, "sessionCount", "session_count") ??
        (Array.isArray(authSource.sessions) ? authSource.sessions.length : null),
      status: memberStatus({ ...authSource, status: member.status }),
      suspendedUntil:
        stringFrom(
          authSource,
          "suspendedUntil",
          "suspended_until",
          "bannedUntil",
          "banned_until",
        ) || member.suspendedUntil,
    },
    payments: (() => {
      const paymentContainer = payload.payments;
      const direct = Array.isArray(paymentContainer)
        ? paymentContainer
        : [
            ...arrayFrom(record(paymentContainer), "portone"),
            ...arrayFrom(record(paymentContainer), "stripe"),
          ];
      const legacy = arrayFrom(payload, "legacyTopups", "legacy_topups").map(
        (item) => ({
          ...record(item),
          provider: "stripe",
          paymentMethod: "Stripe",
          paymentId:
            stringFrom(record(item), "checkoutSessionId", "checkout_session_id") ||
            stringFrom(record(item), "id"),
          reverifiable: false,
        }),
      );
      return [
        ...direct,
        ...arrayFrom(payload, "paymentOrders", "payment_orders"),
        ...legacy,
      ]
      .map(parsePayment)
      .filter((item): item is MemberPayment => Boolean(item));
    })(),
    tokenTransactions: [
      ...arrayFrom(payload, "tokenHistory", "token_history"),
      ...arrayFrom(payload, "tokenTransactions", "token_transactions"),
      ...arrayFrom(payload, "tokenAdjustments", "token_adjustments"),
    ]
      .map(parseTokenTransaction)
      .filter((item): item is MemberTokenTransaction => Boolean(item)),
    sermons: arrayFrom(payload, "sermons", "recentSermons", "recent_sermons")
      .map(parseSermon)
      .filter((item): item is MemberSermon => Boolean(item)),
    consultations: (() => {
      const consultationContainer = payload.consultations;
      const direct = Array.isArray(consultationContainer)
        ? consultationContainer
        : [
            ...arrayFrom(record(consultationContainer), "requested"),
            ...arrayFrom(record(consultationContainer), "assigned"),
          ];
      return [...direct, ...arrayFrom(payload, "feedback", "feedbacks")]
      .map(parseConsultation)
      .filter((item): item is MemberConsultation => Boolean(item));
    })(),
    audits: arrayFrom(
      payload,
      "audit",
      "audits",
      "auditLog",
      "audit_log",
      "auditLogs",
      "audit_logs",
    )
      .map(parseAudit)
      .filter((item): item is MemberAudit => Boolean(item)),
  };
}

export function apiErrorMessage(value: unknown, fallback: string): string {
  const payload = sourcePayload(value);
  return stringFrom(payload, "error", "message") || fallback;
}
