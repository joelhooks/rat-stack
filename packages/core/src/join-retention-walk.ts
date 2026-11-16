import { watchActor } from "@rat-stack/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Data, Effect, Schema } from "effect";
import { types } from "xstate";

import {
  JOIN_RETENTION_DEFAULT_LIMIT,
  JOIN_RETENTION_MAX_LIMIT,
  JoinRetentionCountsSchema,
  joinRetentionBackfill,
} from "./join-retention-backfill.js";
import { JoinRetentionBackfillUnavailable } from "./join-retention-unavailable.js";

type Counts = typeof JoinRetentionCountsSchema.Type;

type FailureInfo = Pick<
  JoinRetentionBackfillUnavailable,
  "reason" | "diagnostic"
>;

type Outcome = Data.TaggedEnum<{
  Complete: { readonly counts: Counts };
  Unavailable: FailureInfo;
}>;

const outcomes = Data.taggedEnum<Outcome>();

const failureInfo = (
  reason: string,
  diagnostic: JoinRetentionBackfillUnavailable["diagnostic"]
): FailureInfo =>
  diagnostic === undefined ? { reason } : { reason, diagnostic };

const unavailableOutcome = (
  reason = "Retention backfill did not complete. Fix: verify the origin, operator token and page responses, then rerun a preview.",
  diagnostic?: JoinRetentionBackfillUnavailable["diagnostic"]
) => outcomes.Unavailable(failureInfo(reason, diagnostic));

const Input = Schema.Struct({
  apply: Schema.Boolean,
  limit: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: JOIN_RETENTION_MAX_LIMIT })
  ),
});

const Options = Schema.Struct({
  apply: Schema.optionalKey(Input.fields.apply),
  limit: Schema.optionalKey(Input.fields.limit),
});

const PageInput = Schema.Struct({
  ...Input.fields,
  after: Schema.NullOr(Schema.String),
});

interface WalkContext {
  readonly apply: boolean;
  readonly limit: number;
  readonly after: string | null;
  readonly total: Counts;
  readonly outcome: Outcome;
}

const emptyCounts = (): Counts => ({
  current: 0,
  erase: 0,
  finished: 0,
  gone: 0,
  legacyHandoffTimeUnknown: 0,
  nextCursor: null,
  pending: 0,
  unreadable: 0,
});

const addCounts = (total: Counts, page: Counts): Counts => ({
  current: total.current + page.current,
  erase: total.erase + page.erase,
  finished: total.finished + page.finished,
  gone: total.gone + page.gone,
  legacyHandoffTimeUnknown:
    total.legacyHandoffTimeUnknown + page.legacyHandoffTimeUnknown,
  nextCursor: null,
  pending: total.pending + page.pending,
  unreadable: total.unreadable + page.unreadable,
});

const readPage = Effect.fnUntraced(function* readPage(
  input: typeof PageInput.Type
) {
  const base = { apply: input.apply, limit: input.limit };

  const page = yield* joinRetentionBackfill.handler(
    input.after === null ? base : { ...base, after: input.after }
  );

  const decoded = yield* Schema.decodeEffect(JoinRetentionCountsSchema)(
    page
  ).pipe(
    Effect.mapError(
      () =>
        // oxlint-disable-next-line anti-slop-effect/require-cause-when-narrowing -- Backfill page decode errors contain untrusted operator data; retain only the allowlisted diagnostic.
        new JoinRetentionBackfillUnavailable({
          reason:
            "Backfill page is invalid. Fix: check the operator endpoint and rerun a preview.",
        })
    )
  );

  const visited =
    decoded.current +
    decoded.erase +
    decoded.finished +
    decoded.gone +
    decoded.pending +
    decoded.unreadable;

  if (
    visited > input.limit ||
    decoded.legacyHandoffTimeUnknown > visited ||
    (decoded.nextCursor !== null &&
      (visited === 0 || decoded.nextCursor <= (input.after ?? "")))
  ) {
    return yield* new JoinRetentionBackfillUnavailable({
      reason:
        "Backfill cursor did not progress within its page bound. Fix: check the operator endpoint and rerun a preview.",
    });
  }

  return decoded;
});

type PageResult = Data.TaggedEnum<{
  Page: { readonly counts: Counts };
  Unavailable: FailureInfo;
}>;

const pageResults = Data.taggedEnum<PageResult>();

const page = createEffectLogic({
  effect: ({ input }) =>
    readPage(input).pipe(
      Effect.map((counts) => pageResults.Page({ counts })),
      Effect.catchTag("JoinRetentionBackfillUnavailable", (failure) =>
        Effect.succeed(
          pageResults.Unavailable(
            failureInfo(failure.reason, failure.diagnostic)
          )
        )
      )
    ),
  schemas: { input: PageInput },
});

export const joinRetentionWalkMachine = setupEffect({
  actors: { page },
  schemas: { input: Input, context: types<WalkContext>() },
}).createMachine({
  context: ({ input }) => ({
    ...input,
    after: null,
    total: emptyCounts(),
    outcome: unavailableOutcome(),
  }),
  initial: "fetching",
  output: ({ context }) => context.outcome,
  states: {
    complete: { type: "final" },
    unavailable: { type: "final" },
    fetching: {
      invoke: {
        src: "page",
        input: ({ context }) => ({
          apply: context.apply,
          limit: context.limit,
          after: context.after,
        }),
        onDone: ({ context, event }) =>
          pageResults.$match(event.output, {
            Unavailable: ({ reason, diagnostic }) => ({
              target: "unavailable",
              context: { outcome: unavailableOutcome(reason, diagnostic) },
            }),
            Page: ({ counts }) => {
              const total = addCounts(context.total, counts);

              return {
                target: counts.nextCursor === null ? "complete" : "fetching",
                reenter: true,
                context: {
                  after: counts.nextCursor,
                  total,
                  outcome:
                    counts.nextCursor === null
                      ? outcomes.Complete({ counts: total })
                      : unavailableOutcome(),
                },
              };
            },
          }),
        onError: { target: "unavailable" },
      },
    },
  },
});

export const runJoinRetentionWalk = Effect.fn("runJoinRetentionWalk")(
  function* runJoinRetentionWalk(options: typeof Options.Type) {
    const input = yield* Schema.decodeEffect(Options)(options).pipe(
      Effect.mapError(
        () =>
          // oxlint-disable-next-line anti-slop-effect/require-cause-when-narrowing -- Backfill options are untrusted; the operator failure exposes only fixed recovery instructions.
          new JoinRetentionBackfillUnavailable({
            reason:
              "Backfill options are invalid. Fix: use preview or explicit apply with a limit between 1 and 50.",
          })
      )
    );

    const actor = yield* createEffectActor(joinRetentionWalkMachine, {
      input: {
        apply: input.apply ?? false,
        limit: input.limit ?? JOIN_RETENTION_DEFAULT_LIMIT,
      },
    });

    yield* watchActor("joinRetentionWalkMachine", actor);

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- XState join exposes unknown actor errors; catchCause replaces them with an unavailable outcome without retaining raw causes.
    const outcome = yield* join(actor).pipe(
      Effect.catchCause(() => Effect.succeed(unavailableOutcome()))
    );

    return yield* outcomes.$match(outcome, {
      Complete: ({ counts }) => Effect.succeed(counts),
      Unavailable: ({ reason, diagnostic }) =>
        Effect.fail(
          new JoinRetentionBackfillUnavailable(failureInfo(reason, diagnostic))
        ),
    });
  },
  Effect.scoped
);
