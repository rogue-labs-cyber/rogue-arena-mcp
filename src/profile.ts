import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PROFILE_NAME = "default";
const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** A named credential + session namespace so several installs can coexist. */
export interface Profile {
  readonly name: string;
  readonly isDefault: boolean;
  readonly sessionFilePath: string;
}

export function resolveProfile(env: NodeJS.ProcessEnv, home: string = homedir()): Profile {
  const raw = env.ROGUE_PROFILE?.trim() ?? "";
  const name = raw.length > 0 ? raw : DEFAULT_PROFILE_NAME;
  if (!PROFILE_PATTERN.test(name)) {
    throw new Error(
      `ROGUE_PROFILE must match ${PROFILE_PATTERN} (got ${JSON.stringify(raw)})`
    );
  }
  const isDefault = name === DEFAULT_PROFILE_NAME;
  const fileName = isDefault ? "rogue-mcp-session.json" : `rogue-mcp-session.${name}.json`;
  return Object.freeze({
    name,
    isDefault,
    sessionFilePath: join(home, ".claude", fileName),
  });
}

/**
 * The terminal command that logs this profile in. A named profile also needs
 * its hub, because the user's shell does not carry the MCP server's environment.
 */
export function loginCommand(profile: Profile, hubUrl: string): string {
  return profile.isDefault
    ? "rogue-mcp login"
    : `ROGUE_PROFILE=${profile.name} ROGUE_HUB_URL=${hubUrl} rogue-mcp login`;
}
