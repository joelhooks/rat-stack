import { watchActor } from "@rat-stack/capability/actor-watch";
import { Approval } from "@rat-stack/capability/approval";
import { gateOutcome } from "@rat-stack/check-harness";
import type { Verdict } from "@rat-stack/check-harness";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
  waitFor,
} from "@xstate/effect";
import { Cause, Clock, Deferred, Effect, Option, Schema } from "effect";
import { types } from "xstate";

import {
  ApplyReceiptSchema,
  DeployInputSchema,
  DeployStepError,
} from "./contracts.js";
import type { ApplyReceipt, DeployInput, DeployVerdict } from "./contracts.js";
import { DeployRunner } from "./deploy-runner.js";
import { classifyRows, PlanRowsSchema } from "./plan.js";
import type { PlanRow } from "./plan.js";
import { quietWindowKeys, readQuietWindow } from "./quiet-window.js";
import type { RollbackReceipt } from "./rollback-contracts.js";
import { RollbackFailed } from "./rollback-failed.js";
import { RollbackRefused } from "./rollback-refused.js";
import { runRollback } from "./rollback.js";
import { decideSource } from "./source.js";
import type { CheckoutState } from "./source.js";
import { WatchHost } from "./watch-host.js";
import { watchReceipt, WatchReceiptSchema } from "./watch-receipt.js";
import type { WatchReceipt } from "./watch-receipt.js";

type StepResult<A> =
  | { readonly kind: "ok"; readonly value: A }
  | {
      readonly kind: "refused";
      readonly keys: readonly string[];
      readonly reason: string;
    }
  | { readonly kind: "crashed" };

const stepResult = <A, R>(
  work: Effect.Effect<A, DeployStepError, R>
): Effect.Effect<StepResult<A>, never, R> =>
  Effect.match(work, {
    onFailure: (failure) =>
      ({
        keys: failure.keys,
        kind: "refused",
        reason: failure.reason,
      }) satisfies StepResult<A>,
    onSuccess: (value): StepResult<A> => ({ kind: "ok", value }),
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.interrupt
        : Effect.succeed<StepResult<A>>({ kind: "crashed" })
    )
  );

interface DeployContext {
  readonly input: DeployInput;
  readonly plan: readonly PlanRow[];
  readonly quietDeadline?: number;
  readonly quietUntil: number;
  readonly verdict: DeployVerdict;
  readonly watch?: WatchReceipt;
  readonly watchCheck?: Verdict;
}

type SourceResult =
  | { readonly kind: "skipped" }
  | { readonly kind: "match"; readonly checkout: CheckoutState }
  | {
      readonly kind: "refused";
      readonly checkout?: CheckoutState;
      readonly keys: readonly string[];
      readonly reason: string;
    }
  | { readonly kind: "crashed" };

const source = createEffectLogic({
  effect: ({ input }) => {
    const expected = input.expectSha;

    if (expected === undefined) {
      return Effect.succeed<SourceResult>({ kind: "skipped" });
    }

    return stepResult(DeployRunner.use((runner) => runner.source())).pipe(
      Effect.map((result): SourceResult => {
        if (result.kind !== "ok") {
          return result;
        }

        const decision = decideSource(expected, result.value);

        return decision.kind === "match"
          ? { checkout: result.value, kind: "match" }
          : {
              checkout: result.value,
              keys: ["expectSha"],
              kind: "refused",
              reason: decision.reason,
            };
      })
    );
  },
  schemas: {
    input: Schema.Struct({ expectSha: DeployInputSchema.fields.expectSha }),
  },
});

const quietWindow = createEffectLogic({
  effect: ({ input }) =>
    stepResult(
      readQuietWindow(input.deadline).pipe(
        Effect.mapError(
          () =>
            new DeployStepError({
              keys: [...quietWindowKeys],
              reason: "quiet-window-config-invalid",
              step: "quietWindow",
            })
        )
      )
    ),
  schemas: {
    input: Schema.Struct({ deadline: Schema.optionalKey(Schema.Natural) }),
  },
});

