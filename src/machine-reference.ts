import { z } from "zod";
import { callCanvasCategoryTool } from "./canvas-tool-call.js";
import type { HubClient } from "./hub-client.js";
import type { Session } from "./session.js";
import { toolRefusalText } from "./tool-answer.js";

/** The hub tool a machine's name is looked up in. */
const MACHINE_LIST_TOOL = "architect_machine_list";

/** Machines read per call while looking a name up. */
const MACHINE_LIST_PAGE = 100;

/** How many machine names a "no machine by that name" refusal lists. */
const NAMES_LISTED = 30;

const MachineIdSchema = z.string().uuid();

/** What a machine reference is resolved against: each machine's id and name, and how many machines the canvas holds. */
const MachineListSchema = z.object({
  machines: z.array(z.object({ id: z.string(), nickname: z.string().nullable() })),
  totalCount: z.number(),
});

type ListedMachine = z.infer<typeof MachineListSchema>["machines"][number];

export type MachineReference =
  | { readonly found: true; readonly machineId: string }
  | { readonly found: false; readonly refusal: string };

/** Reads every machine of the bound canvas, a page at a time; a refusal says why the list could not be read. */
async function listMachines(
  hub: Pick<HubClient, "executeTool">,
  session: Pick<Session, "currentCanvas">,
): Promise<{ readonly machines: readonly ListedMachine[] } | { readonly refusal: string }> {
  const machines: ListedMachine[] = [];
  for (;;) {
    const answer = await callCanvasCategoryTool(hub, session, MACHINE_LIST_TOOL, { limit: MACHINE_LIST_PAGE, offset: machines.length });
    if (!answer.success) return { refusal: toolRefusalText(MACHINE_LIST_TOOL, answer) };
    const page = MachineListSchema.safeParse(answer.data);
    if (!page.success) return { refusal: `${MACHINE_LIST_TOOL} answered in a form this client cannot read.` };
    machines.push(...page.data.machines);
    if (page.data.machines.length === 0 || machines.length >= page.data.totalCount) return { machines };
  }
}

function listedNames(machines: readonly ListedMachine[]): string {
  const names = machines.flatMap(({ nickname }) => (nickname === null ? [] : [nickname]));
  if (names.length === 0) return "The canvas has no named machines.";
  const shown = names.slice(0, NAMES_LISTED).join(", ");
  const more = names.length - NAMES_LISTED;
  return more > 0 ? `Machines on this canvas: ${shown}, and ${more} more.` : `Machines on this canvas: ${shown}.`;
}

/**
 * The machine a `machine` field names: its id, or its exact name on the bound canvas. An id is taken as sent. A name
 * is looked up in the hub's machine list and must name exactly one machine; anything else is refused with what the
 * field takes and what to send instead.
 */
export async function resolveMachineReference(
  hub: Pick<HubClient, "executeTool">,
  session: Pick<Session, "currentCanvas">,
  machine: string,
): Promise<MachineReference> {
  if (MachineIdSchema.safeParse(machine).success) return { found: true, machineId: machine };

  const listed = await listMachines(hub, session);
  if ("refusal" in listed) {
    return { found: false, refusal: `Could not look up the machine named "${machine}". ${listed.refusal}` };
  }
  const named = listed.machines.filter(({ nickname }) => nickname === machine);
  if (named.length === 1) return { found: true, machineId: named[0].id };
  if (named.length === 0) {
    return {
      found: false,
      refusal:
        `No machine on the current canvas is named "${machine}". ` +
        `machine takes a machine's exact name or its id. ${listedNames(listed.machines)}`,
    };
  }
  return {
    found: false,
    refusal:
      `${named.length} machines on the current canvas are named "${machine}". ` +
      `Send the id of the one you mean: ${named.map(({ id }) => id).join(", ")}.`,
  };
}
