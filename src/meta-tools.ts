import { z } from "zod";
import type { Session } from "./session.js";
import type { HubClient, ToolSchema } from "./hub-client.js";
import { HubRequestError } from "./hub-errors.js";

let discoverableToolsCache: ToolSchema[] = [];
let alwaysToolsCache: ToolSchema[] = [];

/** The hub's tool categories. Only ROGUE_ARCHITECT_BUILDER tools carry a subcategory. */
const ROGUE_ARCHITECT_BUILDER = "ROGUE_ARCHITECT_BUILDER";
const TOOL_CATEGORIES: readonly string[] = [ROGUE_ARCHITECT_BUILDER, "PLUGIN_DEV", "ACTIVE_DEPLOYMENT", "CURRICULUM"];
const ARCHITECT_SUBCATEGORIES: readonly string[] = [
  "canvas", "environment", "forest", "vlan", "machine", "assigned_plugin",
  "plugin_catalog", "files", "deploy", "deployment", "exploit", "eval",
];

/** A tool family whose schema discovery failed when the server started, so its tools cannot be called. */
export interface UnavailableToolFamily {
  /** The hub category, e.g. "PLUGIN_DEV". */
  readonly category: string;
  /** How the caller reads it, e.g. "plugin-dev". */
  readonly label: string;
  /** Every hub tool of the family starts with this, e.g. "plugin_dev_". */
  readonly namePrefix: string;
  /** HTTP status of the failed discovery; absent when the hub never answered. */
  readonly status?: number;
  /** Why discovery failed, as the caller should read it. */
  readonly reason: string;
}

let unavailableFamiliesCache: UnavailableToolFamily[] = [];

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

export function setUnavailableToolFamilies(families: UnavailableToolFamily[]): void {
  unavailableFamiliesCache = families;
}

export function unavailableToolFamilies(): readonly UnavailableToolFamily[] {
  return unavailableFamiliesCache;
}

export function describeUnavailableFamily(family: UnavailableToolFamily, toolName?: string): string {
  const status = family.status === undefined ? "no response" : String(family.status);
  const target = toolName === undefined ? "" : `, so ${toolName} cannot be called`;
  return (
    `${family.label} tools unavailable: discovery failed (${status}) when this MCP server started${target}. ` +
    "Retrying the call will not help: run rogue_auth_status to check the session, then reconnect this MCP server to retry discovery. " +
    `Discovery error: ${family.reason}`
  );
}

