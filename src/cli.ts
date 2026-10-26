#!/usr/bin/env node
import { decodeJwt } from "jose";
import { login, logout } from "./auth-keycloak.js";
import { resolveProfile } from "./profile.js";
import { createCredentialStore } from "./credential-store.js";

const HUB_URL = process.env.ROGUE_HUB_URL ?? "https://arena.roguelabs.io";
const CLIENT_ID = process.env.ROGUE_CLIENT_ID ?? "rogue-mcp";

const command = process.argv[2];

async function main(): Promise<void> {
  const PROFILE = resolveProfile(process.env);
  const CREDENTIALS = createCredentialStore(process.env, PROFILE);

  switch (command) {
    case "login": {
      console.error(`Hub: ${HUB_URL} · Profile: ${PROFILE.name} · Store: ${CREDENTIALS.describe()}`);
      await login(HUB_URL, CLIENT_ID, CREDENTIALS);
      break;
    }
    case "logout": {
      await logout(HUB_URL, CLIENT_ID, CREDENTIALS);
      break;
    }
    case "whoami": {
      const tokens = await CREDENTIALS.load();
      if (!tokens) {
        console.error(`Not logged in (${CREDENTIALS.describe()}). Run: ${PROFILE.isDefault ? "" : `ROGUE_PROFILE=${PROFILE.name} `}rogue-mcp login`);
        process.exit(1);
      }
      let sessionExpires = "valid until revoked";
      try {
        const exp = decodeJwt(tokens.refreshToken).exp;
        if (typeof exp === "number" && exp > 0) sessionExpires = new Date(exp * 1000).toISOString();
      } catch {
        sessionExpires = "unknown (refresh token is not a readable JWT)";
      }
      console.log(JSON.stringify({
        userId: tokens.userId,
        username: tokens.username,
        hub: HUB_URL,
        profile: PROFILE.name,
        credentialStore: CREDENTIALS.describe(),
        sessionExpires,
        note: "Access tokens are minted on demand and never stored.",
      }, null, 2));
      break;
    }
    case "serve":
    case undefined: {
      await import("./index.js");
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      console.error("Usage: rogue-mcp [login|logout|whoami|serve]   (env: ROGUE_HUB_URL, ROGUE_PROFILE, ROGUE_CREDENTIALS_FILE)");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
