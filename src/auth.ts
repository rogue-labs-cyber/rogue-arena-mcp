/**
 * Auth provider interface — abstracts token retrieval for different auth modes.
 * The hub-client calls getHeaders() before each request.
 */
export interface AuthProvider {
  getHeaders(): Promise<Record<string, string>>;
  getUserInfo(): { userId: string; username: string };
  /** Force the next getHeaders() call to refresh, even if the token hasn't expired yet. */
  invalidateAccessToken(): void;
}
