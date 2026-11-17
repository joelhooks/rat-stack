import {
  type CommitClaim,
  commitLine,
  commitSays,
  markStepStart,
} from "#shared/core/commit-line.ts";
import type { Env, ExerciseContext } from "#shared/core/context.ts";
import { defineExercise, type Exercise } from "#shared/core/exercise.ts";
import {
  detailsFlag,
  nextAfter,
  reporter,
  type Says,
  saysOf,
  takeDetails,
} from "#shared/core/report.ts";
import {
  isTopLevel,
  readSessions,
  type SessionRecord,
  sessionFromEnv,
} from "#shared/core/sessions.ts";
import { readTurns, type TurnLine } from "#shared/core/turns.ts";

import {
  askingSessions,
  claimNames,
  judge,
  missingName,
  notes,
} from "./judge.ts";
import {
  appendEvent,
  type MessagesEvent,
  newSalt,
  newSecret,
  readEvents,
  resetLog,
  revealOf,
  sealSecret,
  startedAt,
} from "./log.ts";
import { readTranscript, type TranscriptItem } from "./transcript.ts";

// The commands for the messages piece. `secret` shows the session that runs
// it something nobody else has seen; `answer` hands a secret in. Getting one
// session's secret into another without anyone carrying it is the guest's
// job, built however they like. `done` reads this log, the launcher's
// session records, its note of who prompted each Pi, and Pi's own session
// files (./judge.ts).

export type MessagesDeps = {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now: () => Date;
  /** A number in [0, 1). */
  readonly random: () => number;
  /** The workshop session running this command, or null in a plain terminal. */
  readonly session: () => string | null;
  readonly readSessions: (repoRoot: string) => Promise<SessionRecord[]>;
  readonly readTurns: (
    repoRoot: string,
    session: string
  ) => Promise<TurnLine[] | null>;
  /** The commit line `done` ends with. */
  readonly commit: (ctx: ExerciseContext) => Promise<CommitClaim>;
  /** Pi's session file for this record, as items, or null when there's none. */
  readonly readTranscript: (
    ctx: ExerciseContext,
    record: SessionRecord
  ) => Promise<TranscriptItem[] | null>;
};

/** Looks where a Pi started in the guest's repo, or in the starter, keeps it. */
export function transcriptReader(
  env: Env = process.env
): MessagesDeps["readTranscript"] {
  return async (ctx, record) =>
    record.piSessionId === null
      ? null
      : readTranscript(record.piSessionId, [ctx.guestRoot, ctx.repoRoot], env);
}

/** What `done` prints for each check when the case adds nothing. */
const says: Readonly<Record<string, Says>> = {
  [claimNames.answered]: {
    yes: "The answer came back to the session that asked.",
    no: "The answer hasn't come back to the session that asked yet.",
  },
  [claimNames.untyped]: {
    yes: "Nobody typed into either session to carry it.",
    no: "Someone typed into a session to carry it.",
  },
  [claimNames.bounced]: {
    yes: `A message from that session to ${missingName}, a name nobody has, failed where it could see it.`,
    no: `A message from that session to ${missingName}, a name nobody has, hasn't failed where it could see it yet.`,
  },
  ...commitSays,
};

const defaultDeps: MessagesDeps = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  now: () => new Date(),
  random: Math.random,
  session: () => sessionFromEnv(),
  readSessions,
  readTurns,
  commit: (ctx) => commitLine(ctx),
  readTranscript: transcriptReader(),
};

const ex = (ctx: ExerciseContext, command: string) =>
  `pnpm ex ${ctx.exerciseId} ${command}`;

const clock = (iso: string) => `${iso.slice(11, 19)} UTC`;

