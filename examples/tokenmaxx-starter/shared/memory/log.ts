import { randomBytes } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { Schema } from "effect";

import { isTempFile, readJson, writeJsonAtomic } from "#shared/core/store.ts";

// The memory piece's event log, under the exercise's state dir:
//
//   events/<ms>-<hex>.json   one file per event, written once, never edited.
//
// Every event carries the workshop session that caused it (TMX_SESSION, or
// null from a plain terminal). Nothing here records an entry's text or a
// rejection's reason: reading the log tells you what happened, not what the
// house rule is. The rule itself is stored sealed (see ./rules.ts).

export const Session = Schema.NullOr(Schema.String);

/** The house rule now in force. Version 1 comes from setup; each change adds one. */
export const RuleSet = Schema.TaggedStruct("RuleSet", {
  version: Schema.Number,
  salt: Schema.String,
  seal: Schema.String,
  at: Schema.String,
  session: Session,
});

/** A task handed to one session. */
export const TaskIssued = Schema.TaggedStruct("TaskIssued", {
  taskId: Schema.String,
  service: Schema.String,
  release: Schema.String,
  first: Schema.String,
  last: Schema.String,
  summary: Schema.String,
  at: Schema.String,
  session: Session,
});

export const Verdict = Schema.Literals(["accepted", "rule", "content"]);
export type Verdict = typeof Verdict.Type;

/**
 * One hand-in. `rule`: it broke the house rule in force. `content`: it left
 * out the service, the release or the person. `usedRetired`: it wrote the
 * person the way a rule that has since changed says to.
 */
export const Submitted = Schema.TaggedStruct("Submitted", {
  taskId: Schema.String,
  ruleVersion: Schema.Number,
  verdict: Verdict,
  usedRetired: Schema.Boolean,
  at: Schema.String,
  session: Session,
});

export const MemoryEvent = Schema.Union([RuleSet, TaskIssued, Submitted]);
export type MemoryEvent = typeof MemoryEvent.Type;
export type RuleSet = typeof RuleSet.Type;
export type TaskIssued = typeof TaskIssued.Type;
export type Submitted = typeof Submitted.Type;

export const eventsDir = (stateDir: string) => join(stateDir, "events");

let lastStamp = 0;

/** Appends one event. File names sort in write order within one process. */
export async function appendEvent(
  stateDir: string,
  event: MemoryEvent
): Promise<void> {
  const stamp = Math.max(Date.now(), lastStamp + 1);
  lastStamp = stamp;
  const suffix = randomBytes(4).toString("hex");
  const name = `${String(stamp).padStart(15, "0")}-${suffix}.json`;
  await writeJsonAtomic(join(eventsDir(stateDir), name), event);
}

/** Every event, oldest first. No events dir means no events. */
export async function readEvents(stateDir: string): Promise<MemoryEvent[]> {
  let names: string[];
  try {
    names = await readdir(eventsDir(stateDir));
  } catch {
    return [];
  }
  const files = names
    .filter((name) => name.endsWith(".json") && !isTempFile(name))
    .toSorted();
  const events: MemoryEvent[] = [];
  for (const name of files) {
    events.push(await readJson(join(eventsDir(stateDir), name), MemoryEvent));
  }
  return events;
}

export async function resetLog(stateDir: string): Promise<void> {
  await rm(eventsDir(stateDir), { recursive: true, force: true });
}

export const newTaskId = () =>
  `tsk_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;

/** The rule versions in force, oldest first. */
export const ruleSets = (events: readonly MemoryEvent[]): RuleSet[] =>
  events.filter((e): e is RuleSet => e._tag === "RuleSet");

/** The newest task issued to `session`, and whether it was accepted. */
export function openTask(
  events: readonly MemoryEvent[],
  session: string | null
): { task: TaskIssued; accepted: boolean } | null {
  let task: TaskIssued | null = null;
  let accepted = false;
  for (const event of events) {
    if (event._tag === "TaskIssued" && event.session === session) {
      task = event;
      accepted = false;
    } else if (
      event._tag === "Submitted" &&
      task !== null &&
      event.taskId === task.taskId &&
      event.verdict === "accepted"
    ) {
      accepted = true;
    }
  }
  return task === null ? null : { task, accepted };
}
