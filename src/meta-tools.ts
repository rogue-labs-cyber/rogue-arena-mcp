import { z } from "zod";
import type { Session } from "./session.js";
import type { HubClient, ToolSchema } from "./hub-client.js";

let discoverableToolsCache: ToolSchema[] = [];
let alwaysToolsCache: ToolSchema[] = [];

/** Set of tool names currently in the ListTools response */
const promotedToolNames = new Set<string>();

/** Callback to convert a hub tool to MCP tool format — set by index.ts */
let toMcpToolFn: ((tool: ToolSchema) => Record<string, unknown>) | undefined;

/** The mutable listed tools array — set by index.ts */
let listedToolsRef: Array<Record<string, unknown>> | undefined;

export function setDiscoverableTools(tools: ToolSchema[]): void {
  discoverableToolsCache = tools;
}

export function setAlwaysTools(tools: ToolSchema[]): void {
  alwaysToolsCache = tools;
}

export function clearPromotedTools(): void {
  promotedToolNames.clear();
}

export function setToolPromotion(
  listedTools: Array<Record<string, unknown>>,
  toMcpTool: (tool: ToolSchema) => Record<string, unknown>
): void {
  listedToolsRef = listedTools;
  toMcpToolFn = toMcpTool;
}

export const META_TOOLS = [
  {
    name: "rogue_set_canvas",
    description:
      "Set the active canvas version ID for this session. Must be called before using any other Rogue Arena tool. Get the canvas ID from the Rogue Arena UI URL.",
    inputSchema: {
      type: "object" as const,
      properties: {
        canvasVersionId: {
          type: "string",
          format: "uuid",
          description: "The UUID of the canvas version to work on",
        },
      },
      required: ["canvasVersionId"],
      additionalProperties: false,
    },
  },
  {
    name: "rogue_whoami",
    description:
      "Show the current authenticated user context (user ID, username, session canvas). Useful for debugging auth issues.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "discover_tools",
    description:
      "Search for additional Rogue Arena tools beyond the core set. Use this when you need specialized tools for deploy monitoring, exploit paths, file seeding, AD enrichment, user management, or other advanced operations. Discovered tools are automatically registered and become callable.",
    inputSchema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          description:
            "Filter by category: ROGUE_ARCHITECT_BUILDER, PLUGIN_DEV, ACTIVE_DEPLOYMENT, CURRICULUM",
        },
        subcategory: {
          type: "string",
          description:
            "Filter within ROGUE_ARCHITECT_BUILDER by domain: canvas, forest, vlan, machine, assigned_plugin, plugin_catalog, files, deploy, exploit",
        },
        search: {
          type: "string",
          description:
            "Keyword search across tool names and descriptions (e.g., 'forest', 'file seeding', 'deploy')",
        },
      },
      additionalProperties: false,
    },
  },
];

export interface MetaToolResult {
  content: Array<{ type: "text"; text: string }>;
  toolsPromoted?: boolean;
  isError?: boolean;
}

// ── Zod schemas ──────────────────────────────────────────────────────

const SetCanvasSchema = z
  .object({
    canvasVersionId: z.string().uuid(),
  })
  .strict();

const WhoAmISchema = z.object({}).strict();

const DiscoverToolsSchema = z
  .object({
    category: z.string().optional(),
    subcategory: z.string().optional(),
    search: z.string().optional(),
  })
  .strict();

function parseInput<T>(
  schema: z.ZodType<T>,
  args: Record<string, unknown>
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(args);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    error: result.error.issues
      .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
      .join("; "),
  };
}

