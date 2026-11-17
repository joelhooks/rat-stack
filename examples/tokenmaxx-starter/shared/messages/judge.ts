import {
  isTopLevel,
  plural,
  type SessionRecord,
} from "#shared/core/sessions.ts";
import { humanSources, type TurnLine } from "#shared/core/turns.ts";

import { type Answered, type MessagesEvent, startedAt } from "./log.ts";
import type { TranscriptItem } from "./transcript.ts";

// The 04.1 done check. It never looks at how the guest's sessions talk, only
// at what the environment and the launcher saw:
//
// 1. a session A handed in (`answer`) the secret another session B was shown
//    (`secret`). Both are Pis the guest started with `pnpm pi`;
// 2. nobody typed into either to carry it. The question was the last thing
//    typed into A before the hand-in, B revealed its secret after that, and
//    nothing was typed into B in between. "Typed" is the launcher's note of
//    who prompted each Pi (shared/core/turns.ts): typed in the TUI, `-p`,
//    RPC or a `!command`. A message an extension delivers is not a person;
//
// 3. a session that handed in an answer (A, the one the guest types into)
//    sent a message to `ghost`, a name nobody has, and the failure came back
//    where it could see it: the tool call that sent it came back as an error
//    or saying it failed, or a message saying so reached the session
//    afterwards. Read from Pi's own session file (./transcript.ts), never
//    from the assistant's own words. Only A counts: another open session,
//    such as the one that built the solution, can mention ghost in a
//    command of its own that fails for another reason.
//
// Only what happened since the last `setup` counts. `done` adds the commit
// line every step ends with (shared/core/commit-line.ts).

/** The name the readme asks the guest to message. Nobody starts a session by it. */
export const missingName = "ghost";

export type Claim = {
  readonly ok: boolean;
  readonly name: string;
  readonly detail: string;
  /** What `done` prints for this case, when it's more than the name says. */
  readonly says?: string;
};

export const claimNames = {
  answered: "the answer came back to the session that asked",
  untyped: "nobody typed into either session to carry it",
  bounced: `a message from that session to ${missingName}, a name nobody has, failed where it could see it`,
} as const;

export type TurnsBySession = ReadonlyMap<string, readonly TurnLine[] | null>;
export type TranscriptsBySession = ReadonlyMap<
  string,
  readonly TranscriptItem[] | null
>;

const ms = (iso: string) => Date.parse(iso);
const clock = (iso: string) => `${iso.slice(11, 19)} UTC`;

const who = (record: SessionRecord) =>
  `${record.session} (role ${record.role})`;

const humanPrompts = (lines: readonly TurnLine[]) =>
  lines.filter(
    (line) => line.kind === "prompt" && humanSources.includes(line.source)
  );

type Pair = {
  readonly answer: Answered;
  readonly a: SessionRecord;
  readonly b: SessionRecord;
};

/** Why `answer` doesn't count as coming back from another session, or the pair. */
function pairOf(
  answer: Answered,
  byId: ReadonlyMap<string, SessionRecord>
): Pair | string {
  if (answer.session === null) {
    return "the last hand-in came from outside a Pi started with pnpm pi";
  }
  const a = byId.get(answer.session);
  if (a === undefined) {
    return `the last hand-in came from ${answer.session}, which has no session record`;
  }
  if (!isTopLevel(a)) {
    return `the last hand-in came from ${a.session}, a Pi started from inside another Pi. Start both sessions yourself with pnpm pi --role <name>`;
  }
  if (answer.matched === null) {
    return `${who(a)} handed in a secret no session was shown`;
  }
  if (answer.matched.session === null) {
    return `${who(a)} handed in a secret shown outside any Pi started with pnpm pi`;
  }
  if (answer.matched.session === a.session) {
    return `${who(a)} handed in its own secret; it has to come from another session`;
  }
  const b = byId.get(answer.matched.session);
  if (b === undefined) {
    return `${who(a)} handed in the secret of ${answer.matched.session}, which has no session record`;
  }
  if (!isTopLevel(b)) {
    return `${who(a)} handed in the secret of ${b.session}, a Pi started from inside another Pi. Start both sessions yourself with pnpm pi --role <name>`;
  }
  return { answer, a, b };
}

