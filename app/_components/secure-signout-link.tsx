"use client";

import type { ReactNode } from "react";
import { clearAuthSessionMode } from "@/app/_lib/auth-client";

export function SecureSignoutButton({
  children,
  className,
  returnTo = "/",
}: {
  children: ReactNode;
  className?: string;
  returnTo?: string;
}) {
  return (
    <form
      action="/auth/signout"
      method="post"
      className="inline"
      onSubmit={() => {
        clearAuthSessionMode();
      }}
    >
      <input type="hidden" name="return_to" value={returnTo} />
      <button type="submit" className={className}>{children}</button>
    </form>
  );
}
