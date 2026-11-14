import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { findRepoRoot } from "./context.ts";
import { appendTurn, type TurnLine, turnsPath } from "./turns.ts";

// Loaded by `pnpm pi` into every Pi it starts (`-e`, so `-ne` keeps it). It
// adds no tool, command or prompt text: it only notes when Pi got a prompt
// and where from. See ./turns.ts.

type Hooks = Pick<ExtensionAPI, "on">;

/** Notes every prompt and `!command` Pi gets into the file at `path`. */
export function observeTurns(
  pi: Hooks,
  path: string,
  now: () => Date = () => new Date()
): void {
  const note = (line: TurnLine) => {
    try {
      appendTurn(path, line);
    } catch {
      // A note we can't write must never break the guest's Pi.
    }
  };
  pi.on("session_start", () => {
    note({ at: now().toISOString(), kind: "start" });
  });
  pi.on("input", (event) => {
    note({ at: now().toISOString(), kind: "prompt", source: event.source });
    return { action: "continue" };
  });
  pi.on("user_bash", () => {
    note({ at: now().toISOString(), kind: "prompt", source: "user-bash" });
  });
}

export default function turnsObserver(pi: ExtensionAPI): void {
  const session = process.env["TMX_SESSION"];
  if (session === undefined || session === "") {
    return;
  }
  observeTurns(pi, turnsPath(findRepoRoot(), session));
}
