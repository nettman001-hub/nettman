"use client";

import { useEffect } from "react";

const LEGACY_AI_STORAGE_PREFIX = "sermon-guide:ai-";

function clearLegacyAiStorage(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_AI_STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

export function AiSessionBoundary() {
  useEffect(() => {
    try {
      clearLegacyAiStorage(window.sessionStorage);
      clearLegacyAiStorage(window.localStorage);
    } catch {
      // Storage-blocked browsers have no readable legacy AI settings to clear.
    }
  }, []);

  return null;
}
