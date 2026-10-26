import { z } from "zod";

/** The hub's JSON body limit for one MCP tool call: 20 MB on every MCP route. */
export const HUB_MCP_BODY_LIMIT_BYTES = 20 * 1024 * 1024;

/** The hub's text for an unhandled error. It says nothing. */
const HUB_GENERIC_MESSAGE = "Error processing request";

/** How much of a body that is not an error envelope (a proxy's text or HTML page) is kept. */
const RAW_BODY_MAX_CHARS = 1000;

/**
 * The error envelopes a refusal arrives in: the hub's error body
 * (`{errorSeverity, errorMessage}`), its auth check (`{message}`), its canvas
 * check (`{error}`) and the API gateway (`{error_msg}`). A field of another
 * type is ignored rather than failing the whole parse.
 */
const ErrorEnvelopeSchema = z.object({
  errorMessage: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
  message: z.string().optional().catch(undefined),
  error_msg: z.string().optional().catch(undefined),
});

/** A non-2xx answer from the hub (or the vaults service behind the same gateway). */
export class HubRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HubRequestError";
    this.status = status;
  }
}

export interface HubFailureContext {
  /** The terminal command that logs this server's profile back in. */
  readonly loginCommand: string;
  /** Size of the request body that was sent, named on a 413. */
  readonly requestBytes?: number;
}

/** Drops control characters (keeps tab and newline) so a body cannot smuggle terminal escapes. */
function printable(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "").trim();
}

function capped(text: string): string {
  return text.length > RAW_BODY_MAX_CHARS ? `${text.slice(0, RAW_BODY_MAX_CHARS)}… (truncated)` : text;
}

function envelopeMessage(body: string): string | undefined {
  try {
    const parsed = ErrorEnvelopeSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return undefined;
    const { errorMessage, error, message, error_msg } = parsed.data;
    const text = printable(errorMessage ?? error ?? message ?? error_msg ?? "");
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

/**
 * The human-readable part of an error body: the envelope's message, never cut;
 * an HTML page's title; otherwise the body itself, capped.
 */
export function hubErrorText(body: string): string {
  const trimmed = body.trim();
  if (trimmed === "") return "";
  const fromEnvelope = envelopeMessage(trimmed);
  if (fromEnvelope !== undefined) return fromEnvelope;
  if (trimmed.startsWith("<")) {
    const title = /<title>([^<]*)<\/title>/i.exec(trimmed);
    const text = title ? title[1] : trimmed.replace(/<[^>]*>/g, " ");
    return capped(printable(text.replace(/\s+/g, " ")));
  }
  return capped(printable(trimmed));
}

/** Ends `text` with a full stop unless it already ends a sentence. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One line an MCP caller (Claude Code, Claude Desktop) can act on, for a
 * non-2xx hub response. It leads with the hub's own message and adds the next
 * step only where the status implies one.
 */
export function describeHubFailure(status: number, body: string, context: HubFailureContext): string {
  const text = hubErrorText(body);
  const said = text === "" ? `HTTP ${status} with no message` : text;
  const saidSentence = sentence(said);

  if (status === 401) {
    return (
      `Hub refused (401): ${saidSentence} The hub did not accept this server's Rogue Arena session. ` +
      `Ask the user to run \`${context.loginCommand}\` in a terminal, then retry the call. ` +
      "If it still fails after logging in, reconnect this MCP server."
    );
  }

  if (status === 413) {
    const sent = context.requestBytes === undefined ? "" : ` (${megabytes(context.requestBytes)})`;
    const hubSaid = text === "" || text === HUB_GENERIC_MESSAGE ? "" : ` Hub said: ${text}`;
    return (
      `Hub refused (413): the request${sent} is larger than the hub accepts for one tool call ` +
      `(${megabytes(HUB_MCP_BODY_LIMIT_BYTES)} of JSON). Send less per call, for example by splitting the content across several calls.${hubSaid}`
    );
  }

  if (status === 429) {
    return `Hub refused (429): ${saidSentence} Too many requests; wait a little before retrying.`;
  }

  if (status === 502 || status === 503 || status === 504) {
    return `Hub error (${status}): ${saidSentence} The hub is unavailable or overloaded right now; wait a minute and retry.`;
  }

  if (status >= 500) {
    return (
      `Hub error (${status}): ${saidSentence} The hub failed while handling this call. ` +
      "Retry once; if it fails the same way again, stop and tell the user so it can be reported."
    );
  }

  if (status >= 400) {
    return `Hub refused (${status}): ${said}`;
  }

  return `Hub returned HTTP ${status}: ${said}`;
}
