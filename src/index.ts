#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import sharp from "sharp";
import { HubClient, type ToolSchema } from "./hub-client.js";
import { HubRequestError } from "./hub-errors.js";
import type { AuthProvider } from "./auth.js";
import { KeycloakAuthProvider } from "./auth-keycloak.js";
import type { StoredTokens } from "./keychain.js";
import { loginCommand, resolveProfile } from "./profile.js";
import { createCredentialStore } from "./credential-store.js";
import { Session } from "./session.js";
import {
  META_TOOLS, handleMetaTool, isMetaTool, setDiscoverableTools, setAlwaysTools, setToolPromotion,
  setUnavailableToolFamilies, unavailableToolFamilies, unavailableFamilyForTool, describeUnavailableFamily, authStatusArgsRefusal,
  type ServerIdentity, type UnavailableToolFamily,
} from "./meta-tools.js";
import { LOCAL_TOOLS, isLocalTool, handleLocalTool } from "./local-tools.js";

// ── Screenshot helper ───────────────────────────────────────────────
type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/**
 * Max pixels on the longest edge when returning screenshots to the LLM.
 * Anthropic recommends 1024px for vision accuracy. The LLM reads pixel
 * coordinates from the displayed image, so we downscale to a known size
 * and return displayWidth/displayHeight. Click/drag tools accept these
 * as screenWidth/screenHeight — the file-syncer scales to QMP space.
 */
const SCREENSHOT_MAX_DIMENSION = 1024;

async function downscaleScreenshot(
  base64Jpeg: string,
  width: number,
  height: number
): Promise<{ imageBase64: string; displayWidth: number; displayHeight: number }> {
  const longest = Math.max(width, height);
  if (longest <= SCREENSHOT_MAX_DIMENSION) {
    return { imageBase64: base64Jpeg, displayWidth: width, displayHeight: height };
  }

  const scale = SCREENSHOT_MAX_DIMENSION / longest;
  const displayWidth = Math.round(width * scale);
  const displayHeight = Math.round(height * scale);

  const inputBuffer = Buffer.from(base64Jpeg, "base64");
  const outputBuffer = await sharp(inputBuffer)
    .resize(displayWidth, displayHeight)
    .jpeg({ quality: 80 })
    .toBuffer();

  return {
    imageBase64: outputBuffer.toString("base64"),
    displayWidth,
    displayHeight,
  };
}

async function tryBuildScreenshotResponse(
  name: string,
  data: unknown
): Promise<{ content: McpContent[] } | undefined> {
  if (name !== "deployment_screenshot") return undefined;
  const d = data as { screenshots?: Array<{ displayName: string; imageBase64: string; width: number; height: number }>; errors?: Array<{ depVMId: string; error: string }> } | undefined;
  if (!d?.screenshots) return undefined;

  const content: McpContent[] = [];
  for (const s of d.screenshots) {
    const { imageBase64, displayWidth, displayHeight } = await downscaleScreenshot(
      s.imageBase64,
      s.width,
      s.height
    );
    content.push({
      type: "text" as const,
      text: `Screenshot: ${s.displayName} (screen: ${s.width}x${s.height}, displayed: ${displayWidth}x${displayHeight}). For click/drag, use coordinates from this image with screenWidth=${displayWidth}, screenHeight=${displayHeight}.`,
    });
    content.push({ type: "image" as const, data: imageBase64, mimeType: "image/jpeg" });
  }
  for (const e of d.errors ?? []) {
    content.push({ type: "text" as const, text: `Screenshot error (${e.depVMId}): ${e.error}` });
  }
  if (content.length === 0) {
    content.push({ type: "text" as const, text: "No screenshots returned." });
  }
  return { content };
}

// ── Config from env ──────────────────────────────────────────────────
const HUB_URL = process.env.ROGUE_HUB_URL ?? "https://arena.roguelabs.io";
const CLIENT_ID = process.env.ROGUE_CLIENT_ID ?? "rogue-mcp";
const PROFILE = resolveProfile(process.env);
const LOGIN_HINT = loginCommand(PROFILE, HUB_URL);
const IDENTITY: ServerIdentity = { hubUrl: HUB_URL, profile: PROFILE.name, loginCommand: LOGIN_HINT };
const CREDENTIALS = createCredentialStore(process.env, PROFILE);

