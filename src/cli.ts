#!/usr/bin/env node
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
      const expiresIn = tokens.expiresAt - Math.floor(Date.now() / 1000);
      console.log(
        JSON.stringify(
          {
            userId: tokens.userId,
            username: tokens.username,
            accessTokenExpiresIn: `${Math.max(0, Math.floor(expiresIn / 60))} minutes`,
            note: "Refresh token auto-renews for ~30 days",
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