export async function handleMetaTool(
  toolName: string,
  args: Record<string, unknown>,
  session: Session,
  hub: HubClient
): Promise<MetaToolResult> {
  switch (toolName) {
    case "rogue_set_canvas": {
      const parsed = parseInput(SetCanvasSchema, args);
      if (!parsed.success) {
        return { content: [{ type: "text", text: parsed.error }], isError: true };
      }
      const { canvasVersionId } = parsed.data;

      try {
        await hub.validateCanvas(canvasVersionId);
      } catch {
        return {
          content: [{ type: "text", text: `Canvas '${canvasVersionId}' not found or you don't have edit access to it.` }],
          isError: true,
        };
      }

      session.setCanvas(canvasVersionId);
      return {
        content: [
          {
            type: "text",
            text: `Canvas set to: ${canvasVersionId}. All tool calls will now operate on this canvas.`,
          },
        ],
      };
    }

    case "rogue_whoami": {
      const parsed = parseInput(WhoAmISchema, args);
      if (!parsed.success) {
        return { content: [{ type: "text", text: parsed.error }], isError: true };
      }

      // Live auth check — try hitting the hub to verify the token still works
      let authStatus: "ok" | "expired" | "error" = "ok";
      let authDetail = "";
      try {
        await hub.discoverTools();
        authStatus = "ok";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("expired") || msg.includes("401") || msg.includes("invalid_client")) {
          authStatus = "expired";
          authDetail = "Session expired. Run: rogue-mcp login";
        } else {
          authStatus = "error";
          authDetail = msg;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                userId: session.userId,
                username: session.username,
                canvasVersionId: session.canvasVersionId ?? "(not set)",
                authStatus,
                ...(authDetail ? { authDetail } : {}),
              },
              null,
              2
            ),
          },
        ],
        ...(authStatus !== "ok" ? { isError: true } : {}),
      };
    }

    case "discover_tools": {
      const parsed = parseInput(DiscoverToolsSchema, args);
      if (!parsed.success) {
        return { content: [{ type: "text", text: parsed.error }], isError: true };
      }
      const { category, subcategory, search } = parsed.data;

      if (!category && !subcategory && !search) {
        return {
          content: [
            {
              type: "text",
              text: "Provide at least one of 'category', 'subcategory', or 'search' to discover tools.",
            },
          ],
          isError: true,
        };
      }

      // Search all hub tools (both always-visible and discoverable).
      let results = [...alwaysToolsCache, ...discoverableToolsCache];

      if (category) {
        const upper = category.toUpperCase();
        results = results.filter((t) => t.category.toUpperCase() === upper);
      }

      if (subcategory) {
        const appliedCategory = category?.toUpperCase();
        const rabOnly = !appliedCategory || appliedCategory === "ROGUE_ARCHITECT_BUILDER";
        if (rabOnly) {
          const lower = subcategory.toLowerCase();
          results = results.filter((t) => t.subcategory?.toLowerCase() === lower);
        }
      }

      if (search) {
        const lower = search.toLowerCase();
        results = results.filter(
          (t) =>
            t.name.toLowerCase().includes(lower) ||
            t.description.toLowerCase().includes(lower)
        );
      }

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No tools found matching ${[category ? `category="${category}"` : "", subcategory ? `subcategory="${subcategory}"` : "", search ? `search="${search}"` : ""].filter(Boolean).join(" and ")}. Try a broader search or different category.`,
            },
          ],
        };
      }

      // Promote discovered tools to the ListTools response
      let newlyPromoted = 0;
      if (listedToolsRef && toMcpToolFn) {
        for (const tool of results) {
          if (!promotedToolNames.has(tool.name)) {
            promotedToolNames.add(tool.name);
            listedToolsRef.push(toMcpToolFn(tool));
            newlyPromoted++;
          }
        }
      }

      const summaries = results.map((t) => ({
        name: t.name,
        description: t.description.split("\n")[0],
        category: t.category,
        bestFor: t.guidance.bestFor,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(summaries, null, 2),
          },
        ],
        toolsPromoted: newlyPromoted > 0,
      };
    }

    default:
      throw new Error(`Unknown meta-tool: ${toolName}`);
  }
}

export function isMetaTool(toolName: string): boolean {
  return META_TOOLS.some((t) => t.name === toolName);
}
