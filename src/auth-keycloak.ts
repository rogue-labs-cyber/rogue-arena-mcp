import { decodeJwt } from "jose";
import type { StoredTokens, ActiveTokens } from "./keychain.js";
import type { CredentialStore } from "./credential-store.js";
import type { AuthProvider } from "./auth.js";
import { execFileSync } from "node:child_process";

// Must be > (ACCESS_TOKEN_LIFESPAN - BACKGROUND_REFRESH_MS/1000) to ensure proactive refresh.
// With 300s token and 210s timer, remaining at fire = 90s. 90 < 120 → proactive refresh.
const REFRESH_BUFFER_SECONDS = 120;
const MAX_CONSECUTIVE_TRANSIENT_FAILURES = 3;
const CIRCUIT_RESET_MS = 5 * 60 * 1000; // 5 minutes — auto-reset for transient failures

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

function getKeycloakBaseUrl(hubUrl: string): string {
  const url = new URL(hubUrl);
  return `${url.protocol}//${url.host}/auth`;
}

function getTokenEndpoint(keycloakBaseUrl: string): string {
  return `${keycloakBaseUrl}/realms/roguearena/protocol/openid-connect/token`;
}

function getDeviceEndpoint(keycloakBaseUrl: string): string {
  return `${keycloakBaseUrl}/realms/roguearena/protocol/openid-connect/auth/device`;
}

function getRevokeEndpoint(keycloakBaseUrl: string): string {
  return `${keycloakBaseUrl}/realms/roguearena/protocol/openid-connect/revoke`;
}

function tryOpenBrowser(url: string): void {
  try {
    if (process.platform === "darwin") {
      execFileSync("open", [url], { stdio: "ignore" });
    } else if (process.platform === "linux") {
      execFileSync("xdg-open", [url], { stdio: "ignore" });
    } else if (process.platform === "win32") {
      execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    }
  } catch {
    // Browser open is best-effort
  }
}

export async function login(hubUrl: string, clientId: string, store: CredentialStore): Promise<void> {
  const keycloakBaseUrl = getKeycloakBaseUrl(hubUrl);
  const deviceEndpoint = getDeviceEndpoint(keycloakBaseUrl);
  const tokenEndpoint = getTokenEndpoint(keycloakBaseUrl);

  const deviceRes = await fetch(deviceEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      scope: "openid profile email roles offline_access",
    }),
  });

  if (!deviceRes.ok) {
    const text = await deviceRes.text();
    console.error(`[rogue-arena-mcp] Device auth failed (${deviceRes.status}): ${text.replace(/[^\x20-\x7E\n]/g, "").slice(0, 200)}`);
    throw new Error(`Device authorization request failed (${deviceRes.status}). Check your ROGUE_HUB_URL and ROGUE_CLIENT_ID.`);
  }

  const deviceData = (await deviceRes.json()) as DeviceAuthResponse;

  console.error(`\nLogging in to Rogue Arena...`);
  console.error(`Visit: ${deviceData.verification_uri}`);
  console.error(`Enter code: ${deviceData.user_code}\n`);

  tryOpenBrowser(deviceData.verification_uri_complete);

  const pollInterval = (deviceData.interval || 5) * 1000;
  const expiresAt = Date.now() + deviceData.expires_in * 1000;

  process.stderr.write("Waiting for authorization...");

  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: clientId,
        device_code: deviceData.device_code,
      }),
    });

    if (tokenRes.ok) {
      const tokenData = (await tokenRes.json()) as TokenResponse;
      const claims = decodeJwt(tokenData.access_token);

      const tokens: ActiveTokens = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Math.floor(Date.now() / 1000) + tokenData.expires_in,
        userId: String(claims.sub ?? ""),
        username: String(claims["preferred_username"] ?? ""),
      };

      // Persists the refresh half only — see StoredTokens in keychain.ts.
      await store.save(tokens);
      console.error(" done");
      console.error(`Logged in as ${tokens.username} (${store.describe()}). Token valid for ~30 days.`);
      return;
    }

    let errorBody: { error: string };
    try {
      errorBody = (await tokenRes.json()) as { error: string };
    } catch {
      throw new Error(`Device flow failed: unexpected response (${tokenRes.status})`);
    }

    if (errorBody.error === "authorization_pending") {
      process.stderr.write(".");
      continue;
    }

    if (errorBody.error === "slow_down") {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }

    throw new Error(`Device flow failed: ${errorBody.error}`);
  }

  throw new Error("Device code expired. Please try again.");
}

