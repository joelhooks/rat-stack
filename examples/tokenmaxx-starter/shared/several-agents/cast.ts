import { join } from "node:path";

import type { Script } from "./scripted-model.ts";

// The environment's five sessions and the state each is put in. Each is a
// real Pi, started through `pnpm pi --role <name>`, prompted once, and
// answered by its own script on the scripted model. Their names are fixed,
// so each run resumes the same five Pi conversations instead of adding new
// ones.

/** The three words a guest's tool prints, one per session. */
export const words = ["working", "waiting", "stopped"] as const;
export type Word = (typeof words)[number];

export type Kind =
  | "working"
  | "asking"
  | "parked-wait"
  | "parked-message"
  | "killed";

export type Role = {
  readonly name: string;
  readonly kind: Kind;
  /** What the session is doing, for status and the check's lines. */
  readonly doing: string;
  /** The word a guest's tool should show for it. */
  readonly expect: Word;
  /** The prompt the environment sends it. */
  readonly prompt: string;
};

export const cast: readonly Role[] = [
  {
    name: "kiwi",
    kind: "working",
    doing: "busy on a long tool call",
    expect: "working",
    prompt: "Run the full test suite and tell me when it has finished.",
  },
  {
    name: "lark",
    kind: "asking",
    doing: "asked you a question",
    expect: "waiting",
    prompt: "Make a logo for the landing page.",
  },
  {
    name: "moth",
    kind: "parked-wait",
    doing: "parked its build on a wait",
    expect: "working",
    prompt:
      "Start the release build in the background and pick up its result when it's done.",
  },
  {
    name: "newt",
    kind: "parked-message",
    doing: "waiting on another session's reply",
    expect: "working",
    prompt:
      "Ask the reviewer session whether the API change is approved, then carry on.",
  },
  {
    name: "orca",
    kind: "killed",
    doing: "killed in the middle of a tool call",
    expect: "stopped",
    prompt: "Migrate the database and tell me when it's done.",
  },
];

/** The stand-in wait's condition: a file nothing creates. */
export const buildDonePath = (stateDir: string) => join(stateDir, "build.done");

/** Each session's script, by name. */
export function scriptsFor(stateDir: string): Record<string, Script> {
  const scripts: Record<string, Script> = {};
  for (const role of cast) {
    scripts[role.name] = scriptOf(role.kind, stateDir);
  }
  return scripts;
}

function scriptOf(kind: Kind, stateDir: string): Script {
  switch (kind) {
    case "working":
    case "killed":
      return [
        { tool: "bash", args: { command: "sleep 3600" } },
        { text: "It finished." },
      ];
    case "asking":
      return [{ text: "Which colour do you want for the logo, red or blue?" }];
    case "parked-wait":
      return [
        {
          tool: "await_condition",
          args: {
            condition: `test -f '${buildDonePath(stateDir)}'`,
            about: "the release build",
          },
        },
        {
          text: "The release build is running in the background. I'll pick up its result when it finishes.",
        },
      ];
    case "parked-message":
      return [
        {
          tool: "message_session",
          args: {
            to: "reviewer",
            text: "Is the API change approved?",
          },
        },
        {
          text: "I've asked the reviewer whether the API change is approved. I'll carry on when the reply comes in.",
        },
      ];
  }
}