/** Why the pair was carried by hand, or null when nobody typed to carry it. */
function typedIn(
  pair: Pair,
  turns: TurnsBySession
): { readonly says: string; readonly detail: string } | null {
  const { answer, a, b } = pair;
  const revealedAt = answer.matched?.revealedAt ?? answer.at;
  const aLines = turns.get(a.session) ?? null;
  const bLines = turns.get(b.session) ?? null;
  if (aLines === null || bLines === null) {
    return {
      says: "A session has no record of its prompts.",
      detail: `${(aLines === null ? a : b).session} has no prompt record; start it with pnpm pi`,
    };
  }
  const question = humanPrompts(aLines)
    .filter((line) => ms(line.at) <= ms(answer.at))
    .at(-1);
  if (question === undefined) {
    return {
      says: "Nobody typed the question into the session that asked.",
      detail: `nothing was typed into ${who(a)} before it handed in; type the question into it`,
    };
  }
  if (ms(revealedAt) <= ms(question.at)) {
    return {
      says: "The question was typed in after the secret was shown, so the answer could have been typed too.",
      detail: `${who(a)} was typed into at ${clock(question.at)}, after ${who(b)} was shown its secret at ${clock(revealedAt)}: it could have been typed in`,
    };
  }
  const intoB = humanPrompts(bLines).filter(
    (line) => ms(line.at) > ms(question.at) && ms(line.at) <= ms(revealedAt)
  );
  const first = intoB[0];
  if (first !== undefined) {
    return {
      says: "Someone typed into the answering session to carry it.",
      detail: `${who(b)} was typed into at ${clock(first.at)}, after the question went into ${a.session} at ${clock(question.at)} and before it was shown its secret`,
    };
  }
  return null;
}

function judgeAnswer(
  events: readonly MessagesEvent[],
  sessions: readonly SessionRecord[],
  turns: TurnsBySession
): [Claim, Claim] {
  const byId = new Map(sessions.map((s) => [s.session, s]));
  const answers = events.filter((e): e is Answered => e._tag === "Answered");
  const pairs = answers
    .map((answer) => pairOf(answer, byId))
    .filter((p): p is Pair => typeof p !== "string");
  const clean = pairs.findLast((pair) => typedIn(pair, turns) === null);
  const pair = clean ?? pairs.at(-1);
  const last = answers.at(-1);

  if (pair === undefined) {
    const detail =
      last === undefined
        ? "nothing handed in yet"
        : (pairOf(last, byId) as string);
    return [
      {
        ok: false,
        name: claimNames.answered,
        detail,
        ...(last === undefined
          ? { says: "Nothing has been handed in yet." }
          : {}),
      },
      {
        ok: false,
        name: claimNames.untyped,
        says: "There's no answer from another session to check yet.",
        detail: "no answer from another session to check yet",
      },
    ];
  }
  const { answer, a, b } = pair;
  const revealedAt = answer.matched?.revealedAt ?? answer.at;
  const answered: Claim = {
    ok: true,
    name: claimNames.answered,
    detail: `${who(a)} handed in the secret ${who(b)} was shown at ${clock(revealedAt)}`,
  };
  const why = typedIn(pair, turns);
  const untyped: Claim =
    why === null
      ? {
          ok: true,
          name: claimNames.untyped,
          detail: `nothing was typed into ${a.session} after the question, or into ${b.session} before it was shown its secret`,
        }
      : { ok: false, name: claimNames.untyped, ...why };
  return [answered, untyped];
}

const failureWords =
  /\b(?:errors?|fail(?:s|ed|ure)?|undeliver\w*|unknown|unreachable|refused|bounced?|not found|no such|dead letter|enoent|econnrefused|does(?:n't| not) exist|(?:is|was|are)(?:n't| not) (?:running|listening|registered|online|delivered|available|found|reachable|known)|not (?:running|listening|registered|online|delivered|available|reachable|known)|no (?:live |running |active |known )?(?:session|pi|agent|one|recipient|mailbox|inbox|listener|peer)s?\b)/i;

const mentionsMissing = (text: string) =>
  new RegExp(`\\b${missingName}\\b`, "i").test(text);

const firstLine = (text: string) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 100 ? `${line.slice(0, 100)}…` : line;
};

type Bounce =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly detail: string | null };

/** The first send to `ghost` in one session's items, and how it came back. */
function bounceIn(
  record: SessionRecord,
  items: readonly TranscriptItem[],
  lines: readonly TurnLine[] | null
): Bounce {
  let quiet: string | null = null;
  for (const [i, item] of items.entries()) {
    if (item.kind !== "call" || !mentionsMissing(item.args)) {
      continue;
    }
    const result = items.find(
      (r) => r.kind === "result" && r.callId === item.id
    );
    const said = `${who(record)} sent to ${missingName} with ${item.tool} at ${clock(item.at)}`;
    if (result?.kind === "result") {
      if (result.isError) {
        return {
          ok: true,
          detail: `${said}; it came back as an error: "${firstLine(result.text)}"`,
        };
      }
      if (failureWords.test(result.text)) {
        return {
          ok: true,
          detail: `${said}; it came back saying it failed: "${firstLine(result.text)}"`,
        };
      }
    }
    // A failure that arrives later, as a message to the session: a custom
    // message, or a user message an extension sent (the prompt note before
    // it is an extension's).
    const later = items
      .slice(i + 1)
      .find(
        (m) =>
          m.kind === "message" &&
          mentionsMissing(m.text) &&
          failureWords.test(m.text) &&
          (m.role === "custom" || promptSourceAt(lines, m.at) === "extension")
      );
    if (later !== undefined) {
      return {
        ok: true,
        detail: `${said}; a message came back at ${clock(later.at)}: "${firstLine(later.kind === "message" ? later.text : "")}"`,
      };
    }
    quiet ??=
      result?.kind === "result"
        ? `${said}, and it came back without an error: "${firstLine(result.text)}"`
        : `${said}, and nothing came back`;
  }
  return { ok: false, detail: quiet };
}

