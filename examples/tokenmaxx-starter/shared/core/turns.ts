import { appendFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Who prompted a Pi, and when. The launcher loads ./turns-observer.ts into
// every Pi it starts; it appends one line per prompt to
//
//   .workshop-state/sessions/<session>.turns.jsonl
//
// with Pi's own word for where the prompt came from: `interactive` (typed in
// the TUI, or `-p` / a message on the command line), `rpc`, or `extension`
// (`pi.sendUserMessage()`), plus `user-bash` for a `!command` typed in the
// TUI. It records no prompt or command text. A check uses it to say
// "nobody prompted this session before X" without guessing from Pi's session
// file, where a typed prompt and an extension's user message look the same.
//
// Kept free of Effect: Pi loads the observer straight from source.

export type TurnSource = "interactive" | "rpc" | "extension" | "user-bash";

export type TurnLine =
  | { readonly at: string; readonly kind: "start" }
  | { readonly at: string; readonly kind: "prompt"; readonly source: string };

/** Sources a person is behind: typed, or sent by something they drive. */
export const humanSources: readonly string[] = [
  "interactive",
  "rpc",
  "user-bash",
];

export const turnsPath = (repoRoot: string, session: string) =>
  join(repoRoot, ".workshop-state", "sessions", `${session}.turns.jsonl`);

export function appendTurn(path: string, line: TurnLine): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}

function parseLine(text: string): TurnLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { at, kind, source } = value as Record<string, unknown>;
  if (typeof at !== "string") {
    return null;
  }
  if (kind === "start") {
    return { at, kind };
  }
  if (kind === "prompt" && typeof source === "string") {
    return { at, kind, source };
  }
  return null;
}

/**
 * The session's lines, oldest first, or null when it has no file: the
 * observer never ran in it (not started with `pnpm pi`, or before this
 * existed). Lines that don't parse are skipped.
 */
export async function readTurns(
  repoRoot: string,
  session: string
): Promise<TurnLine[] | null> {
  let text: string;
  try {
    text = await readFile(turnsPath(repoRoot, session), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseLine)
    .filter((line): line is TurnLine => line !== null);
}