// ── Auth status tracking ────────────────────────────────────────────
type AuthState =
  | { status: "ok"; username: string; userId: string }
  | { status: "no_tokens"; error: string }
  | { status: "expired"; error: string; username: string; userId: string }
  | { status: "error"; error: string; username?: string; userId?: string };

let currentAuthState: AuthState = { status: "no_tokens", error: "Not initialized" };

const BACKGROUND_REFRESH_MS = 3.5 * 60 * 1000; // 3.5 minutes
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function startBackgroundRefresh(auth: AuthProvider): void {
  stopBackgroundRefresh();
  const schedule = () => {
    refreshTimer = setTimeout(async () => {
      try {
        await auth.getHeaders();
      } catch (e) {
        console.error(`[rogue-arena-mcp] Background refresh failed: ${e instanceof Error ? e.message : e}`);
      }
      schedule();
    }, BACKGROUND_REFRESH_MS);
    refreshTimer.unref();
  };
  schedule();
  console.error("[rogue-arena-mcp] Background refresh timer started (every 3.5 min)");
}

function stopBackgroundRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

// ── Build auth provider ─────────────────────────────────────────────
async function createAuthProvider(): Promise<AuthProvider | null> {
  let tokens: StoredTokens | null;
  try {
    tokens = await CREDENTIALS.load();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[rogue-arena-mcp] Credential store unreadable (${CREDENTIALS.describe()}): ${message}`);
    currentAuthState = { status: "error", error: message };
    return null;
  }
  if (!tokens) {
    console.error(`[rogue-arena-mcp] Not logged in (${CREDENTIALS.describe()}).`);
    console.error(`[rogue-arena-mcp] Run: ${LOGIN_HINT}`);
    currentAuthState = {
      status: "no_tokens",
      error: `Not logged in. The user must run \`${LOGIN_HINT}\` in their terminal to authenticate.`,
    };
    return null;
  }

  console.error(`[rogue-arena-mcp] Auth: keycloak (${CREDENTIALS.describe()})`);
  console.error(`[rogue-arena-mcp] User: ${tokens.username} (${tokens.userId})`);
  return new KeycloakAuthProvider(HUB_URL, CLIENT_ID, tokens, CREDENTIALS, LOGIN_HINT);
}

// ── Auth status tool (always registered) ────────────────────────────
const AUTH_STATUS_TOOL = {
  name: "rogue_auth_status",
  description:
    "Check the Rogue Arena MCP authentication status. Call this FIRST if other rogue_* tools are missing or returning auth errors. Reports whether auth is healthy, expired, or missing, and tells you exactly what the user needs to do to fix it.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
};

function buildAuthStatusResponse(): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  switch (currentAuthState.status) {
    case "ok": {
      const unavailable = unavailableToolFamilies();
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            authStatus: "ok",
            hub: HUB_URL,
            profile: PROFILE.name,
            username: currentAuthState.username,
            userId: currentAuthState.userId,
            message: unavailable.length === 0
              ? "Authentication is healthy. All Rogue Arena tools should be available."
              : "Authentication is healthy, but some tool families failed discovery when this server started and cannot be called.",
            ...(unavailable.length === 0 ? {} : {
              action: "Reconnect this MCP server to retry discovery once the hub answers.",
              unavailableToolFamilies: unavailable.map((family) => ({
                family: family.label,
                category: family.category,
                discoveryStatus: family.status ?? "no response",
                detail: family.reason,
              })),
            }),
          }, null, 2),
        }],
      };
    }
    case "no_tokens":
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            authStatus: "not_logged_in",
            hub: HUB_URL,
            profile: PROFILE.name,
            message: "Not logged in. No Rogue Arena tools are available until the user authenticates.",
            action: `Tell the user to run: ${LOGIN_HINT}`,
            detail: currentAuthState.error,
          }, null, 2),
        }],
        isError: true,
      };
    case "expired":
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            authStatus: "expired",
            hub: HUB_URL,
            profile: PROFILE.name,
            username: currentAuthState.username,
            userId: currentAuthState.userId,
            message: "Authentication session has expired. No Rogue Arena tools are available until the user re-authenticates.",
            action: `Tell the user to run: ${LOGIN_HINT}`,
            detail: currentAuthState.error,
          }, null, 2),
        }],
        isError: true,
      };
    case "error":
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            authStatus: "error",
            hub: HUB_URL,
            profile: PROFILE.name,
            ...(currentAuthState.username ? { username: currentAuthState.username } : {}),
            message: "Authentication failed. No Rogue Arena tools are available.",
            action: `Tell the user to check their connection and run: ${LOGIN_HINT}`,
            detail: currentAuthState.error,
          }, null, 2),
        }],
        isError: true,
      };
  }
}

