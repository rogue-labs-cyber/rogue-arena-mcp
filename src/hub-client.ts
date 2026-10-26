import type { AuthProvider } from "./auth.js";
import { describeHubFailure, HubRequestError } from "./hub-errors.js";

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category: string;
  subcategory?: string;
  guidance: {
    bestFor: string[];
    filters?: string[];
    returns: string;
    notes?: string[];
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  mcpVisibility: "always" | "discoverable";
}

interface FetchWithRetryOptions {
  url: string;
  method: string;
  body?: string;
  auth: AuthProvider;
  label: string;
  signal?: AbortSignal;
}

async function fetchWithRetry(opts: FetchWithRetryOptions): Promise<Response> {
  const send = async (): Promise<Response> =>
    fetch(opts.url, {
      method: opts.method,
      headers: await opts.auth.getHeaders(),
      ...(opts.body ? { body: opts.body } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

  const res = await send();
  if (res.status !== 401) return res;

  console.error(`[rogue-arena-mcp] ${opts.label}: got 401, forcing token refresh and retrying`);
  opts.auth.invalidateAccessToken();
  return send();
}

/** Reads a non-2xx response into the error an MCP caller sees. */
async function refusal(res: Response, auth: AuthProvider, requestBody?: string): Promise<HubRequestError> {
  const message = describeHubFailure(res.status, await res.text(), {
    loginCommand: auth.loginCommand,
    ...(requestBody === undefined ? {} : { requestBytes: Buffer.byteLength(requestBody) }),
  });
  return new HubRequestError(res.status, message);
}

export class HubClient {
  private hubUrl: string;
  private auth: AuthProvider;

  constructor(hubUrl: string, auth: AuthProvider) {
    this.hubUrl = hubUrl.replace(/\/$/, "");
    this.auth = auth;
  }

  async discoverTools(): Promise<ToolSchema[]> {
    return this.discover("/hub/mcp/vibe-tools/schema", "vibe/schema");
  }

  /** Throws when the hub does not serve the family's schema; the caller reports the family unavailable. */
  async discoverPluginDevTools(): Promise<ToolSchema[]> {
    return this.discover("/hub/mcp/plugin-dev-tools/schema", "plugin-dev/schema");
  }

  /** Throws when the hub does not serve the family's schema; the caller reports the family unavailable. */
  async discoverActiveDeploymentTools(): Promise<ToolSchema[]> {
    return this.discover("/hub/mcp/active-deployment-tools/schema", "active-deployment/schema");
  }

  private async discover(path: string, label: string): Promise<ToolSchema[]> {
    const res = await fetchWithRetry({
      url: `${this.hubUrl}${path}`, method: "GET",
      auth: this.auth, label,
    });

    if (!res.ok) {
      throw await refusal(res, this.auth);
    }

    const body = (await res.json()) as { tools: ToolSchema[] };
    return body.tools;
  }

  async executePluginDevTool(
    actionType: string,
    input: Record<string, unknown>
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const url = `${this.hubUrl}/hub/mcp/plugin-dev-tools/${encodeURIComponent(actionType)}`;
    const body = JSON.stringify({ input });

    const res = await fetchWithRetry({
      url, method: "POST", body,
      auth: this.auth, label: `plugin-dev/${actionType}`,
    });

    if (!res.ok) {
      throw await refusal(res, this.auth, body);
    }

    return (await res.json()) as { success: boolean; data?: unknown; error?: string };
  }

  async executeActiveDeploymentTool(
    actionType: string,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const url = `${this.hubUrl}/hub/mcp/active-deployment-tools/${encodeURIComponent(actionType)}`;
    const body = JSON.stringify({ input });

    const res = await fetchWithRetry({
      url, method: "POST", body,
      auth: this.auth, label: `active-deployment/${actionType}`,
      signal: options?.signal,
    });

    if (!res.ok) {
      throw await refusal(res, this.auth, body);
    }

    return (await res.json()) as { success: boolean; data?: unknown; error?: string };
  }

  /** Throws a HubRequestError carrying the hub's status when the caller may not open the canvas. */
  async validateCanvas(canvasVersionId: string): Promise<void> {
    const body = JSON.stringify({ canvasVersionId });
    const res = await fetchWithRetry({
      url: `${this.hubUrl}/hub/mcp/vibe-tools/validate-canvas`, method: "POST", body,
      auth: this.auth, label: "vibe/validate-canvas",
    });

    if (!res.ok) {
      const error = await refusal(res, this.auth, body);
      console.error(`[rogue-arena-mcp] validate-canvas failed: ${error.message}`);
      throw error;
    }
  }

  async executeTool(
    actionType: string,
    canvasVersionId: string,
    input: Record<string, unknown>
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const url = `${this.hubUrl}/hub/mcp/vibe-tools/${encodeURIComponent(actionType)}`;
    const body = JSON.stringify({ canvasVersionId, input });

    const res = await fetchWithRetry({
      url, method: "POST", body,
      auth: this.auth, label: `vibe/${actionType}`,
    });

    if (!res.ok) {
      throw await refusal(res, this.auth, body);
    }

    return (await res.json()) as { success: boolean; data?: unknown; error?: string };
  }
}