export function messagesExercise(
  opts: { readonly id: string; readonly title: string },
  deps: MessagesDeps = defaultDeps
): Exercise {
  const { out, err } = deps;

  const startOver = async (ctx: ExerciseContext) => {
    await markStepStart(ctx, deps.now());
    await resetLog(ctx.stateDir);
    await appendEvent(ctx.stateDir, {
      _tag: "StartedOver",
      at: deps.now().toISOString(),
      session: deps.session(),
    });
  };

  /** The log, started over first if `setup` never ran. */
  const events = async (ctx: ExerciseContext): Promise<MessagesEvent[]> => {
    const log = await readEvents(ctx.stateDir);
    if (startedAt(log) !== null) {
      return log;
    }
    await startOver(ctx);
    return readEvents(ctx.stateDir);
  };

  const describe = (
    session: string | null,
    records: readonly SessionRecord[]
  ): string => {
    if (session === null) {
      return "a plain terminal";
    }
    const record = records.find((r) => r.session === session);
    return record === undefined
      ? `${session} (no session record)`
      : `${session} (role ${record.role}${isTopLevel(record) ? "" : ", nested"})`;
  };

  return defineExercise({
    id: opts.id,
    title: opts.title,
    commands: {
      /** Starts over: no secrets shown, nothing handed in. */
      async setup(ctx) {
        await startOver(ctx);
        out("Fresh start: no secrets shown, nothing handed in.");
        return 0;
      },

      /** Shows this session a new secret. Only this session ever sees it. */
      async secret(ctx) {
        await events(ctx);
        const session = deps.session();
        const secret = newSecret(deps.random);
        const salt = newSalt();
        await appendEvent(ctx.stateDir, {
          _tag: "Revealed",
          salt,
          hash: sealSecret(secret, salt),
          at: deps.now().toISOString(),
          session,
        });
        out(`This session's secret: ${secret}`);
        out("Nobody else has been shown it.");
        if (session === null) {
          out(
            "This terminal isn't a Pi started with pnpm pi, so this secret doesn't count toward done."
          );
        }
        return 0;
      },

      /** Hands in a secret another session was shown. */
      async answer(ctx, args) {
        const secret = args.join(" ").trim();
        if (secret === "") {
          err(`Usage: ${ex(ctx, "answer <secret>")}`);
          return 2;
        }
        const log = await events(ctx);
        const session = deps.session();
        const reveal = revealOf(log, secret);
        await appendEvent(ctx.stateDir, {
          _tag: "Answered",
          matched:
            reveal === null
              ? null
              : { revealedAt: reveal.at, session: reveal.session },
          at: deps.now().toISOString(),
          session,
        });
        if (reveal === null) {
          out(
            "Handed in, but no session was shown that secret. Get it from the session that ran secret."
          );
          return 1;
        }
        if (session !== null && reveal.session === session) {
          out(
            "Handed in, but that's this session's own secret. It has to come from another session."
          );
          return 1;
        }
        const records = await deps.readSessions(ctx.repoRoot);
        out(
          `Handed in: the secret ${describe(reveal.session, records)} was shown at ${clock(reveal.at)}.`
        );
        if (session === null) {
          out(
            "This terminal isn't a Pi started with pnpm pi, so this hand-in doesn't count toward done."
          );
        }
        return 0;
      },

      /** What has happened since setup. Never shows a secret. */
      async status(ctx) {
        const log = await readEvents(ctx.stateDir);
        const since = startedAt(log);
        if (since === null) {
          out(`Nothing yet. Run ${ex(ctx, "setup")}`);
          return 0;
        }
        const records = await deps.readSessions(ctx.repoRoot);
        out(`Since setup at ${clock(since)}:`);
        out(`This session: ${describe(deps.session(), records)}`);
        const lines: string[] = [];
        for (const event of log) {
          if (event._tag === "Revealed") {
            lines.push(
              `  ${clock(event.at)}  secret shown to ${describe(event.session, records)}`
            );
          } else if (event._tag === "Answered") {
            const from =
              event.matched === null
                ? "no session's secret"
                : event.matched.session === event.session
                  ? "its own secret"
                  : `the secret of ${describe(event.matched.session, records)}`;
            lines.push(
              `  ${clock(event.at)}  ${describe(event.session, records)} handed in ${from}`
            );
          }
        }
        if (lines.length === 0) {
          out("No secret shown and nothing handed in yet.");
        } else {
          for (const line of lines) {
            out(line);
          }
        }
        return 0;
      },

      /** The done check: PASS only when every claim holds. */
      async done(ctx, args) {
        const { details } = takeDetails(args);
        const r = reporter(out, {
          id: opts.id,
          title: opts.title,
          command: `${ex(ctx, "done")} ${detailsFlag}`,
          details,
        });
        r.header();
        r.line("");
        const log = await readEvents(ctx.stateDir);
        // Nothing yet: setup hasn't run, and every line would say so.
        const started = startedAt(log) !== null;
        if (!started && !details) {
          r.notStarted(ex(ctx, "setup"));
          return 1;
        }
        const records = await deps.readSessions(ctx.repoRoot);
        const turns = new Map<string, TurnLine[] | null>();
        const transcripts = new Map<string, TranscriptItem[] | null>();
        const involved = new Set(
          log.flatMap((e) =>
            e._tag === "Answered" ? [e.session, e.matched?.session ?? null] : []
          )
        );
        for (const record of records) {
          if (involved.has(record.session)) {
            turns.set(
              record.session,
              await deps.readTurns(ctx.repoRoot, record.session)
            );
          }
        }
        for (const record of askingSessions(log, records)) {
          transcripts.set(
            record.session,
            await deps.readTranscript(ctx, record).catch(() => null)
          );
        }
        const claims: readonly CommitClaim[] = [
          ...judge(log, records, turns, transcripts),
          await r.during(
            "Checking the step's commit with your commit hooks...",
            () => deps.commit(ctx)
          ),
        ];
        for (const claim of claims) {
          r.check(
            claim.ok ? "PASS" : "FAIL",
            saysOf(says, claim),
            claim.detail,
            claim.fix
          );
        }
        for (const note of notes(log, records, transcripts)) {
          r.aside(note);
        }
        const ok = claims.every((c) => c.ok);
        if (!started) {
          r.notStarted(ex(ctx, "setup"));
        } else if (ok) {
          r.done(
            `Done: one session got its answer from another with nobody carrying it, and a message to ${missingName} failed out loud.`,
            nextAfter(opts.id)
          );
        } else {
          r.notDone();
        }
        return ok ? 0 : 1;
      },
    },
  });
}
