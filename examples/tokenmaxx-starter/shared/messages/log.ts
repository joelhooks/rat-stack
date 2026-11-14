import { randomBytes } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { Schema } from "effect";

import { sha256 } from "#shared/core/ids.ts";
import { isTempFile, readJson, writeJsonAtomic } from "#shared/core/store.ts";

// The messages piece's event log, under the exercise's state dir:
//
//   events/<ms>-<hex>.json   one file per event, written once, never edited.
//
// Every event carries the workshop session that caused it (TMX_SESSION, or
// null from a plain terminal). A secret is stored only as a salted hash, so
// reading the state folder never hands one session another's secret: it has
// to be asked for.

export const Session = Schema.NullOr(Schema.String);

/** `setup` ran. `setup` also clears the log, so this is the first event. */
export const StartedOver = Schema.TaggedStruct("StartedOver", {
  at: Schema.String,
  session: Session,
});

/** A session asked for a secret and was shown one. */
export const Revealed = Schema.TaggedStruct("Revealed", {
  salt: Schema.String,
  hash: Schema.String,
  at: Schema.String,
  session: Session,
});

/**
 * A session handed in a secret. `matched` is the reveal it matched, or null
 * when it matched none.
 */
export const Answered = Schema.TaggedStruct("Answered", {
  matched: Schema.NullOr(
    Schema.Struct({ revealedAt: Schema.String, session: Session })
  ),
  at: Schema.String,
  session: Session,
});

export const MessagesEvent = Schema.Union([StartedOver, Revealed, Answered]);
export type MessagesEvent = typeof MessagesEvent.Type;
export type Revealed = typeof Revealed.Type;
export type Answered = typeof Answered.Type;

export const eventsDir = (stateDir: string) => join(stateDir, "events");

let lastStamp = 0;

/** Appends one event. File names sort in write order within one process. */
export async function appendEvent(
  stateDir: string,
  event: MessagesEvent
): Promise<void> {
  const stamp = Math.max(Date.now(), lastStamp + 1);
  lastStamp = stamp;
  const suffix = randomBytes(4).toString("hex");
  const name = `${String(stamp).padStart(15, "0")}-${suffix}.json`;
  await writeJsonAtomic(join(eventsDir(stateDir), name), event);
}

/** Every event, oldest first. No events dir means no events. */
export async function readEvents(stateDir: string): Promise<MessagesEvent[]> {
  let names: string[];
  try {
    names = await readdir(eventsDir(stateDir));
  } catch {
    return [];
  }
  const files = names
    .filter((name) => name.endsWith(".json") && !isTempFile(name))
    .toSorted();
  const events: MessagesEvent[] = [];
  for (const name of files) {
    events.push(await readJson(join(eventsDir(stateDir), name), MessagesEvent));
  }
  return events;
}

export async function resetLog(stateDir: string): Promise<void> {
  await rm(eventsDir(stateDir), { recursive: true, force: true });
}

const words = [
  "amber",
  "birch",
  "cobalt",
  "delta",
  "ember",
  "fjord",
  "garnet",
  "harbor",
  "indigo",
  "juniper",
  "kestrel",
  "lantern",
  "meadow",
  "nickel",
  "orchid",
  "pebble",
  "quartz",
  "raven",
  "saffron",
  "thistle",
];

/** A fresh secret, e.g. `kestrel-orchid-4821`. `random` is in [0, 1). */
export function newSecret(random: () => number): string {
  const word = () => words[Math.floor(random() * words.length)] ?? "amber";
  const digits = String(Math.floor(random() * 10_000)).padStart(4, "0");
  return `${word()}-${word()}-${digits}`;
}

export const newSalt = () => randomBytes(8).toString("hex");

/** Case and surrounding space don't matter: `Amber-Birch-0042 ` matches. */
export function sealSecret(secret: string, salt: string): string {
  return sha256(`${salt}\0${secret.trim().toLowerCase()}`);
}

/** The reveal whose secret this is, or null. */
export function revealOf(
  events: readonly MessagesEvent[],
  secret: string
): Revealed | null {
  return (
    events.findLast(
      (e): e is Revealed =>
        e._tag === "Revealed" && sealSecret(secret, e.salt) === e.hash
    ) ?? null
  );
}

/** When the log starts: the last `setup`, or null if it never ran. */
export function startedAt(events: readonly MessagesEvent[]): string | null {
  return events.findLast((e) => e._tag === "StartedOver")?.at ?? null;
}
