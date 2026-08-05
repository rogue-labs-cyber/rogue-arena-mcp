import { getPassword, setPassword, deletePassword } from "cross-keychain";

const SERVICE_NAME = "rogue-arena-mcp";
const ACCOUNT_NAME = "default";

/**
 * What we persist to the OS credential store.
 *
 * Deliberately does NOT include the access token or its expiry. Windows
 * CredWrite caps a credential blob at 2560 UTF-16 bytes; the access token
 * alone is ~1729 chars (~3458 bytes), so storing it made every Windows
 * login fail outright (BUG-032). It is also pointless: access tokens live
 * 300s, so a persisted one is stale on virtually every process start and
 * gets refreshed immediately anyway.
 *
 * The refresh token is the durable credential — it is what keeps a session
 * alive across restarts. The access token is minted from it on demand and
 * lives only in memory on KeycloakAuthProvider.
 */
export interface StoredTokens {
  refreshToken: string;
  userId: string;
  username: string;
}

/** A live session: the persisted half plus the in-memory access token. */
export interface ActiveTokens extends StoredTokens {
  accessToken: string;
  expiresAt: number; // Unix timestamp in seconds
}

export async function loadTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await getPassword(SERVICE_NAME, ACCOUNT_NAME);
    if (!raw) return null;
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  // Destructure explicitly so an ActiveTokens caller cannot accidentally
  // widen the blob back over the Windows credential cap (BUG-032).
  const { refreshToken, userId, username } = tokens;
  await setPassword(
    SERVICE_NAME,
    ACCOUNT_NAME,
    JSON.stringify({ refreshToken, userId, username })
  );
}

export async function clearTokens(): Promise<void> {
  try {
    await deletePassword(SERVICE_NAME, ACCOUNT_NAME);
  } catch {
    // Ignore — may not exist
  }
}