/** The source of the last prompt Pi noted at or before `at`. */
function promptSourceAt(
  lines: readonly TurnLine[] | null,
  at: string
): string | null {
  const line = (lines ?? [])
    .filter((l) => l.kind === "prompt" && ms(l.at) <= ms(at))
    .at(-1);
  return line?.kind === "prompt" ? line.source : null;
}

/** The top-level sessions that handed in an answer, the latest first. */
export function askingSessions(
  events: readonly MessagesEvent[],
  sessions: readonly SessionRecord[]
): SessionRecord[] {
  const byId = new Map(sessions.map((s) => [s.session, s]));
  const seen = new Set<string>();
  const askers: SessionRecord[] = [];
  for (const event of events.toReversed()) {
    const record =
      event._tag === "Answered" && event.session !== null
        ? byId.get(event.session)
        : undefined;
    if (
      record !== undefined &&
      isTopLevel(record) &&
      !seen.has(record.session)
    ) {
      seen.add(record.session);
      askers.push(record);
    }
  }
  return askers;
}

function judgeBounce(
  since: string,
  askers: readonly SessionRecord[],
  turns: TurnsBySession,
  transcripts: TranscriptsBySession
): Claim {
  if (askers.length === 0) {
    return {
      ok: false,
      name: claimNames.bounced,
      says: "No session has handed in an answer yet, so there's no message to check.",
      detail: `no session has handed in an answer yet; ask the one that does to message ${missingName}`,
    };
  }
  let quiet: string | null = null;
  for (const record of askers) {
    const items = transcripts.get(record.session) ?? null;
    if (items === null) {
      continue;
    }
    const bounce = bounceIn(
      record,
      items.filter((item) => ms(item.at) >= ms(since)),
      turns.get(record.session) ?? null
    );
    if (bounce.ok) {
      return { ok: true, name: claimNames.bounced, detail: bounce.detail };
    }
    quiet ??= bounce.detail;
  }
  return {
    ok: false,
    name: claimNames.bounced,
    detail:
      quiet ??
      `${askers.map((a) => a.session).join(", ")} handed in but sent nothing to ${missingName} yet`,
  };
}

export function judge(
  events: readonly MessagesEvent[],
  sessions: readonly SessionRecord[],
  turns: TurnsBySession,
  transcripts: TranscriptsBySession
): Claim[] {
  const since = startedAt(events);
  if (since === null) {
    const detail = "nothing yet: run setup first";
    return [
      { ok: false, name: claimNames.answered, detail },
      { ok: false, name: claimNames.untyped, detail },
      { ok: false, name: claimNames.bounced, detail },
    ];
  }
  return [
    ...judgeAnswer(events, sessions, turns),
    judgeBounce(since, askingSessions(events, sessions), turns, transcripts),
  ];
}

/** What the check saw and didn't count, one line each. */
export function notes(
  events: readonly MessagesEvent[],
  sessions: readonly SessionRecord[],
  transcripts: TranscriptsBySession
): string[] {
  const byId = new Map(sessions.map((s) => [s.session, s]));
  const nested = new Set<string>();
  let outside = 0;
  for (const event of events) {
    if (event._tag === "StartedOver") {
      continue;
    }
    if (event.session === null) {
      outside += 1;
      continue;
    }
    const record = byId.get(event.session);
    if (record !== undefined && !isTopLevel(record)) {
      nested.add(record.session);
    }
  }
  const unread = askingSessions(events, sessions).filter(
    (s) => (transcripts.get(s.session) ?? null) === null
  );
  return [
    ...(nested.size === 0
      ? []
      : [`Note: ${plural(nested.size, "nested session")} seen, not counted.`]),
    ...(outside === 0
      ? []
      : [
          `Note: ${plural(outside, "command")} run outside any Pi started with pnpm pi, not counted.`,
        ]),
    ...(unread.length === 0
      ? []
      : [
          `Note: no Pi session file found for ${unread.map((s) => s.session).join(", ")}.`,
        ]),
  ];
}
