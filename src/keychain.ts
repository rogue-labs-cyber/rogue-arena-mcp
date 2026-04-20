import { getPassword, setPassword, deletePassword } from "cross-keychain";

const SERVICE_NAME = "rogue-arena-mcp";
const ACCOUNT_NAME = "default";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in seconds
  userId: string;
  username: string;
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
  await setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(tokens));
}

export async function clearTokens(): Promise<void> {
  try {
    await deletePassword(SERVICE_NAME, ACCOUNT_NAME);
  } catch {
    // Ignore — may not exist
  }
}
