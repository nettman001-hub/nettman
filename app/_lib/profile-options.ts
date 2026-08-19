export const MINISTRY_ROLE_OPTIONS = [
  "담임목사",
  "부목사",
  "전도사",
  "강도사",
  "교회학교 교사",
  "기타 사역자",
] as const;

export type MinistryRole = (typeof MINISTRY_ROLE_OPTIONS)[number];

export const DENOMINATION_OPTIONS = [
  "장로교",
  "감리교",
  "성결교",
  "순복음",
  "침례교",
] as const;

export type Denomination = (typeof DENOMINATION_OPTIONS)[number];

export const THEOLOGY_OPTIONS: Record<Denomination, readonly string[]> = {
  장로교: ["총신", "장신", "백석", "고신", "기장"],
  감리교: ["감신", "목원", "협성"],
  성결교: ["서울신학", "성결"],
  순복음: ["한세", "순복음총회"],
  침례교: ["침례신학"],
};

export function isMinistryRole(value: unknown): value is MinistryRole {
  return (
    typeof value === "string" &&
    MINISTRY_ROLE_OPTIONS.some((option) => option === value)
  );
}

export function isDenomination(value: unknown): value is Denomination {
  return (
    typeof value === "string" &&
    DENOMINATION_OPTIONS.some((option) => option === value)
  );
}

export function theologyOptionsForDenomination(value: unknown): readonly string[] {
  return isDenomination(value) ? THEOLOGY_OPTIONS[value] : [];
}

export function isTheologyForDenomination(
  denomination: unknown,
  theology: unknown,
): boolean {
  return (
    typeof theology === "string" &&
    theologyOptionsForDenomination(denomination).some((option) => option === theology)
  );
}

export function isValidTheologySelection(
  denomination: unknown,
  theology: unknown,
): boolean {
  if (denomination === "" && theology === "") return true;
  return isTheologyForDenomination(denomination, theology);
}
