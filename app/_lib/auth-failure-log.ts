type AuthAccessScope = "identity" | "account_store";

type AuthAccessContext = {
  stage: string;
  elapsedMs: number;
};

function shortIdentifier(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

/**
 * Emits one structured warning when central authentication cannot resolve an
 * account. Only allowlisted identifier fields are read from the error object:
 * free-form fields such as message, detail, hint, query, parameters, or stack
 * can carry connection strings, bind values, or personal data and are never
 * logged. User ids, emails, and session ids are intentionally excluded.
 */
export function logAuthAccessFailure(
  scope: AuthAccessScope,
  error: unknown,
  context: AuthAccessContext,
): void {
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  console.warn("[auth-access]", {
    scope,
    stage: context.stage,
    elapsedMs: context.elapsedMs,
    errorName: shortIdentifier(record.name, 40),
    code: shortIdentifier(record.code, 32),
    severity: shortIdentifier(record.severity, 16),
    routine: shortIdentifier(record.routine, 40),
    status: typeof record.status === "number" ? record.status : undefined,
  });
}
