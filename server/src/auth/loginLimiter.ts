// Slows down password guessing: after too many failed logins for the same email + IP within a
// window, further attempts get 429 until the window passes. In memory (resets on restart),
// which is enough for a single-server demo; a shared store (e.g. Redis) would be needed at scale.

export interface LoginLimiter {
  // Seconds until the key may try again, or 0 if allowed now.
  retryAfter(key: string): number;
  recordFailure(key: string): void;
  reset(key: string): void;
}

export function createLoginLimiter({ maxFailures = 5, windowMs = 15 * 60_000, now = Date.now } = {}): LoginLimiter {
  const failures = new Map<string, number[]>(); // key -> failure timestamps inside the window

  const recent = (key: string) => {
    const cutoff = now() - windowMs;
    const kept = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };

  return {
    retryAfter(key) {
      const times = recent(key);
      if (times.length < maxFailures) return 0;
      return Math.ceil((times[0] + windowMs - now()) / 1000); // when the oldest failure expires
    },
    recordFailure(key) {
      failures.set(key, [...recent(key), now()]);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