/** The failed family a tool name belongs to, if any. */
export function unavailableFamilyForTool(toolName: string): UnavailableToolFamily | undefined {
  return unavailableFamiliesCache.find((family) => toolName.startsWith(family.namePrefix));
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
      "Show the current authenticated user context (user ID, username, session canvas, hub URL, profile). Call this to confirm WHICH Rogue Arena server you are talking to when more than one is mounted.",
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
          description: `Filter by category: ${TOOL_CATEGORIES.join(", ")}`,
        },
        subcategory: {
          type: "string",
          description: `Filter within ${ROGUE_ARCHITECT_BUILDER} by domain (other categories have no subcategories): ${ARCHITECT_SUBCATEGORIES.join(", ")}`,
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

export interface ServerIdentity {
  readonly hubUrl: string;
  readonly profile: string;
  /** The terminal command that logs this profile back in. */
  readonly loginCommand: string;
}

// ── Zod schemas ──────────────────────────────────────────────────────

const SetCanvasSchema = z
  .object({
    canvasVersionId: z.string().uuid(),
  })
  .strict();

/** rogue_whoami and rogue_auth_status take no arguments. */
const NoArgsSchema = z.object({}).strict();

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

/** rogue_auth_status refuses unknown keys, as rogue_whoami does; undefined when the arguments are valid. */
export function authStatusArgsRefusal(args: Record<string, unknown>): MetaToolResult | undefined {
  const parsed = parseInput(NoArgsSchema, args);
  return parsed.success ? undefined : { content: [{ type: "text", text: parsed.error }], isError: true };
}

function canvasRefusal(canvasVersionId: string, err: Error): string {
  if (err instanceof HubRequestError && (err.status === 403 || err.status === 404)) {
    return `Canvas '${canvasVersionId}' not found or you don't have access to it. Check the canvas version ID (it is in the canvas URL in Rogue Arena).`;
  }
  return `Could not select canvas '${canvasVersionId}': ${err.message}`;
}

function discoverRefusal(text: string): MetaToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Every category the caller may name: the hub's four, plus any a newer hub reports. */
function knownCategories(tools: readonly ToolSchema[]): string[] {
  return [...new Set([...TOOL_CATEGORIES, ...tools.map((t) => t.category.toUpperCase())])];
}

/** The architect subcategories the discovered tools actually carry (the help text's list when none are cached). */
function knownSubcategories(tools: readonly ToolSchema[]): string[] {
  const seen = tools.flatMap((t) =>
    t.category.toUpperCase() === ROGUE_ARCHITECT_BUILDER && t.subcategory ? [t.subcategory.toLowerCase()] : []
  );
  return seen.length === 0 ? [...ARCHITECT_SUBCATEGORIES] : [...new Set(seen)].sort();
}

export async function handleMetaTool(
  toolName: string,
  args: Record<string, unknown>,
  session: Session,
  hub: Pick<HubClient, "discoverTools" | "validateCanvas">,
  identity: ServerIdentity
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
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        return { content: [{ type: "text", text: canvasRefusal(canvasVersionId, error) }], isError: true };
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
      const parsed = parseInput(NoArgsSchema, args);
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
        const unauthorized = err instanceof HubRequestError && err.status === 401;
        if (unauthorized || msg.includes("expired") || msg.includes("invalid_client")) {
          authStatus = "expired";
          authDetail = `Session expired. Ask the user to run \`${identity.loginCommand}\` in a terminal.`;
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
                hub: identity.hubUrl,
                profile: identity.profile,
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
      const allTools = [...alwaysToolsCache, ...discoverableToolsCache];
      const categories = knownCategories(allTools);
      const subcategories = knownSubcategories(allTools);
      const categoryHelp = `Valid categories: ${categories.join(", ")}. Subcategories (${ROGUE_ARCHITECT_BUILDER} only): ${subcategories.join(", ")}.`;
      const upperCategory = category ? category.toUpperCase() : undefined;

      if (upperCategory !== undefined && !categories.includes(upperCategory)) {
        return discoverRefusal(`Unknown category "${category}". ${categoryHelp}`);
      }

      if (subcategory) {
        if (upperCategory !== undefined && upperCategory !== ROGUE_ARCHITECT_BUILDER) {
          return discoverRefusal(
            `The subcategory filter applies only to ${ROGUE_ARCHITECT_BUILDER}; ${upperCategory} tools have no subcategories. ` +
              `Drop subcategory "${subcategory}", or use search. ${categoryHelp}`
          );
        }
        if (!subcategories.includes(subcategory.toLowerCase())) {
          return discoverRefusal(`Unknown subcategory "${subcategory}". ${categoryHelp}`);
        }
      }

      const outage = unavailableFamiliesCache.find((family) => family.category === upperCategory);
      if (outage) {
        return discoverRefusal(describeUnavailableFamily(outage));
      }

      let results = allTools;

      if (upperCategory !== undefined) {
        results = results.filter((t) => t.category.toUpperCase() === upperCategory);
      }

      if (subcategory) {
        const lower = subcategory.toLowerCase();
        results = results.filter((t) => t.subcategory?.toLowerCase() === lower);
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
        const outageNote = unavailableFamiliesCache.map((family) => ` ${describeUnavailableFamily(family)}`).join("");
        return {
          content: [
            {
              type: "text",
              text: `No tools found matching ${[category ? `category="${category}"` : "", subcategory ? `subcategory="${subcategory}"` : "", search ? `search="${search}"` : ""].filter(Boolean).join(" and ")}. Try a broader search or different category. ${categoryHelp}${outageNote}`,
            },
          ],
        };
      }

      // Promote discovered tools to the ListTools response. Results include
      // always-listed tools, so a name already listed is never added again.
      let newlyPromoted = 0;
      if (listedToolsRef && toMcpToolFn) {
        const listedNames = new Set(listedToolsRef.map((listed) => listed.name));
        for (const tool of results) {
          if (!listedNames.has(tool.name)) {
            listedNames.add(tool.name);
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
