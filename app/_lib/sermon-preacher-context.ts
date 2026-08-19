import type { SermonPreacherContext } from "./sermon-types.ts";

type SermonContextDatabase = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
    };
  };
};

type SermonPreacherProfileRow = {
  denomination: string | null;
  theology: string | null;
  ministry_role: string | null;
  church: string | null;
};

function safeContextValue(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const withoutControls = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  return withoutControls
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Reads only the allowlisted, non-contact profile fields for the authenticated
 * owner. Callers must pass the server-resolved user id, never a request value.
 */
export async function loadSermonPreacherContext(
  db: SermonContextDatabase | null,
  authenticatedUserId: string,
  isDemo: boolean,
): Promise<SermonPreacherContext | undefined> {
  if (!db || isDemo) return undefined;
  const row = await db
    .prepare(
      `SELECT denomination, theology, ministry_role, church
       FROM user_profiles
       WHERE user_id = ?`,
    )
    .bind(authenticatedUserId)
    .first<SermonPreacherProfileRow>();
  if (!row) return undefined;

  const context: SermonPreacherContext = {
    denomination: safeContextValue(row.denomination, 40),
    theology: safeContextValue(row.theology, 60),
    ministryRole: safeContextValue(row.ministry_role, 40),
    church: safeContextValue(row.church, 60),
  };
  return Object.values(context).some(Boolean) ? context : undefined;
}
