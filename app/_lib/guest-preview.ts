import type { SermonAlternative } from "./sermon-types";

export const GUEST_PREVIEW_COOKIE = "sermon-guide-guest-preview";

export function hasGuestPreviewCookie(request: Request): boolean {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .some((part) => part.trim().split("=", 1)[0] === GUEST_PREVIEW_COOKIE);
}

export function limitedGuestPreview(
  alternatives: SermonAlternative[],
): SermonAlternative[] {
  const first = alternatives[0];
  if (!first) return [];
  return [
    {
      ...first,
      sections: {
        introduction: first.sections.introduction,
        points: first.sections.points.slice(0, 1),
        conclusion: "",
        application: "",
      },
    },
  ];
}

export function guestPreviewCookie(): string {
  return `${GUEST_PREVIEW_COOKIE}=used; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`;
}