/** Tool families served by their own schema route. One failing does not stop the server. */
interface OptionalToolFamily {
  readonly category: string;
  readonly label: string;
  readonly namePrefix: string;
  readonly discover: (hub: HubClient) => Promise<ToolSchema[]>;
}

const OPTIONAL_TOOL_FAMILIES: readonly OptionalToolFamily[] = [
  { category: "PLUGIN_DEV", label: "plugin-dev", namePrefix: "plugin_dev_", discover: (hub) => hub.discoverPluginDevTools() },
  { category: "ACTIVE_DEPLOYMENT", label: "active-deployment", namePrefix: "deployment_", discover: (hub) => hub.discoverActiveDeploymentTools() },
];

async function discoverAllTools(hub: HubClient): Promise<{ tools: ToolSchema[]; unavailableFamilies: UnavailableToolFamily[] }> {
  let tools = await hub.discoverTools();
  console.error(`[rogue-arena-mcp] Discovered ${tools.length} tools from hub`);
  const unavailableFamilies: UnavailableToolFamily[] = [];

  for (const family of OPTIONAL_TOOL_FAMILIES) {
    try {
      const familyTools = await family.discover(hub);
      console.error(`[rogue-arena-mcp] Discovered ${familyTools.length} ${family.label} tools`);
      tools = [...tools, ...familyTools];
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[rogue-arena-mcp] ${family.label} tool discovery failed (non-fatal): ${reason}`);
      unavailableFamilies.push({
        category: family.category,
        label: family.label,
        namePrefix: family.namePrefix,
        ...(err instanceof HubRequestError ? { status: err.status } : {}),
        reason,
      });
    }
  }

  return { tools, unavailableFamilies };
}

function unknownToolResponse(name: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const family = unavailableFamilyForTool(name);
  return {
    content: [{
      type: "text",
      text: family
        ? describeUnavailableFamily(family, name)
        : `Unknown tool: ${name}. Use discover_tools to find available tools.`,
    }],
    isError: true,
  };
}

// ── Bootstrap ────────────────────────────────────────────────────────
async function main() {
  console.error(`[rogue-arena-mcp] Hub: ${HUB_URL} · Profile: ${PROFILE.name}`);

  const auth = await createAuthProvider();

  // If no auth, start in degraded mode with only the auth status tool
  if (!auth) {
    console.error("[rogue-arena-mcp] Starting in degraded mode (no auth)");
    return startDegradedServer();
  }

  const userInfo = auth.getUserInfo();

  // Session
  const session = new Session(userInfo.userId, userInfo.username, PROFILE.sessionFilePath);

  // Hub client
  const hub = new HubClient(HUB_URL, auth);

  // Discover tools from hub (with one retry on transient failure)
  console.error("[rogue-arena-mcp] Discovering tools from hub...");
  let discovered: { tools: ToolSchema[]; unavailableFamilies: UnavailableToolFamily[] };
  try {
    discovered = await discoverAllTools(hub);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Don't retry invalid_grant — the token family is dead
    if (msg.includes("invalid_grant")) {
      console.error(`[rogue-arena-mcp] Token revoked: ${msg}`);
      currentAuthState = { status: "expired", error: msg, username: userInfo.username, userId: userInfo.userId };
      console.error("[rogue-arena-mcp] Starting in degraded mode (token revoked)");
      return startDegradedServer();
    }

    // Layer 7: Retry once after 5s for transient failures
    console.error(`[rogue-arena-mcp] Discovery failed (${msg}), retrying in 5s...`);
    await new Promise((r) => setTimeout(r, 5000));

    try {
      discovered = await discoverAllTools(hub);
    } catch (retryErr) {
      const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      console.error(`[rogue-arena-mcp] Retry also failed: ${retryMsg}`);

      const unauthorized = retryErr instanceof HubRequestError && retryErr.status === 401;
      if (unauthorized || retryMsg.includes("expired") || retryMsg.includes("invalid_grant")) {
        currentAuthState = { status: "expired", error: retryMsg, username: userInfo.username, userId: userInfo.userId };
      } else {
        currentAuthState = { status: "error", error: retryMsg, username: userInfo.username, userId: userInfo.userId };
      }

      console.error("[rogue-arena-mcp] Starting in degraded mode (auth/discovery failed after retry)");
      return startDegradedServer();
    }
  }

  const hubTools = discovered.tools;
  setUnavailableToolFamilies(discovered.unavailableFamilies);

  // Auth is healthy if we got here
  currentAuthState = {
    status: "ok",
    username: userInfo.username,
    userId: userInfo.userId,
  };

  // Layer 4: Background refresh — keeps tokens warm
  startBackgroundRefresh(auth);

  // Create low-level MCP server (supports raw JSON Schema)
  const server = new Server(
    { name: "rogue-arena", version: "0.1.0" },
    { capabilities: { tools: { listChanged: true } } }
  );

  // Build tool list for ListTools response
  const metaToolList = META_TOOLS.map((meta) => ({
    name: meta.name,
    description: meta.description,
    inputSchema: meta.inputSchema,
  }));

  const localToolList = LOCAL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  // Partition hub tools by mcpVisibility (set by each tool definition in the hub).
  // tools/list_changed doesn't reliably propagate in Claude Code, so we list
  // all "always" tools upfront and keep "discoverable" ones behind discover_tools.
  const alwaysTools = hubTools.filter((t) => t.mcpVisibility !== "discoverable");
  const discoverableTools = hubTools.filter((t) => t.mcpVisibility === "discoverable");

  // Cache both tool sets for the discover_tools meta-tool
  setDiscoverableTools(discoverableTools);
  setAlwaysTools(alwaysTools);

  console.error(
    `[rogue-arena-mcp] Tool split: ${alwaysTools.length} always, ${discoverableTools.length} discoverable`
  );

  const enrichDescription = (tool: typeof hubTools[number]): string => {
    let desc = tool.description;
    if (tool.guidance.bestFor.length > 0) {
      desc += `\n\nBest for: ${tool.guidance.bestFor.join("; ")}`;
    }
    if (tool.guidance.notes && tool.guidance.notes.length > 0) {
      desc += `\nNotes: ${tool.guidance.notes.join("; ")}`;
    }
    desc += `\nReturns: ${tool.guidance.returns}`;
    return desc;
  };

  const toMcpTool = (tool: typeof hubTools[number]) => ({
    name: tool.name,
    description: enrichDescription(tool),
    inputSchema: tool.inputSchema as {
      type: "object";
      properties?: Record<string, unknown>;
    },
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  });

  // ListTools starts with always-visible hub tools + meta-tools + local tools + auth status.
  // Discoverable tools are promoted into this array when discover_tools is called.
  const listedTools: Array<Record<string, unknown>> = [
    AUTH_STATUS_TOOL,
    ...metaToolList,
    ...localToolList,
    ...alwaysTools.map(toMcpTool),
  ];

  // Wire up tool promotion so discover_tools can add tools to listedTools
  setToolPromotion(listedTools, toMcpTool);

  // CallTool needs access to ALL tools (always + discoverable)
  const allCallableTools = new Map(
    hubTools.map((t) => [t.name, t])
  );

  // Handle ListTools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listedTools,
  }));

  // Handle CallTool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const callArgs = (args ?? {}) as Record<string, unknown>;

    if (name === "rogue_auth_status") {
      return authStatusArgsRefusal(callArgs) ?? buildAuthStatusResponse();
    }

    if (isMetaTool(name)) {
      try {
        const { toolsPromoted, ...mcpResult } = await handleMetaTool(name, callArgs, session, hub, IDENTITY);

        // If discover_tools promoted new tools, notify the client to re-fetch ListTools
        if (toolsPromoted) {
          console.error(
            `[rogue-arena-mcp] Tools promoted — sending tools/list_changed (now ${listedTools.length} listed)`
          );
          void server.notification({
            method: "notifications/tools/list_changed",
          });
        }

        return mcpResult;
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    if (isLocalTool(name)) {
      try {
        return await handleLocalTool(name, callArgs, auth, hub);
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // Hub tool — callable regardless of visibility
    if (!allCallableTools.has(name)) {
      return unknownToolResponse(name);
    }

    // Plugin dev tools — no canvas required
    const toolSchema = allCallableTools.get(name);
    if (toolSchema && toolSchema.category === "PLUGIN_DEV") {
      try {
        const result = await hub.executePluginDevTool(name, callArgs);

        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Tool ${name} failed: ${result.error}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // Active deployment tools — no canvas required
    if (toolSchema && toolSchema.category === "ACTIVE_DEPLOYMENT") {
      try {
        const result = await hub.executeActiveDeploymentTool(name, callArgs);

        if (!result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Tool ${name} failed: ${result.error}`,
              },
            ],
            isError: true,
          };
        }

        const screenshotResponse = await tryBuildScreenshotResponse(name, result.data);
        if (screenshotResponse) return screenshotResponse;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    try {
      const canvasVersionId = session.requireCanvas();
      const result = await hub.executeTool(name, canvasVersionId, callArgs);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Tool ${name} failed: ${result.error}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  console.error(
    `[rogue-arena-mcp] Listed: ${listedTools.length} tools (${META_TOOLS.length} meta + ${alwaysTools.length} hub). Discoverable: ${discoverableTools.length} more via discover_tools.`
  );

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[rogue-arena-mcp] MCP server running on stdio");
}