const awaitQuietWindow = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* awaitQuietWindowEnd() {
      const now = yield* Clock.currentTimeMillis;

      yield* Effect.sleep(Math.max(0, input.until - now));
    }),
  schemas: { input: Schema.Struct({ until: Schema.Natural }) },
});

const preflight = createEffectLogic({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.preflight(input))),
  schemas: { input: DeployInputSchema },
});

const plan = createEffectLogic({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.plan(input))),
  schemas: { input: DeployInputSchema },
});

const classify = createEffectLogic({
  effect: ({ input }) =>
    Effect.sync(() =>
      classifyRows(input.plan, input.allow, input.ownerApproved)
    ),
  schemas: {
    input: Schema.Struct({
      allow: DeployInputSchema.fields.allow,
      ownerApproved: DeployInputSchema.fields.ownerApproved,
      plan: PlanRowsSchema,
    }),
  },
});

const apply = createEffectLogic({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.apply(input))),
  schemas: { input: DeployInputSchema },
});

const checks = createEffectLogic({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.checks(input))),
  schemas: { input: ApplyReceiptSchema },
});

const watch = createEffectLogic({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.watch(input))),
  schemas: { input: ApplyReceiptSchema },
});

type RollbackStep =
  | { readonly kind: "restored"; readonly receipt: RollbackReceipt }
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly receipt?: RollbackReceipt;
    };

const rollback = createEffectLogic({
  effect: ({ input }) =>
    Approval.use((approval) =>
      approval.approve("deployRollback", {
        profile: input.profile,
        trigger: "post-deploy-watch",
      })
    ).pipe(
      Effect.andThen(runRollback({ profile: input.profile })),
      Effect.match({
        onFailure: (failure): RollbackStep => {
          if (Schema.is(RollbackFailed)(failure)) {
            return {
              kind: "failed",
              reason: `rollback-${failure.receipt.outcome}`,
              receipt: failure.receipt,
            };
          }

          return {
            kind: "failed",
            reason: Schema.is(RollbackRefused)(failure)
              ? failure.reason
              : "rollback-approval-denied",
          };
        },
        onSuccess: (receipt): RollbackStep => ({ kind: "restored", receipt }),
      }),
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.interrupt
          : Effect.succeed<RollbackStep>({
              kind: "failed",
              reason: "rollback-crashed",
            })
      )
    ),
  schemas: { input: Schema.Struct({ profile: Schema.NonEmptyString }) },
});

const recordWatch = createEffectLogic({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.recordWatch(input))),
  schemas: { input: WatchReceiptSchema },
});

const ended = (
  context: DeployContext,
  outcome: DeployVerdict["outcome"],
  step: string,
  keys = context.verdict.keys,
  reason = `${step}-${outcome}`
) => ({
  verdict: { ...context.verdict, keys, outcome, reason, step },
});

const withApplyReceipt = (
  verdict: DeployVerdict,
  receipt: ApplyReceipt
): DeployVerdict =>
  receipt.providerErrors === undefined
    ? { ...verdict, receipt }
    : { ...verdict, providerErrors: receipt.providerErrors, receipt };

const checksOutcome = (
  values: readonly Verdict[]
): DeployVerdict["outcome"] => {
  if (
    values.length > 0 &&
    values.every((verdict) => gateOutcome(verdict) === "pass")
  ) {
    return "healthy";
  }

  return values.some((verdict) => gateOutcome(verdict) === "fail")
    ? "failed"
    : "unknown";
};

