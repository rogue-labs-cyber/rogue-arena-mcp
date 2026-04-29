/**
 * Auth provider interface — abstracts token retrieval for different auth modes.
 * The hub-client calls getHeaders() before each request.
 */
export interface AuthProvider {
  /**
   * Return HTTP headers for authenticated requests to hub / vaults.
   *
   * CONTRACT: The returned Authorization header MUST be a non-expired bearer.
   * If the cached token is within the skew window of expiry (≤ 60s), the
   * provider MUST refresh proactively before returning. Callers (including
   * tus-core's per-attempt onBeforeRequest auth refresh) trust that a single
   * call produces a token valid long enough to complete one PATCH attempt
   * (~5 MiB chunk at UPLOAD_BPS ≈ 250 ms; retry delays extend the window
   * up to ~18 s).
   *
   * Implementations should NOT rely on 401-triggered refresh from downstream
   * callers — tus-js-client does not surface 401s back to the auth provider.
   */
  getHeaders(): Promise<Record<string, string>>;
  getUserInfo(): { userId: string; username: string };
  /** Force the next getHeaders() call to refresh, even if the token hasn't expired yet. */
  invalidateAccessToken(): void;
}
