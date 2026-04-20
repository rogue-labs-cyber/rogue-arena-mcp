import type { AuthProvider } from "./auth.js";

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

function sanitizeErrorBody(text: string, maxLength = 200): string {
  return text.replace(/[^\x20-\x7E\n]/g, "").slice(0, maxLength);
}

interface FetchWithRetryOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  auth: AuthProvider;
  label: string;
  signal?: AbortSignal;
}

async function fetchWithRetry(opts: FetchWithRetryOptions): Promise<Response> {
  let res = await fetch(opts.url, {
    method: opts.method,
    headers: opts.headers,
    ...(opts.body ? { body: opts.body } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (res.status === 401) {
    console.error(`[rogue-arena-mcp] ${opts.label}: got 401, forcing token refresh and retrying`);
    opts.auth.invalidateAccessToken();
    const freshHeaders = await opts.auth.getHeaders();
    res = await fetch(opts.url, {
      method: opts.method,
      headers: freshHeaders,
      ...(opts.body ? { body: opts.body } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  }

  return res;
}

export class HubClient {
  private hubUrl: string;
  private auth: AuthProvider;

  constructor(hubUrl: string, auth: AuthProvider) {
    this.hubUrl = hubUrl.replace(/\/$/, "");
    this.auth = auth;
  }

  async discoverTools(): Promise<ToolSchema[]> {
    const headers = await this.auth.getHeaders();
    const res = await fetch(`${this.hubUrl}/hub/mcp/vibe-tools/schema`, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tool discovery failed (${res.status}): ${sanitizeErrorBody(text)}`);
    }

    const body = (await res.json()) as { tools: ToolSchema[] };
    return body.tools;
  }

  async discoverPluginDevTools(): Promise<ToolSchema[]> {
    const headers = await this.auth.getHeaders();
    const res = await fetch(
      `${this.hubUrl}/hub/mcp/plugin-dev-tools/schema`,
      { method: "GET", headers }
    );

    if (!res.ok) {
      // Plugin dev tools route may not exist yet — return empty
      console.error(
        `[rogue-arena-mcp] Plugin dev tool discovery returned ${res.status} — skipping`
      );
      return [];
    }

    const body = (await res.json()) as { tools: ToolSchema[] };
    return body.tools;
  }

  async executePluginDevTool(
    actionType: string,
    input: Record<string, unknown>
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const headers = await this.auth.getHeaders();
    const url = `${this.hubUrl}/hub/mcp/plugin-dev-tools/${encodeURIComponent(actionType)}`;
    const body = JSON.stringify({ input });

    const res = await fetchWithRetry({
      url, method: "POST", headers, body,
      auth: this.auth, label: `plugin-dev/${actionType}`,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Plugin dev tool execution failed (${res.status}): ${sanitizeErrorBody(text)}`);
    }

    return (await res.json()) as { success: boolean; data?: unknown; error?: string };
  }

  async discoverActiveDeploymentTools(): Promise<ToolSchema[]> {
    const headers = await this.auth.getHeaders();
    const res = await fetch(
      `${this.hubUrl}/hub/mcp/active-deployment-tools/schema`,
      { method: "GET", headers }
    );

    if (!res.ok) {
      console.error(
        `[rogue-arena-mcp] Active deployment tool discovery returned ${res.status} — skipping`
      );
      return [];
    }

    const body = (await res.json()) as { tools: ToolSchema[] };
    return body.tools;
  }

  async executeActiveDeploymentTool(
    actionType: string,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const headers = await this.auth.getHeaders();
    const url = `${this.hubUrl}/hub/mcp/active-deployment-tools/${encodeURIComponent(actionType)}`;
    const body = JSON.stringify({ input });

    const res = await fetchWithRetry({
      url, method: "POST", headers, body,
      auth: this.auth, label: `active-deployment/${actionType}`,
      signal: options?.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Active deployment tool execution failed (${res.status}): ${sanitizeErrorBody(text)}`);
    }

    return (await res.json()) as { success: boolean; data?: unknown; error?: string };
  }

  async validateCanvas(canvasVersionId: string): Promise<void> {
    const headers = await this.auth.getHeaders();
    const res = await fetch(
      `${this.hubUrl}/hub/mcp/vibe-tools/validate-canvas`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ canvasVersionId }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`[rogue-arena-mcp] validate-canvas failed: ${res.status} ${sanitizeErrorBody(text)}`);
      const body = (() => { try { return JSON.parse(text); } catch { return { error: text }; } })() as { error?: string };
      throw new Error(body.error ?? "Canvas validation failed");
    }
  }

  async executeTool(
    actionType: string,
    canvasVersionId: string,
    input: Record<string, unknown>
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const headers = await this.auth.getHeaders();
    const url = `${this.hubUrl}/hub/mcp/vibe-tools/${encodeURIComponent(actionType)}`;
    const body = JSON.stringify({ canvasVersionId, input });

    const res = await fetchWithRetry({
      url, method: "POST", headers, body,
      auth: this.auth, label: `vibe/${actionType}`,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tool execution failed (${res.status}): ${sanitizeErrorBody(text)}`);
    }

    return (await res.json()) as { success: boolean; data?: unknown; error?: string };
  }
}
