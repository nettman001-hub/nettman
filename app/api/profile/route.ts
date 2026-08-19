import { ensureDatabase, getD1 } from "../../../db";
import {
  isMinistryRole,
  isValidTheologySelection,
} from "../../_lib/profile-options";
import { getRequestUserResponse, unauthorizedResponse } from "../../_lib/auth-user";

type ProfilePayload = {
  displayName?: unknown;
  ministryRole?: unknown;
  /** 이전 클라이언트가 보내던 사역 역할 키입니다. */
  role?: unknown;
  denomination?: unknown;
  theology?: unknown;
  church?: unknown;
  phone?: unknown;
};

type ProfileRow = {
  display_name: string;
  ministry_role: string;
  denomination: string;
  theology: string;
  church: string;
  phone: string;
};

function optionalTrimmedString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value.trim() : null;
}

function profileResponse(
  user: { email: string; name: string },
  row?: ProfileRow | null,
) {
  const ministryRole = row?.ministry_role ?? "담임목사";
  return {
    displayName: row?.display_name ?? user.name,
    ministryRole,
    // GET 응답도 한동안 기존 클라이언트와 호환합니다.
    role: ministryRole,
    denomination: row?.denomination ?? "",
    theology: row?.theology ?? "",
    church: row?.church ?? "",
    email: user.email,
    phone: row?.phone ?? "",
  };
}

export async function GET(request: Request) {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const db = getD1();
  if (!db) return Response.json({ ...profileResponse(user), demo: true });
  await ensureDatabase(db);
  const row = await db
    .prepare(
      `SELECT display_name, ministry_role, denomination, theology, church, phone
       FROM user_profiles
       WHERE user_id = ?`,
    )
    .bind(user.id)
    .first<ProfileRow>();
  return Response.json(profileResponse(user, row));
}

export async function PUT(request: Request) {
  const auth = await getRequestUserResponse(request);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if (!user) return unauthorizedResponse();
  const rawPayload = await request.json().catch(() => null);
  const payload =
    rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
      ? (rawPayload as ProfilePayload)
      : null;

  const displayName = optionalTrimmedString(payload?.displayName) ?? "";
  const ministryRole =
    optionalTrimmedString(payload?.ministryRole ?? payload?.role) ?? "";
  const church = optionalTrimmedString(payload?.church) ?? "";
  const denominationInput = optionalTrimmedString(payload?.denomination);
  const theologyInput = optionalTrimmedString(payload?.theology);
  const phoneInput = optionalTrimmedString(payload?.phone);

  if (displayName.length < 2 || displayName.length > 40) {
    return Response.json(
      { error: "이름을 2자 이상 40자 이하로 입력해 주세요." },
      { status: 400 },
    );
  }
  if (!isMinistryRole(ministryRole) || church.length > 60) {
    return Response.json(
      { error: "사역 역할과 교회 이름을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (
    denominationInput === null ||
    theologyInput === null ||
    phoneInput === null
  ) {
    return Response.json({ error: "프로필 입력값을 확인해 주세요." }, { status: 400 });
  }

  const db = getD1();
  let existing: ProfileRow | null = null;
  if (db) {
    await ensureDatabase(db);
    existing = await db
      .prepare(
        `SELECT display_name, ministry_role, denomination, theology, church, phone
         FROM user_profiles
         WHERE user_id = ?`,
      )
      .bind(user.id)
      .first<ProfileRow>();
  }

  // 새 필드를 모르는 이전 클라이언트의 PUT은 이미 저장된 값을 지우지 않습니다.
  const denomination = denominationInput ?? existing?.denomination ?? "";
  const theology = theologyInput ?? existing?.theology ?? "";
  const phone = phoneInput ?? existing?.phone ?? "";

  if (!isValidTheologySelection(denomination, theology)) {
    return Response.json(
      { error: "선택한 교단에 맞는 신학 설정을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (phone.length > 40) {
    return Response.json(
      { error: "연락처는 40자 이하로 입력해 주세요." },
      { status: 400 },
    );
  }

  const row: ProfileRow = {
    display_name: displayName,
    ministry_role: ministryRole,
    denomination,
    theology,
    church,
    phone,
  };
  const result = profileResponse(user, row);
  if (!db) return Response.json({ ...result, demo: true });

  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name",
      )
      .bind(user.id, user.email, displayName, user.role, now),
    db
      .prepare(
        `INSERT INTO user_profiles
          (user_id, display_name, ministry_role, denomination, theology, church, phone, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
          display_name=excluded.display_name,
          ministry_role=excluded.ministry_role,
          denomination=excluded.denomination,
          theology=excluded.theology,
          church=excluded.church,
          phone=excluded.phone,
          updated_at=excluded.updated_at`,
      )
      .bind(
        user.id,
        displayName,
        ministryRole,
        denomination,
        theology,
        church,
        phone,
        now,
      ),
  ]);
  return Response.json(result);
}
