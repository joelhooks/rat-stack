import { describe, expect, it } from "vitest";

import type { SessionRecord } from "#shared/core/sessions.ts";
import type { TurnLine } from "#shared/core/turns.ts";
import {
  judge,
  notes,
  type TranscriptsBySession,
  type TurnsBySession,
} from "#shared/messages/judge.ts";
import type { MessagesEvent } from "#shared/messages/log.ts";
import type { TranscriptItem } from "#shared/messages/transcript.ts";

// The done check's own rules, as stories: given what the environment logged,
// how each session was launched, who prompted it, and what its Pi session
// file shows, which claims pass. None of them knows or cares how the guest's
// sessions talk to each other.

const at = (n: number) =>
  new Date(Date.UTC(2026, 10, 17, 18, 0, n)).toISOString();

/** A launcher record: started at second `n`, from a terminal or inside `parent`. */
const ses = (
  session: string,
  role: string,
  n: number,
  parent: string | null = null
): SessionRecord => ({
  session,
  parentSession: parent,
  piSessionId: `tmx-04.1-${role}`,
  pid: 1,
  role,
  exercise: "04.1",
  startedAt: at(n),
  endedAt: null,
  ended: null,
  exitCode: null,
  exitSignal: null,
});

const started = (n: number): MessagesEvent => ({
  _tag: "StartedOver",
  at: at(n),
  session: null,
});
const reveal = (session: string | null, n: number): MessagesEvent => ({
  _tag: "Revealed",
  salt: "00",
  hash: "00",
  at: at(n),
  session,
});
const answer = (
  session: string | null,
  n: number,
  from: { session: string | null; n: number } | null
): MessagesEvent => ({
  _tag: "Answered",
  matched:
    from === null ? null : { session: from.session, revealedAt: at(from.n) },
  at: at(n),
  session,
});

const typed = (n: number): TurnLine => ({
  at: at(n),
  kind: "prompt",
  source: "interactive",
});
const bang = (n: number): TurnLine => ({
  at: at(n),
  kind: "prompt",
  source: "user-bash",
});
const woken = (n: number): TurnLine => ({
  at: at(n),
  kind: "prompt",
  source: "extension",
});
const start = (n: number): TurnLine => ({ at: at(n), kind: "start" });

const call = (n: number, args: unknown, tool = "send_message") =>
  ({
    kind: "call",
    at: at(n),
    id: `call_${n}`,
    tool,
    args: JSON.stringify(args),
  }) satisfies TranscriptItem;
const result = (n: number, isError: boolean, text: string, tool = "send") =>
  ({
    kind: "result",
    at: at(n),
    callId: `call_${n}`,
    tool,
    isError,
    text,
  }) satisfies TranscriptItem;
const message = (n: number, role: "user" | "custom", text: string) =>
  ({ kind: "message", at: at(n), role, text }) satisfies TranscriptItem;

// The story that passes: the question typed into A at 10, B woken by A's
// message at 12 and shown its secret at 13, A woken by the reply at 15 and
// hands it in at 16. Then the guest asks A to message ghost, and the send
// comes back as an error.
const A = ses("A", "a", 1);
const B = ses("B", "b", 2);
const sessions = [A, B];
const events = [
  started(0),
  reveal("B", 13),
  answer("A", 16, { session: "B", n: 13 }),
];
const turns: TurnsBySession = new Map([
  ["A", [start(1), typed(10), woken(15), typed(20)]],
  ["B", [start(2), woken(12)]],
]);
const bounced: TranscriptItem[] = [
  call(21, { to: "ghost", text: "hello" }),
  result(21, true, 'No session named "ghost" is listening. Live names: a, b.'),
];
const transcripts: TranscriptsBySession = new Map([
  ["A", bounced],
  ["B", []],
]);

const verdict = (
  opts: {
    events?: MessagesEvent[];
    sessions?: SessionRecord[];
    turns?: TurnsBySession;
    transcripts?: TranscriptsBySession;
  } = {}
) =>
  judge(
    opts.events ?? events,
    opts.sessions ?? sessions,
    opts.turns ?? turns,
    opts.transcripts ?? transcripts
  );
const oks = (opts: Parameters<typeof verdict>[0] = {}) =>
  verdict(opts).map((c) => c.ok);
const detail = (opts: Parameters<typeof verdict>[0], i: number) =>
  verdict(opts)[i]?.detail ?? "";

const withTurns = (a: TurnLine[], b: TurnLine[]): TurnsBySession =>
  new Map([
    ["A", a],
    ["B", b],
  ]);