async function startDegradedServer(): Promise<void> {
  const server = new Server(
    { name: "rogue-arena", version: "0.1.0" },
    { capabilities: { tools: { listChanged: true } } }
  );

  // Mutable tool list — starts with just auth status, grows on recovery
  const listedTools: Array<Record<string, unknown>> = [AUTH_STATUS_TOOL];

  // Track last-seen refresh token to detect changes
  let lastSeenRefreshToken: string | null = null;
  try {
    const initialTokens = await CREDENTIALS.load();
    if (initialTokens) {
      lastSeenRefreshToken = initialTokens.refreshToken;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[rogue-arena-mcp] Credential store unreadable (${CREDENTIALS.describe()}): ${message}`);
    lastSeenRefreshToken = null;
  }

  // State for recovered session (used by CallTool handler after recovery)
  let recoveredAuth: AuthProvider | null = null;
  let recoveredHub: HubClient | null = null;
  let recoveredSession: Session | null = null;
  let recoveredCallableTools: Map<string, ToolSchema> | null = null;

  // Layer 5B: Auto-poll keychain every 30s while degraded
  let recoveryPollTimer: ReturnType<typeof setTimeout> | null = null;
  const RECOVERY_POLL_MS = 30_000;

  const stopRecoveryPoll = () => {
    if (recoveryPollTimer) {
      clearTimeout(recoveryPollTimer);
      recoveryPollTimer = null;
    }
  };

  const enrichDescription = (tool: ToolSchema): string => {
    let desc = tool.description;
    if (tool.guidance.bestFor.length > 0) desc += `\n\nBest for: ${tool.guidance.bestFor.join("; ")}`;
    if (tool.guidance.notes && tool.guidance.notes.length > 0) desc += `\nNotes: ${tool.guidance.notes.join("; ")}`;
    desc += `\nReturns: ${tool.guidance.returns}`;
    return desc;
  };

  const toMcpTool = (tool: ToolSchema) => ({
    name: tool.name,
    description: enrichDescription(tool),
    inputSchema: tool.inputSchema as { type: "object"; properties?: Record<string, unknown> },
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  });

  // Recovery function — shared between manual trigger and auto-poll
  const attemptRecovery = async (): Promise<boolean> => {
    let tokens: StoredTokens | null;
    try {
      tokens = await CREDENTIALS.load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[rogue-arena-mcp] Credential store unreadable (${CREDENTIALS.describe()}): ${message}`);
      return false;
    }
    if (!tokens) return false;
    if (tokens.refreshToken === lastSeenRefreshToken) return false;

    console.error("[rogue-arena-mcp] New tokens detected in " + CREDENTIALS.describe() + " — attempting recovery...");
    lastSeenRefreshToken = tokens.refreshToken;

    try {
      const auth = new KeycloakAuthProvider(HUB_URL, CLIENT_ID, tokens, CREDENTIALS, LOGIN_HINT);
      const hub = new HubClient(HUB_URL, auth);
      const { tools: hubTools, unavailableFamilies } = await discoverAllTools(hub);
      setUnavailableToolFamilies(unavailableFamilies);

      // Success — rebuild tool list
      const userInfo = auth.getUserInfo();
      currentAuthState = { status: "ok", username: userInfo.username, userId: userInfo.userId };

      const alwaysTools = hubTools.filter((t) => t.mcpVisibility !== "discoverable");
      const discoverableTools = hubTools.filter((t) => t.mcpVisibility === "discoverable");
      setDiscoverableTools(discoverableTools);
      setAlwaysTools(alwaysTools);

      const metaToolList = META_TOOLS.map((meta) => ({
        name: meta.name, description: meta.description, inputSchema: meta.inputSchema,
      }));
      const localToolList = LOCAL_TOOLS.map((t) => ({
        name: t.name, description: t.description, inputSchema: t.inputSchema,
      }));

      // Rebuild listed tools in-place
      listedTools.length = 0;
      listedTools.push(AUTH_STATUS_TOOL, ...metaToolList, ...localToolList, ...alwaysTools.map(toMcpTool));
      setToolPromotion(listedTools, toMcpTool);

      // Set recovered state for CallTool handler
      recoveredAuth = auth;
      recoveredHub = hub;
      recoveredSession = new Session(userInfo.userId, userInfo.username, PROFILE.sessionFilePath);
      recoveredCallableTools = new Map(hubTools.map((t) => [t.name, t]));

      // Notify client
      void server.notification({ method: "notifications/tools/list_changed" });

      // Start background refresh, stop recovery poll
      startBackgroundRefresh(auth);
      stopRecoveryPoll();

      console.error(`[rogue-arena-mcp] RECOVERED — ${listedTools.length} tools now available`);
      return true;
    } catch (err) {
      console.error(`[rogue-arena-mcp] Recovery failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  };

  const startRecoveryPoll = () => {
    const poll = () => {
      recoveryPollTimer = setTimeout(async () => {
        const recovered = await attemptRecovery();
        if (!recovered) poll();
      }, RECOVERY_POLL_MS);
      recoveryPollTimer.unref();
    };
    poll();
    console.error("[rogue-arena-mcp] Recovery poll started (checking keychain every 30s)");
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listedTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const callArgs = (args ?? {}) as Record<string, unknown>;

    // Auth status — always available, doubles as manual recovery trigger (Layer 5A)
    if (name === "rogue_auth_status") {
      const refusal = authStatusArgsRefusal(callArgs);
      if (refusal) return refusal;
      if (currentAuthState.status !== "ok") {
        const recovered = await attemptRecovery();
        if (recovered) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                authStatus: "recovered",
                message: `Authentication recovered. ${listedTools.length} tools now available.`,
                username: (currentAuthState as { username?: string }).username,
              }, null, 2),
            }],
          };
        }
      }
      return buildAuthStatusResponse();
    }

    // After recovery, route to the recovered handlers
    if (recoveredAuth && recoveredHub && recoveredSession) {
      if (isMetaTool(name)) {
        try {
          const { toolsPromoted, ...mcpResult } = await handleMetaTool(name, callArgs, recoveredSession, recoveredHub, IDENTITY);
          if (toolsPromoted) {
            void server.notification({ method: "notifications/tools/list_changed" });
          }
          return mcpResult;
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
      }

      if (isLocalTool(name)) {
        try {
          return await handleLocalTool(name, callArgs, recoveredAuth, recoveredHub);
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
      }

      const toolSchema = recoveredCallableTools?.get(name);
      if (toolSchema) {
        try {
          let result;
          if (toolSchema.category === "PLUGIN_DEV") {
            result = await recoveredHub.executePluginDevTool(name, callArgs);
          } else if (toolSchema.category === "ACTIVE_DEPLOYMENT") {
            result = await recoveredHub.executeActiveDeploymentTool(name, callArgs);
          } else {
            const canvasVersionId = recoveredSession.requireCanvas();
            result = await recoveredHub.executeTool(name, canvasVersionId, callArgs);
          }

          if (!result.success) {
            return { content: [{ type: "text" as const, text: `Tool ${name} failed: ${result.error}` }], isError: true };
          }

          const screenshotResponse = await tryBuildScreenshotResponse(name, result.data);
          if (screenshotResponse) return screenshotResponse;

          return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
        }
      }

      return unknownToolResponse(name);
    }

    return {
      content: [{
        type: "text" as const,
        text: `Tool "${name}" is unavailable — Rogue Arena authentication is broken. Call the rogue_auth_status tool for details.`,
      }],
      isError: true,
    };
  });

  // Start the recovery poll
  startRecoveryPoll();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[rogue-arena-mcp] MCP server running in DEGRADED mode (auth status tool only)");
}

main().catch((err) => {
  console.error(`[rogue-arena-mcp] Fatal: ${err}`);
  process.exit(1);
});
