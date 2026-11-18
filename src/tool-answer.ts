import { z } from "zod";

/** A field a call sent that the tool does not take: its place, and the nearest field the tool does take (null: none is near). */
const NotUsedFieldSchema = z.object({
  path: z.string(),
  nearest: z.string().nullable(),
});

/** A field a refused call got wrong: its place, what the tool takes there, and what the call sent. */
const RefusedFieldSchema = z.object({
  path: z.string(),
  expected: z.string(),
  got: z.string(),
});

/**
 * What a hub tool answers on every tool route. `success`, `data` and `error` are the answer; every other field is
 * the hub's note on the call.
 *
 * Done: `notUsed` lists what the call sent and the tool left out, `readAs` each reading the hub made of a value it
 * could not take as sent, and `changed: false` says a write applied nothing.
 *
 * Refused: `kind` and `code` name the failure, `hint` is the fix, `retryAfterSeconds` says when the same call can
 * succeed, `fields` are the fields at fault, and `changed` is false, or "unknown" when a write was sent and its
 * outcome is not known.
 *
 * A note of another type is ignored rather than failing the whole answer.
 */
const ToolAnswerSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional().catch(undefined),
  notUsed: z.array(NotUsedFieldSchema).optional().catch(undefined),
  readAs: z.array(z.string()).optional().catch(undefined),
  changed: z.union([z.boolean(), z.literal("unknown")]).optional().catch(undefined),
  kind: z.string().optional().catch(undefined),
  code: z.string().optional().catch(undefined),
  hint: z.string().optional().catch(undefined),
  retryAfterSeconds: z.number().nonnegative().optional().catch(undefined),
  fields: z.array(RefusedFieldSchema).optional().catch(undefined),
});

export type ToolAnswer = z.infer<typeof ToolAnswerSchema>;

type TextContent = { type: "text"; text: string };

/** Reads a 2xx tool route body as a tool answer. Throws when the body is not one. */
export function readToolAnswer(body: unknown, label: string): ToolAnswer {
  const parsed = ToolAnswerSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`The hub's answer to ${label} could not be read: it carries no success flag.`);
  }
  return parsed.data;
}

/** Ends `text` with a full stop unless it already ends a sentence. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Everything a refusal says, for an MCP caller to act on. The first line is the hub's own reason. The lines after it
 * are the hub's notes, each present only when the hub sent it: the code, the fix, the fields at fault, when to try
 * again, and whether anything was changed.
 */
export function toolRefusalText(name: string, answer: ToolAnswer): string {
  const lines = [`Tool ${name} failed: ${answer.error ?? "the hub gave no reason"}`];
  if (answer.code !== undefined) {
    lines.push(answer.kind === undefined ? `Code: ${answer.code}` : `Code: ${answer.code} (${answer.kind})`);
  }
  if (answer.hint !== undefined) lines.push(`Hint: ${sentence(answer.hint)}`);
  if (answer.fields !== undefined && answer.fields.length > 0) {
    lines.push("Fields:");
    for (const field of answer.fields) {
      lines.push(`- ${field.path}: expected ${field.expected}, got ${field.got}`);
    }
  }
  if (answer.retryAfterSeconds !== undefined) {
    lines.push(`The same call can succeed after ${answer.retryAfterSeconds} seconds.`);
  }
  if (answer.changed === "unknown") {
    lines.push("A write was sent and its outcome is not known. Read the current state before sending it again.");
  } else if (answer.changed === false) {
    lines.push("Nothing was changed.");
  }
  return lines.join("\n");
}

/**
 * The hub's notes on a call that was done, or null when it has none: a write that applied nothing, the fields the
 * tool left out, and the readings the hub made. A caller reads these before the data, so a call that did less than
 * it asked is never taken for a plain success.
 */
export function toolAnswerNotes(answer: ToolAnswer): string | null {
  const lines: string[] = [];
  if (answer.changed === false) lines.push("Nothing was changed.");
  if (answer.notUsed !== undefined && answer.notUsed.length > 0) {
    lines.push("Not used:");
    for (const field of answer.notUsed) {
      lines.push(
        field.nearest === null
          ? `- ${field.path}: the tool takes no field like it`
          : `- ${field.path}: the tool does not take it; the nearest field it takes is ${field.nearest}`
      );
    }
  }
  if (answer.readAs !== undefined && answer.readAs.length > 0) {
    lines.push("Read as:");
    for (const reading of answer.readAs) lines.push(`- ${reading}`);
  }
  return lines.length === 0 ? null : lines.join("\n");
}

/** The notes as the first block of a done call's content; nothing when the hub sent none. */
export function toolAnswerNoteContent(answer: ToolAnswer): TextContent[] {
  const notes = toolAnswerNotes(answer);
  return notes === null ? [] : [{ type: "text", text: notes }];
}

/** What an MCP caller is handed for a hub tool's answer: the refusal in full, or the notes and then the data. */
export function toolAnswerResponse(name: string, answer: ToolAnswer): { content: TextContent[]; isError?: boolean } {
  if (!answer.success) {
    return { content: [{ type: "text", text: toolRefusalText(name, answer) }], isError: true };
  }
  return {
    content: [...toolAnswerNoteContent(answer), { type: "text", text: JSON.stringify(answer.data, null, 2) }],
  };
}
