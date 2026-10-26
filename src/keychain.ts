import { getPassword, setPassword, deletePassword } from "cross-keychain";
import { z } from "zod";
import type { CredentialStore } from "./credential-store.js";

const SERVICE_NAME = "rogue-arena-mcp";

/**
 * What we persist to the credential store.
 *
 * Deliberately does NOT include the access token or its expiry. Windows
 * CredWrite caps a credential blob at 2560 UTF-16 bytes; the access token
 * alone is ~1729 chars (~3458 bytes), so storing it made every Windows
 * login fail outright. It is also pointless: access tokens live
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

/** The three OS-keychain primitives, injectable for tests. */
export interface KeychainBackend {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean | void>;
}

const OS_KEYCHAIN: KeychainBackend = { getPassword, setPassword, deletePassword };

const StoredTokensSchema = z.object({ refreshToken: z.string(), userId: z.string(), username: z.string() });

export function parseStoredTokens(value: object): StoredTokens | null {
  const parsed = StoredTokensSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Credential store backed by the OS keychain; the account name is the profile. */
export class KeychainCredentialStore implements CredentialStore {
  constructor(
    private readonly profileName: string,
    private readonly backend: KeychainBackend = OS_KEYCHAIN
  ) {}

  async load(): Promise<StoredTokens | null> {
    try {
      const raw = await this.backend.getPassword(SERVICE_NAME, this.profileName);
      if (!raw) return null;
      const parsed: object = JSON.parse(raw);
      return parseStoredTokens(parsed);
    } catch {
      return null;
    }
  }

  async save(tokens: StoredTokens): Promise<void> {
    // Destructure explicitly so an ActiveTokens caller cannot accidentally
    // widen the blob back over the Windows credential cap.
    const { refreshToken, userId, username } = tokens;
    await this.backend.setPassword(
      SERVICE_NAME,
      this.profileName,
      JSON.stringify({ refreshToken, userId, username })
    );
  }

  async clear(): Promise<void> {
    try {
      await this.backend.deletePassword(SERVICE_NAME, this.profileName);
    } catch {
      // Ignore — may not exist
    }
  }

  describe(): string {
    return `keychain:${this.profileName}`;
  }
}
