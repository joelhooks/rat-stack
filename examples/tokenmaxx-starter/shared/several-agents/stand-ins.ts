import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { contextFromEnv } from "../core/context.ts";

// Loaded with `-e` into the environment's own Pis only, never a guest's. Two
// stand-ins for what a guest built in earlier steps, so the 05.1 check never
// depends on them: a wait that wakes the session when a condition holds, and
// a message to another session whose reply wakes it. Each notes what it's
// parked on in `<state dir>/parked.jsonl`, the way a real one keeps its
// pending work in storage. Neither ever fires: the environment's sessions
// stay parked until it stops them.
//
// Kept free of Effect: Pi loads it straight from source.

export const parkedPath = (stateDir: string) => join(stateDir, "parked.jsonl");

function note(entry: Record<string, unknown>): void {
  try {
    const path = parkedPath(contextFromEnv().stateDir);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      `${JSON.stringify({
        ...entry,
        session: process.env["TMX_SESSION"] ?? null,
        at: new Date().toISOString(),
      })}\n`
    );
  } catch {
    // A note we can't write must never break the session.
  }
}

const text = (body: string) => ({
  content: [{ type: "text" as const, text: body }],
  details: {},
});

export default function standIns(pi: ExtensionAPI) {
  pi.registerTool({
    name: "await_condition",
    label: "Await condition",
    description:
      "Wait in the background until a shell command exits 0, then wake this session with the result. Returns at once.",
    parameters: Type.Object({
      condition: Type.String({ description: "Shell command; exit 0 = done" }),
      about: Type.String({ description: "What is being waited on" }),
    }),
    async execute(_id, params) {
      note({ kind: "wait", condition: params.condition, about: params.about });
      return text(
        `Waiting on ${params.about} until \`${params.condition}\` exits 0. This session wakes when it does.`
      );
    },
  });
  pi.registerTool({
    name: "message_session",
    label: "Message session",
    description:
      "Send a message to another session by name. Its reply arrives here as a message and wakes this session.",
    parameters: Type.Object({
      to: Type.String({ description: "The other session's name" }),
      text: Type.String({ description: "The message" }),
    }),
    async execute(_id, params) {
      note({ kind: "message", to: params.to });
      return text(
        `Delivered to ${params.to}. Their reply will arrive here as a message and wake this session.`
      );
    },
  });
}
