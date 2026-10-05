// Fixed-window in-memory limiter. Fine for the single-instance MVP; swap for Redis when scaling out.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count++;
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  return { ok: b.count <= max, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

export function resetRateLimits() {
  buckets.clear();
}
