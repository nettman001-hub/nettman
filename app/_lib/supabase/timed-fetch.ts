export const SUPABASE_FETCH_TIMEOUT_MS = 12_000;

/**
 * Bounds Supabase network requests without discarding a cancellation signal
 * supplied by the caller or carried by an existing Request.
 */
export const timedSupabaseFetch: typeof fetch = (input, init) => {
  const deadline = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
  const callerSignal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, deadline])
    : deadline;

  return globalThis.fetch(input, {
    ...init,
    signal,
  });
};
