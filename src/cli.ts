#!/usr/bin/env node
import { decodeJwt } from "jose";
import { login, logout } from "./auth-keycloak.js";
import { loadTokens } from "./keychain.js";

const HUB_URL = process.env.ROGUE_HUB_URL ?? "https://arena.roguelabs.io";
const CLIENT_ID = process.env.ROGUE_CLIENT_ID ?? "rogue-mcp";

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case "login": {
      await login(HUB_URL, CLIENT_ID);
      break;
    }

    case "logout": {
      await logout(HUB_URL, CLIENT_ID);
      break;
    }

    case "whoami": {
      const tokens = await loadTokens();
      if (!tokens) {
        console.error("Not logged in. Run: rogue-mcp login");
        process.exit(1);
      }
      // Session lifetime comes from the refresh token — the access token is
      // no longer persisted (see StoredTokens in keychain.ts). Offline tokens
      // may carry no `exp` at all, in which case they last until revoked.
      let sessionExpires = "valid until revoked";
      try {
        const exp = decodeJwt(tokens.refreshToken).exp;
        if (typeof exp === "number" && exp > 0) {
          sessionExpires = new Date(exp * 1000).toISOString();
        }
      } catch {
        sessionExpires = "unknown (refresh token is not a readable JWT)";
      }
      console.log(
        JSON.stringify(
          {
            userId: tokens.userId,
            username: tokens.username,
            sessionExpires,
            note: "Access tokens are minted on demand and never stored.",
          },
          null,
          2
        )
      );
      break;
    }

    case "serve":
    case undefined: {
      // Import and run the MCP server
      await import("./index.js");
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.error("Usage: rogue-mcp [login|logout|whoami|serve]");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
