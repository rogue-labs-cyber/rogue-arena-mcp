import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { KeychainCredentialStore, parseStoredTokens, type StoredTokens } from "./keychain.js";
import type { Profile } from "./profile.js";

/** Where the refresh token lives. Every read/write of persisted auth goes through here. */
export interface CredentialStore {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
  clear(): Promise<void>;
  /** Human-readable location for logs: "keychain:<profile>" or "file:<path>". */
  describe(): string;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * JSON-file store for headless callers (test harnesses, CI) that cannot use
 * the OS keychain. Same payload shape as the keychain entry; written 0600
 * through a temp file + rename so a crash never leaves a half-written token.
 */
export class FileCredentialStore implements CredentialStore {
  constructor(private readonly path: string) {}

  async load(): Promise<StoredTokens | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) return null;
      throw error;
    }
    let tokens: StoredTokens | null = null;
    try {
      const parsed: object = JSON.parse(raw);
      tokens = parseStoredTokens(parsed);
    } catch {
      tokens = null;
    }
    if (!tokens) {
      throw new Error(`credentials file ${this.path} is not a {refreshToken,userId,username} object`);
    }
    return tokens;
  }

  async save(tokens: StoredTokens): Promise<void> {
    const { refreshToken, userId, username } = tokens;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temp, JSON.stringify({ refreshToken, userId, username }), { mode: 0o600 });
    await rename(temp, this.path);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
    }
  }

  describe(): string {
    return `file:${this.path}`;
  }
}

/** ROGUE_CREDENTIALS_FILE (absolute) selects the file store; otherwise the keychain keyed by profile. */
export function createCredentialStore(env: NodeJS.ProcessEnv, profile: Profile): CredentialStore {
  const filePath = env.ROGUE_CREDENTIALS_FILE?.trim();
  if (filePath) {
    if (!isAbsolute(filePath)) {
      throw new Error(`ROGUE_CREDENTIALS_FILE must be an absolute path (got ${JSON.stringify(filePath)})`);
    }
    return new FileCredentialStore(filePath);
  }
  return new KeychainCredentialStore(profile.name);
}
