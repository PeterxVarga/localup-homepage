// ============================================================
// In-memory rate limiting utilities
// V1: per-IP sliding window. Replace with Redis for multi-instance.
// ============================================================

const requestLog = new Map<string, number[]>();

export interface RateLimitOptions {
  /** Namespace that separates different limiters (e.g. 'track', 'book') */
  namespace: string;
  /** Maximum number of requests allowed in the window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

function makeKey(request: Request, options: RateLimitOptions): string {
  return `${options.namespace}:${getClientIp(request)}`;
}

function pruneWindow(key: string, windowMs: number): number[] {
  const now = Date.now();
  const timestamps = requestLog.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < windowMs);
  requestLog.set(key, recent);
  return recent;
}

/**
 * Check if the request from this IP is over the allowed rate.
 * Does NOT record the request — call recordRequest() separately.
 */
export function isRateLimited(request: Request, options: RateLimitOptions): boolean {
  const key = makeKey(request, options);
  const recent = pruneWindow(key, options.windowMs);
  return recent.length >= options.max;
}

/**
 * Record a request timestamp for this IP.
 */
export function recordRequest(request: Request, options: RateLimitOptions): void {
  const key = makeKey(request, options);
  const timestamps = requestLog.get(key) ?? [];
  timestamps.push(Date.now());
  requestLog.set(key, timestamps);
}

/**
 * Get how many seconds the client should wait before retrying.
 */
export function getRetryAfterSeconds(request: Request, options: RateLimitOptions): number {
  const key = makeKey(request, options);
  const recent = pruneWindow(key, options.windowMs);
  if (recent.length === 0) return 0;
  const oldest = recent[0];
  const msUntilReset = options.windowMs - (Date.now() - oldest);
  return Math.max(1, Math.ceil(msUntilReset / 1000));
}