export async function logout(hubUrl: string, clientId: string, store: CredentialStore): Promise<void> {
  let tokens: StoredTokens | null;
  let unreadable = false;
  try {
    tokens = await store.load();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[rogue-arena-mcp] Credential store unreadable (${store.describe()}): ${message}`);
    tokens = null;
    unreadable = true;
  }

  if (!tokens && !unreadable) {
    console.error("Not logged in.");
    return;
  }

  if (tokens) {
    const keycloakBaseUrl = getKeycloakBaseUrl(hubUrl);
    const revokeEndpoint = getRevokeEndpoint(keycloakBaseUrl);

    try {
      const res = await fetch(revokeEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          token: tokens.refreshToken,
          token_type_hint: "refresh_token",
        }),
      });
      if (!res.ok) {
        console.error(`Warning: Server-side revocation failed (${res.status}) — token may remain valid until expiry.`);
      }
    } catch {
      console.error("Warning: Server-side revocation failed — token may remain valid until expiry.");
    }
  }

  await store.clear();
  console.error(`Logged out. Local tokens cleared (${store.describe()}).`);
}

async function refreshAccessToken(
  hubUrl: string,
  clientId: string,
  refreshToken: string,
  store: CredentialStore
): Promise<ActiveTokens> {
  const keycloakBaseUrl = getKeycloakBaseUrl(hubUrl);
  const tokenEndpoint = getTokenEndpoint(keycloakBaseUrl);

  // Single-writer: use the in-memory refresh token directly.
  // With Keycloak's "Revoke Refresh Token" enabled, each token is single-use.
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (res.ok) {
    const tokenData = (await res.json()) as TokenResponse;
    const claims = decodeJwt(tokenData.access_token);

    const tokens: ActiveTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + tokenData.expires_in,
      userId: String(claims.sub ?? ""),
      username: String(claims["preferred_username"] ?? ""),
    };

    try {
      await store.save(tokens);
    } catch (err) {
      console.error(`[rogue-arena-mcp] WARNING: Failed to save tokens to ${store.describe()}: ${err instanceof Error ? err.message : err}`);
      console.error("[rogue-arena-mcp] Tokens are valid in-memory but will be lost on restart.");
    }
    return tokens;
  }

  const text = await res.text();
  const status = res.status;
  console.error(`[rogue-arena-mcp] Token refresh failed (${status}): ${text.replace(/[^\x20-\x7E\n]/g, "").slice(0, 200)}`);

  // On invalid_grant, our in-memory token is dead. But another process (or a
  // fresh `rogue-mcp login`) may have written valid tokens to the keychain.
  // Check the keychain as a recovery mechanism — ONLY after failure, never
  // during the normal refresh flow (which would cause the original race bug).
  const isInvalidGrant = text.includes("invalid_grant");
  if (isInvalidGrant) {
    const storedTokens = await store.load();
    if (storedTokens && storedTokens.refreshToken !== refreshToken) {
      // Store has a different token — another process refreshed or user re-logged in.
      // Try refreshing with the stored token.
      console.error(`[rogue-arena-mcp] In-memory token dead, found different token in ${store.describe()} — attempting recovery`);
      const retryRes = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: storedTokens.refreshToken,
        }),
      });

      if (retryRes.ok) {
        const tokenData = (await retryRes.json()) as TokenResponse;
        const claims = decodeJwt(tokenData.access_token);
        const tokens: ActiveTokens = {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: Math.floor(Date.now() / 1000) + tokenData.expires_in,
          userId: String(claims.sub ?? ""),
          username: String(claims["preferred_username"] ?? ""),
        };
        try { await store.save(tokens); } catch { /* in-memory is fine */ }
        console.error(`[rogue-arena-mcp] Recovery successful — adopted tokens from ${store.describe()}`);
        return tokens;
      }
      console.error(`[rogue-arena-mcp] ${store.describe()} token also dead — session is truly gone`);
    }
  }

  const isTerminal = (status === 400 && isInvalidGrant) || status === 401;
  throw new RefreshError(
    `Token refresh failed (${status}${isInvalidGrant ? " invalid_grant" : ""})`,
    isTerminal ? "terminal" : "transient"
  );
}

class RefreshError extends Error {
  constructor(message: string, public readonly kind: "terminal" | "transient") {
    super(message);
    this.name = "RefreshError";
  }
}

export class KeycloakAuthProvider implements AuthProvider {
  private hubUrl: string;
  private clientId: string;
  private currentTokens: ActiveTokens;
  private refreshPromise: Promise<ActiveTokens> | null = null;

  // Circuit breaker state — split by error class
  private sessionDead = false; // terminal: 400/401 invalid_grant — session is gone, don't retry
  private consecutiveTransientFailures = 0; // transient: network errors, 5xx
  private lastTransientFailureAt = 0; // timestamp for auto-reset

  constructor(
    hubUrl: string,
    clientId: string,
    tokens: StoredTokens,
    private readonly store: CredentialStore,
    readonly loginCommand: string
  ) {
    this.hubUrl = hubUrl;
    this.clientId = clientId;
    // The access token is never persisted (see StoredTokens in keychain.ts),
    // so a freshly-loaded session starts with none. expiresAt 0 makes the
    // first getHeaders() take the refresh branch and mint one — the same
    // mechanism invalidateAccessToken() uses.
    this.currentTokens = { ...tokens, accessToken: "", expiresAt: 0 };
  }

  async getHeaders(): Promise<Record<string, string>> {
    const now = Math.floor(Date.now() / 1000);

    if (this.currentTokens.expiresAt - now < REFRESH_BUFFER_SECONDS) {
      // Terminal circuit breaker — session is revoked/expired, don't waste requests
      // unless a `rogue-mcp login` has since stored a new one.
      if (this.sessionDead && !(await this.adoptStoredSession())) {
        throw new Error(
          `Session expired (offline session revoked). Ask the user to run \`${this.loginCommand}\` in a terminal, then retry the call. ` +
            "A login as a different user takes effect only after this MCP server reconnects."
        );
      }

      // Transient circuit breaker — auto-reset after cooldown
      if (this.consecutiveTransientFailures >= MAX_CONSECUTIVE_TRANSIENT_FAILURES) {
        const msSinceLastFailure = Date.now() - this.lastTransientFailureAt;
        if (msSinceLastFailure < CIRCUIT_RESET_MS) {
          throw new Error(
            `Session unavailable (${this.consecutiveTransientFailures} consecutive transient failures, retry in ${Math.ceil((CIRCUIT_RESET_MS - msSinceLastFailure) / 1000)}s). If this persists, ask the user to run \`${this.loginCommand}\`.`
          );
        }
        // Cooldown elapsed — reset and try again
        console.error("[rogue-arena-mcp] Transient circuit breaker reset after cooldown");
        this.consecutiveTransientFailures = 0;
      }

      if (!this.refreshPromise) {
        this.refreshPromise = refreshAccessToken(
          this.hubUrl,
          this.clientId,
          this.currentTokens.refreshToken,
          this.store
        ).then((tokens) => {
          this.currentTokens = tokens;
          this.consecutiveTransientFailures = 0;
          console.error("[rogue-arena-mcp] Token refreshed silently");
          return tokens;
        }).catch((err) => {
          if (err instanceof RefreshError && err.kind === "terminal") {
            this.sessionDead = true;
            console.error("[rogue-arena-mcp] Terminal refresh failure — session is dead");
          } else {
            this.consecutiveTransientFailures++;
            this.lastTransientFailureAt = Date.now();
            console.error(`[rogue-arena-mcp] Transient refresh failure (${this.consecutiveTransientFailures}/${MAX_CONSECUTIVE_TRANSIENT_FAILURES})`);
          }
          throw err;
        }).finally(() => {
          this.refreshPromise = null;
        });
      }

      try {
        await this.refreshPromise;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (this.sessionDead) {
          throw new Error(
            `Session expired (${detail}). Ask the user to run \`${this.loginCommand}\` in a terminal, then retry the call.`
          );
        }
        throw new Error(
          `Could not refresh the Rogue Arena session (${detail}). Retry shortly; if it keeps failing, ask the user to run \`${this.loginCommand}\`.`
        );
      }
    }

    return {
      Authorization: `Bearer ${this.currentTokens.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  getUserInfo(): { userId: string; username: string } {
    return {
      userId: this.currentTokens.userId,
      username: this.currentTokens.username,
    };
  }

  invalidateAccessToken(): void {
    this.currentTokens = { ...this.currentTokens, expiresAt: 0 };
  }

  /**
   * After a terminal refresh failure, a later `rogue-mcp login` stores a new
   * refresh token. Adopt it (same user only) so the running server recovers
   * without a restart; the next refresh mints an access token from it.
   */
  private async adoptStoredSession(): Promise<boolean> {
    let stored: StoredTokens | null;
    try {
      stored = await this.store.load();
    } catch {
      return false;
    }
    if (
      !stored ||
      stored.refreshToken === this.currentTokens.refreshToken ||
      stored.userId !== this.currentTokens.userId
    ) {
      return false;
    }
    console.error(`[rogue-arena-mcp] Adopting the session stored in ${this.store.describe()} after a dead session`);
    this.currentTokens = { ...stored, accessToken: "", expiresAt: 0 };
    this.sessionDead = false;
    return true;
  }

  /** Reset the circuit breaker — called when fresh tokens are loaded externally (e.g., after rogue-mcp login). */
  resetCircuitBreaker(): void {
    this.sessionDead = false;
    this.consecutiveTransientFailures = 0;
  }
}