export const deployMachine = setupEffect({
  actors: {
    apply,
    awaitQuietWindow,
    checks,
    classify,
    plan,
    preflight,
    quietWindow,
    recordWatch,
    rollback,
    source,
    watch,
  },
  schemas: { context: types<DeployContext>(), input: DeployInputSchema },
}).createMachine({
  context: ({ input }) => ({
    input,
    plan: [],
    quietUntil: 0,
    verdict: {
      checks: [],
      keys: [],
      outcome: "unknown",
      rows: [],
      step: "source",
    },
  }),
  initial: "source",
  output: ({ context }) => context.verdict,
  states: {
    apply: {
      invoke: {
        input: ({ context }) => context.input,
        onDone: ({ context, event }) => {
          if (event.output.kind === "crashed") {
            return {
              context: ended(context, "crashed", "apply"),
              target: "applyCrashed",
            };
          }

          if (event.output.kind === "refused") {
            return {
              context: ended(
                context,
                "failed",
                "apply",
                event.output.keys,
                event.output.reason
              ),
              target: "failed",
            };
          }

          if (event.output.value.outcome !== "applied") {
            return {
              context: {
                verdict: {
                  ...withApplyReceipt(context.verdict, event.output.value),
                  outcome:
                    event.output.value.outcome === "prepared"
                      ? "unknown"
                      : event.output.value.outcome,
                  step: "apply",
                },
              },
              target: "applyUnsuccessful",
            };
          }

          return {
            context: {
              verdict: withApplyReceipt(context.verdict, event.output.value),
            },
            target: "checks",
          };
        },
        onError: {
          context: ({ context }) => ended(context, "crashed", "apply"),
          target: "applyCrashed",
        },
        src: "apply",
      },
    },
    applyCrashed: { type: "final" },
    applyUnsuccessful: { type: "final" },
    awaitingQuietWindow: {
      invoke: {
        input: ({ context }) => ({ until: context.quietUntil }),
        onDone: { target: "quietWindow" },
        onError: {
          context: ({ context }) => ended(context, "crashed", "quietWindow"),
          target: "quietWindowCrashed",
        },
        src: "awaitQuietWindow",
      },
    },
    checks: {
      invoke: {
        input: ({ context }) =>
          context.verdict.receipt ?? {
            notUpdated: [],
            outcome: "crashed",
            retainedOrphans: [],
            updated: [],
            versions: {},
          },
        onDone: ({ context, event }) => {
          if (event.output.kind === "crashed") {
            return {
              context: ended(context, "crashed", "checks"),
              target: "checksCrashed",
            };
          }

          if (event.output.kind === "refused") {
            return {
              context: ended(
                context,
                "failed",
                "checks",
                event.output.keys,
                event.output.reason
              ),
              target: "failed",
            };
          }

          const outcome = checksOutcome(event.output.value);

          return {
            context: {
              verdict: {
                ...context.verdict,
                checks: event.output.value,
                outcome,
                step: "checks",
              },
            },
            target: outcome === "healthy" ? "watching" : "verdict",
          };
        },
        onError: {
          context: ({ context }) => ended(context, "crashed", "checks"),
          target: "checksCrashed",
        },
        src: "checks",
      },
    },
    checksCrashed: { type: "final" },
    classify: {
      invoke: {
        input: ({ context }) => ({
          allow: context.input.allow,
          ownerApproved: context.input.ownerApproved ?? false,
          plan: context.plan,
        }),
        onDone: ({ context, event }) => {
          if (event.output.outcome !== "pass") {
            const { verdict } = ended(
              context,
              event.output.outcome === "unknown" ? "unknown" : "refused",
              "classify",
              context.verdict.keys,
              event.output.error.reason
            );

            return {
              context: {
                verdict: {
                  ...verdict,
                  resources: event.output.error.resources,
                },
              },
              target: "refused",
            };
          }

          if (context.input.mode === "plan") {
            return {
              context: {
                verdict: {
                  ...context.verdict,
                  outcome: "planned",
                  rows: event.output.rows,
                  step: "classify",
                },
              },
              target: "planned",
            };
          }

          return {
            context: {
              verdict: { ...context.verdict, rows: event.output.rows },
            },
            target: "quietWindow",
          };
        },
        onError: {
          context: ({ context }) => ended(context, "crashed", "classify"),
          target: "classifyCrashed",
        },
        src: "classify",
      },
    },
    classifyCrashed: { type: "final" },
    failed: { type: "final" },
    plan: {
      invoke: {
        input: ({ context }) => context.input,
        onDone: ({ context, event }) => {
          if (event.output.kind === "crashed") {
            return {
              context: ended(context, "crashed", "plan"),
              target: "planCrashed",
            };
          }

          if (event.output.kind === "refused") {
            return {
              context: ended(context, "refused", "plan"),
              target: "refused",
            };
          }

          return {
            context: {
              plan: event.output.value.rows,
              verdict: {
                ...context.verdict,
                receipt: event.output.value.receipt,
                rows: event.output.value.rows,
              },
            },
            target: "classify",
          };
        },
        onError: {
          context: ({ context }) => ended(context, "crashed", "plan"),
          target: "planCrashed",
        },
        src: "plan",
      },
    },
    planCrashed: { type: "final" },
    planned: { type: "final" },
    preflight: {
      invoke: {
        input: ({ context }) => context.input,
        onDone: ({ context, event }) => {
          if (event.output.kind === "crashed") {
            return {
              context: ended(context, "crashed", "preflight"),
              target: "preflightCrashed",
            };
          }

          if (event.output.kind === "refused") {
            return {
              context: ended(
                context,
                "refused",
                "preflight",
                event.output.keys,
                event.output.reason
              ),
              target: "refused",
            };
          }

          return {
            context: {
              verdict: { ...context.verdict, keys: event.output.value },
            },
            target: "plan",
          };
        },
        onError: {
          context: ({ context }) => ended(context, "crashed", "preflight"),
          target: "preflightCrashed",
        },
        src: "preflight",
      },
    },
    preflightCrashed: { type: "final" },
    quietWindow: {
      invoke: {
        input: ({ context }) =>
          context.quietDeadline === undefined
            ? {}
            : { deadline: context.quietDeadline },
        onDone: ({ context, event }) => {
          if (event.output.kind === "crashed") {
            return {
              context: ended(context, "crashed", "quietWindow"),
              target: "quietWindowCrashed",
            };
          }

          if (event.output.kind === "refused") {
            return {
              context: ended(
                context,
                "refused",
                "quietWindow",
                event.output.keys,
                event.output.reason
              ),
              target: "refused",
            };
          }

          const decision = event.output.value;

          if (decision.kind === "refused") {
            return {
              context: ended(
                context,
                "refused",
                "quietWindow",
                [...quietWindowKeys],
                decision.reason
              ),
              target: "refused",
            };
          }

          if (decision.kind === "wait") {
            return {
              context: {
                quietDeadline: decision.deadline,
                quietUntil: decision.until,
              },
              target: "awaitingQuietWindow",
            };
          }

          return {
            context: { quietDeadline: decision.deadline },
            target: "apply",
          };
        },
        onError: {
          context: ({ context }) => ended(context, "crashed", "quietWindow"),
          target: "quietWindowCrashed",
        },
        src: "quietWindow",
      },
    },
    quietWindowCrashed: { type: "final" },
    recordingWatch: {
      invoke: {
        input: ({ context }) =>
          context.watch ?? watchReceipt(context.input.profile, "crashed"),
        onDone: { target: "watched" },
        onError: { target: "watched" },
        src: "recordWatch",
      },
    },
    refused: { type: "final" },
    rollingBack: {
      invoke: {
        input: ({ context }) => ({ profile: context.input.profile }),
        onDone: ({ context, event }) => {
          const details =
            context.watchCheck === undefined
              ? {}
              : { check: context.watchCheck };

          if (event.output.kind === "restored") {
            return {
              context: {
                watch: watchReceipt(context.input.profile, "rolled-back", {
                  ...details,
                  rollback: event.output.receipt,
                }),
              },
              target: "recordingWatch",
            };
          }

          const failed = { ...details, rollbackReason: event.output.reason };

          return {
            context: {
              watch: watchReceipt(
                context.input.profile,
                "rollback-failed",
                event.output.receipt === undefined
                  ? failed
                  : { ...failed, rollback: event.output.receipt }
              ),
            },
            target: "recordingWatch",
          };
        },
        onError: {
          context: ({ context }) => ({
            watch: watchReceipt(context.input.profile, "rollback-failed", {
              rollbackReason: "rollback-crashed",
            }),
          }),
          target: "recordingWatch",
        },
        src: "rollback",
      },
    },
    source: {
      invoke: {
        input: ({ context }) =>
          context.input.expectSha === undefined
            ? {}
            : { expectSha: context.input.expectSha },
        onDone: ({ context, event }) => {
          if (event.output.kind === "crashed") {
            return {
              context: ended(context, "crashed", "source"),
              target: "sourceCrashed",
            };
          }

          if (event.output.kind === "refused") {
            const { verdict } = ended(
              context,
              "refused",
              "source",
              event.output.keys,
              event.output.reason
            );

            return {
              context: {
                verdict:
                  event.output.checkout === undefined
                    ? verdict
                    : { ...verdict, checkout: event.output.checkout },
              },
              target: "refused",
            };
          }

          return {
            context: {
              verdict:
                event.output.kind === "match"
                  ? { ...context.verdict, checkout: event.output.checkout }
                  : context.verdict,
            },
            target: "preflight",
          };
        },
        onError: {
          context: ({ context }) => ended(context, "crashed", "source"),
          target: "sourceCrashed",
        },
        src: "source",
      },
    },
    sourceCrashed: { type: "final" },
    verdict: { type: "final" },
    watched: { type: "final" },
    watching: {
      invoke: {
        input: ({ context }) =>
          context.verdict.receipt ?? {
            notUpdated: [],
            outcome: "crashed",
            retainedOrphans: [],
            updated: [],
            versions: {},
          },
        onDone: ({ context, event }) => {
          if (event.output.kind !== "ok") {
            return {
              context: {
                watch: watchReceipt(context.input.profile, "crashed"),
              },
              target: "recordingWatch",
            };
          }

          const observed = gateOutcome(event.output.value);

          if (observed === "pass") {
            return {
              context: {
                watch: watchReceipt(context.input.profile, "passed", {
                  check: event.output.value,
                }),
              },
              target: "recordingWatch",
            };
          }

          if (observed === "fail") {
            return {
              context: { watchCheck: event.output.value },
              target: "rollingBack",
            };
          }

          return {
            context: {
              watch: watchReceipt(context.input.profile, "crashed", {
                check: event.output.value,
              }),
            },
            target: "recordingWatch",
          };
        },
        onError: {
          context: ({ context }) => ({
            watch: watchReceipt(context.input.profile, "crashed"),
          }),
          target: "recordingWatch",
        },
        src: "watch",
      },
    },
  },
});