const withA = (items: TranscriptItem[]): TranscriptsBySession =>
  new Map([
    ["A", items],
    ["B", []],
  ]);

describe("the 04.1 done check", () => {
  it("passes: A asked, B answered, nobody carried it, and ghost bounced", () => {
    const claims = verdict();
    expect(claims.map((c) => c.ok)).toEqual([true, true, true]);
    expect(claims[0]?.detail).toMatch(
      /A \(role a\) handed in the secret B \(role b\) was shown at 18:00:13/
    );
    expect(claims[2]?.detail).toMatch(/came back as an error: "No session/);
  });

  it("fails everything before setup", () => {
    expect(oks({ events: [] })).toEqual([false, false, false]);
    expect(detail({ events: [] }, 0)).toMatch(/run setup first/);
  });

  describe("the answer came back to the session that asked", () => {
    it("fails with nothing handed in", () => {
      expect(oks({ events: [started(0), reveal("B", 13)] })).toEqual([
        false,
        false,
        false,
      ]);
      expect(detail({ events: [started(0)] }, 0)).toBe("nothing handed in yet");
    });

    it("fails when the hand-in matched no secret", () => {
      const wrong = [started(0), reveal("B", 13), answer("A", 16, null)];
      expect(oks({ events: wrong })[0]).toBe(false);
      expect(detail({ events: wrong }, 0)).toMatch(
        /handed in a secret no session was shown/
      );
    });

    it("fails when A handed in its own secret", () => {
      const own = [
        started(0),
        reveal("A", 13),
        answer("A", 16, { session: "A", n: 13 }),
      ];
      expect(detail({ events: own }, 0)).toMatch(/its own secret/);
    });

    it("fails when the hand-in came from a plain terminal", () => {
      const plain = [
        started(0),
        reveal("B", 13),
        answer(null, 16, { session: "B", n: 13 }),
      ];
      expect(oks({ events: plain })[0]).toBe(false);
      expect(detail({ events: plain }, 0)).toMatch(/outside a Pi started/);
    });

    it("fails when the secret was shown in a plain terminal", () => {
      const plain = [
        started(0),
        reveal(null, 13),
        answer("A", 16, { session: null, n: 13 }),
      ];
      expect(detail({ events: plain }, 0)).toMatch(/shown outside any Pi/);
    });

    it("fails when B is a Pi that A started: both are the guest's own", () => {
      const nested = [A, ses("B", "b", 2, "A")];
      expect(oks({ sessions: nested })[0]).toBe(false);
      expect(detail({ sessions: nested }, 0)).toMatch(
        /started from inside another Pi/
      );
    });

    it("fails when a session has no launcher record", () => {
      expect(detail({ sessions: [A] }, 0)).toMatch(/has no session record/);
    });
  });

  describe("nobody typed into either session to carry it", () => {
    it("fails when the secret was typed into A after B was shown it", () => {
      const pasted = withTurns([typed(10), typed(14), typed(20)], [woken(12)]);
      expect(oks({ turns: pasted })).toEqual([true, false, true]);
      expect(detail({ turns: pasted }, 1)).toMatch(
        /A \(role a\) was typed into at 18:00:14 UTC, after B \(role b\) was shown its secret at 18:00:13 UTC/
      );
    });

    it("fails when the guest asked B by hand", () => {
      const byHand = withTurns([typed(10), woken(15)], [typed(12)]);
      expect(oks({ turns: byHand })[1]).toBe(false);
      expect(detail({ turns: byHand }, 1)).toMatch(
        /B \(role b\) was typed into at 18:00:12 UTC, after the question went into A/
      );
    });

    it("fails when the guest ran secret in B with a !command", () => {
      expect(oks({ turns: withTurns([typed(10)], [bang(13)]) })[1]).toBe(false);
    });

    it("fails when nothing was typed into A at all", () => {
      const untouched = withTurns([woken(15)], [woken(12)]);
      expect(detail({ turns: untouched }, 1)).toMatch(
        /nothing was typed into A \(role a\) before it handed in/
      );
    });

    it("fails without a prompt record", () => {
      const missing: TurnsBySession = new Map([["A", [typed(10)]]]);
      expect(detail({ turns: missing }, 1)).toMatch(/B has no prompt record/);
    });

    it("passes when B was set up by hand before the question", () => {
      expect(
        oks({ turns: withTurns([typed(10)], [typed(5), woken(12)]) })[1]
      ).toBe(true);
    });

    it("counts the clean hand-in when a later one was carried by hand", () => {
      const twice = [
        ...events,
        reveal("B", 30),
        answer("A", 32, { session: "B", n: 30 }),
      ];
      const later = withTurns([typed(10), woken(15), typed(31)], [woken(12)]);
      expect(oks({ events: twice, turns: later })).toEqual([true, true, true]);
    });
  });

  describe("a message from that session to ghost failed where it could see it", () => {
    it("fails when nothing was sent to ghost", () => {
      const none = withA([
        call(21, { to: "b", text: "hi" }),
        result(21, false, "Delivered to b"),
      ]);
      expect(oks({ transcripts: none })[2]).toBe(false);
      expect(detail({ transcripts: none }, 2)).toBe(
        "A handed in but sent nothing to ghost yet"
      );
    });

    it("fails before anything was handed in: the sender is the session that asked", () => {
      expect(detail({ events: [started(0)] }, 2)).toMatch(
        /no session has handed in an answer yet/
      );
    });

    it("ignores another open session's command that mentions ghost", () => {
      const build = ses("M", "main", 0);
      const elsewhere: TranscriptsBySession = new Map([
        ["A", []],
        [
          "M",
          [
            call(21, { command: "grep ghost out.log" }, "bash"),
            result(21, true, "Command exited with code 1"),
          ],
        ],
      ]);
      expect(
        oks({ sessions: [build, ...sessions], transcripts: elsewhere })[2]
      ).toBe(false);
    });

    it("fails when the send to ghost came back as if it worked", () => {
      const silent = withA([
        call(21, { to: "ghost" }),
        result(21, false, "Queued for ghost."),
      ]);
      expect(oks({ transcripts: silent })[2]).toBe(false);
      expect(detail({ transcripts: silent }, 2)).toMatch(
        /came back without an error: "Queued for ghost."/
      );
    });

    it("fails when nothing came back at all", () => {
      const lost = withA([call(21, { to: "ghost" })]);
      expect(detail({ transcripts: lost }, 2)).toMatch(/nothing came back/);
    });

    it("passes when a command's output says it failed", () => {
      const cli = withA([
        call(21, { command: "node mail.ts send ghost hello" }, "bash"),
        result(21, false, "error: nobody called ghost is listening"),
      ]);
      expect(oks({ transcripts: cli })[2]).toBe(true);
    });

    it("passes when the failure comes back later as an extension's message", () => {
      const bounce = withA([
        call(21, { to: "ghost" }),
        result(21, false, "Queued."),
        message(25, "custom", "Undeliverable: ghost is not a known session."),
      ]);
      expect(oks({ transcripts: bounce })[2]).toBe(true);
      expect(detail({ transcripts: bounce }, 2)).toMatch(
        /a message came back at 18:00:25/
      );
    });

    it("passes when an extension sends the failure as a user message", () => {
      const bounce = withA([
        call(21, { to: "ghost" }),
        result(21, false, "Queued."),
        message(25, "user", "Your message to ghost failed: no such session."),
      ]);
      const woke = withTurns(
        [typed(10), woken(15), typed(20), woken(25)],
        [woken(12)]
      );
      expect(oks({ transcripts: bounce, turns: woke })[2]).toBe(true);
    });

    it("fails when the failure was only typed in by the guest", () => {
      const said = withA([
        call(21, { to: "ghost" }),
        result(21, false, "Queued."),
        message(25, "user", "Did that message to ghost fail?"),
      ]);
      const typedIn = withTurns(
        [typed(10), woken(15), typed(20), typed(25)],
        [woken(12)]
      );
      expect(oks({ transcripts: said, turns: typedIn })[2]).toBe(false);
    });

    it("ignores what happened before setup", () => {
      const old = withA([
        call(-5, { to: "ghost" }),
        result(-5, true, "no such session"),
      ]);
      expect(
        oks({ events: [started(0), ...events.slice(1)], transcripts: old })[2]
      ).toBe(false);
    });

    it("ignores a Pi started from inside another", () => {
      const nested = [A, B, ses("C", "c", 3, "A")];
      const inC: TranscriptsBySession = new Map([["C", bounced]]);
      expect(oks({ sessions: nested, transcripts: inC })[2]).toBe(false);
    });
  });

  describe("notes", () => {
    it("says what it saw and didn't count", () => {
      const seen = [...events, reveal(null, 30), reveal("C", 31)];
      const all = [...sessions, ses("C", "c", 3, "A")];
      expect(notes(seen, all, new Map())).toEqual([
        "Note: 1 nested session seen, not counted.",
        "Note: 1 command run outside any Pi started with pnpm pi, not counted.",
        "Note: no Pi session file found for A.",
      ]);
    });
  });
});
