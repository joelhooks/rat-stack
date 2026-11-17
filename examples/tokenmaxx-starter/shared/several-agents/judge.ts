import { cast, type Role, type Word, words } from "./cast.ts";

// Reads the guest's command's output against the states the environment put
// its sessions in. The whole contract: each session is on a line that names
// the session (by role, or by workshop session ID) and holds one of three words,
// `working`, `waiting` (on you) or `stopped`. On a line, the first of the
// environment's sessions named owns the line, and the first of the three
// words is its state. Lines that name none of them are the guest's own
// business and are ignored.
//
// An older conversation with the same name (from a Pi that ran in another
// folder, say) is an honest second line, usually `stopped`. When a session's
// lines disagree, the ones that also carry its PID or workshop session ID,
// which only the live one has, decide.

export type Named = {
  readonly name: string;
  /** The workshop session ID, when the launcher recorded one. */
  readonly session: string | null;
  /** Pi's PID, when the launcher recorded one. */
  readonly pid?: number | null;
};

export type Shown = {
  readonly lines: readonly string[];
  /** The first state word on each line that has one, in order. */
  readonly words: readonly Word[];
  /** The same, from lines that carry the session's PID or session ID. */
  readonly sure: readonly Word[];
};

export type Claim = { readonly ok: boolean; readonly text: string };

// CSI and OSC escape sequences, so colour doesn't hide a word.
const esc = String.fromCharCode(27);
const bel = String.fromCharCode(7);
const ansi = new RegExp(
  `${esc}\\[[0-?]*[ -/]*[@-~]|${esc}\\][^${bel}${esc}]*(?:${bel}|${esc}\\\\)`,
  "g"
);

export const stripAnsi = (text: string) => text.replace(ansi, "");

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `token` first stands on its own in `line` (not inside a word), or -1. */
function firstAt(line: string, token: string): number {
  const match = new RegExp(
    `(?<![A-Za-z0-9])${escape(token)}(?![A-Za-z0-9])`,
    "i"
  ).exec(line);
  return match === null ? -1 : match.index;
}

/** The first of the three words on a line, or null. */
export function wordOn(line: string): Word | null {
  let best: { word: Word; at: number } | null = null;
  for (const word of words) {
    const at = firstAt(line, word);
    if (at !== -1 && (best === null || at < best.at)) {
      best = { word, at };
    }
  }
  return best?.word ?? null;
}

/** The session a line belongs to: the first one it names, or null. */
export function ownerOf(line: string, named: readonly Named[]): string | null {
  let best: { name: string; at: number } | null = null;
  for (const n of named) {
    for (const id of [n.name, n.session]) {
      if (id === null) {
        continue;
      }
      const at = firstAt(line, id);
      if (at !== -1 && (best === null || at < best.at)) {
        best = { name: n.name, at };
      }
    }
  }
  return best?.name ?? null;
}

/** Each named session's lines and words in `output`. */
export function readOutput(
  output: string,
  named: readonly Named[]
): Map<string, Shown> {
  const shown = new Map<
    string,
    { lines: string[]; words: Word[]; sure: Word[] }
  >();
  for (const n of named) {
    shown.set(n.name, { lines: [], words: [], sure: [] });
  }
  for (const raw of stripAnsi(output).split(/\r?\n/)) {
    const owner = ownerOf(raw, named);
    const entry = owner === null ? undefined : shown.get(owner);
    const n = named.find((x) => x.name === owner);
    if (entry === undefined || n === undefined) {
      continue;
    }
    entry.lines.push(raw.trim());
    const word = wordOn(raw);
    if (word !== null) {
      entry.words.push(word);
      const live = [n.session, n.pid == null ? null : String(n.pid)];
      if (live.some((id) => id !== null && firstAt(raw, id) !== -1)) {
        entry.sure.push(word);
      }
    }
  }
  return shown;
}

const parked = (role: Role) =>
  role.kind === "parked-wait" || role.kind === "parked-message";

function claimFor(role: Role, shown: Shown | undefined): Claim {
  const who = `${role.name} (${role.doing})`;
  const shows = `The output shows ${who} as`;
  if (shown === undefined || shown.lines.length === 0) {
    return { ok: false, text: `No line of the output names ${who}.` };
  }
  const all = [...new Set(shown.words)];
  const sure = [...new Set(shown.sure)];
  const distinct = all.length > 1 && sure.length === 1 ? sure : all;
  if (distinct.length === 0) {
    return {
      ok: false,
      text: `The line for ${who} has none of the words ${words.slice(0, -1).join(", ")} or ${words.at(-1) ?? ""}.`,
    };
  }
  if (distinct.length > 1) {
    return {
      ok: false,
      text: `${shows} both ${distinct.join(" and ")}. If one line is an older session with the same name, put the live one's PID or session ID on its line.`,
    };
  }
  const word = distinct[0] as Word;
  if (word === role.expect) {
    return {
      ok: true,
      text: parked(role)
        ? `${shows} ${word}, not waiting on you.`
        : `${shows} ${word}.`,
    };
  }
  if (parked(role) && word === "waiting") {
    return {
      ok: false,
      text: `${shows} waiting, but nothing in it is waiting on you.`,
    };
  }
  return {
    ok: false,
    text: `${shows} ${word}. It should be ${role.expect}.`,
  };
}

/** One claim per session in the cast, in cast order. */
export function judge(output: string, named: readonly Named[]): Claim[] {
  const shown = readOutput(output, named);
  return cast.map((role) => claimFor(role, shown.get(role.name)));
}