const deployLifecycle = (
  input: DeployInput,
  reported: Deferred.Deferred<DeployVerdict>
) =>
  Effect.gen(function* runLifecycle() {
    const actor = yield* createEffectActor(deployMachine, { input });
    yield* watchActor("deployMachine", actor);

    const verdict = yield* waitFor(
      actor,
      (snapshot) =>
        snapshot.status !== "active" ||
        snapshot.matches("watching") ||
        snapshot.matches("rollingBack") ||
        snapshot.matches("recordingWatch")
    ).pipe(Effect.orDie);

    yield* Deferred.succeed(reported, verdict.context.verdict);

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Step crashes are explicit states; an unexpected machine failure remains a defect.
    yield* join(actor).pipe(Effect.orDie);

    return Option.fromUndefinedOr(actor.getSnapshot().context.watch);
  }).pipe(
    Effect.scoped,
    Effect.onInterrupt(() =>
      Effect.gen(function* recordInterruptedWatch() {
        if (!(yield* Deferred.isDone(reported))) {
          yield* Deferred.interrupt(reported);

          return;
        }

        yield* DeployRunner.use((runner) =>
          runner.recordWatch(watchReceipt(input.profile, "interrupted"))
        ).pipe(Effect.ignore);
      })
    ),
    Effect.catchCause((cause) =>
      Effect.gen(function* settleCrashedLifecycle() {
        if (Cause.hasInterrupts(cause)) {
          return yield* Effect.failCause(cause);
        }

        if (!(yield* Deferred.isDone(reported))) {
          yield* Deferred.failCause(reported, cause);

          return Option.none<WatchReceipt>();
        }

        const crashed = watchReceipt(input.profile, "crashed");

        yield* DeployRunner.use((runner) => runner.recordWatch(crashed)).pipe(
          Effect.ignore
        );

        return Option.some(crashed);
      })
    )
  );

export const runDeploy = Effect.fn("runDeploy")(function* runDeploy(
  input: DeployInput
) {
  const host = yield* WatchHost;
  const reported = yield* Deferred.make<DeployVerdict>();

  yield* host.hold(deployLifecycle(input, reported));

  return yield* Deferred.await(reported);
});
