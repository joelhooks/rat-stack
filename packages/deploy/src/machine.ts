import { watchActor } from "@rat-stack/capability/actor-watch";
import { gateOutcome } from "@rat-stack/check-harness";
import type { Verdict } from "@rat-stack/check-harness";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import { Cause, Clock, Effect, Schema } from "effect";
import { types } from "xstate";

import {
  ApplyReceiptSchema,
  DeployInputSchema,
  DeployStepError,
} from "./contracts.js";
import type { DeployInput, DeployVerdict } from "./contracts.js";
import { DeployRunner } from "./deploy-runner.js";
import { classifyRows, PlanRowsSchema } from "./plan.js";
import type { PlanRow } from "./plan.js";
import { quietWindowKeys, readQuietWindow } from "./quiet-window.js";
import { decideSource } from "./source.js";
import type { CheckoutState } from "./source.js";

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

const source = fromEffect({
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

const quietWindow = fromEffect({
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

const awaitQuietWindow = fromEffect({
  effect: ({ input }) =>
    Effect.gen(function* awaitQuietWindowEnd() {
      const now = yield* Clock.currentTimeMillis;

      yield* Effect.sleep(Math.max(0, input.until - now));
    }),
  schemas: { input: Schema.Struct({ until: Schema.Natural }) },
});

const preflight = fromEffect({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.preflight(input))),
  schemas: { input: DeployInputSchema },
});

const plan = fromEffect({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.plan(input))),
  schemas: { input: DeployInputSchema },
});

const classify = fromEffect({
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

const apply = fromEffect({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.apply(input))),
  schemas: { input: DeployInputSchema },
});

const checks = fromEffect({
  effect: ({ input }) =>
    stepResult(DeployRunner.use((runner) => runner.checks(input))),
  schemas: { input: ApplyReceiptSchema },
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
    source,
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
                  ...context.verdict,
                  outcome:
                    event.output.value.outcome === "prepared"
                      ? "unknown"
                      : event.output.value.outcome,
                  receipt: event.output.value,
                  step: "apply",
                },
              },
              target: "applyUnsuccessful",
            };
          }

          return {
            context: {
              verdict: { ...context.verdict, receipt: event.output.value },
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

          return {
            context: {
              verdict: {
                ...context.verdict,
                checks: event.output.value,
                outcome: checksOutcome(event.output.value),
                step: "checks",
              },
            },
            target: "verdict",
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
    refused: { type: "final" },
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
  },
});

export const runDeploy = Effect.fn("runDeploy")(function* runDeploy(
  input: DeployInput
) {
  const actor = yield* createEffectActor(deployMachine, { input });
  yield* watchActor("deployMachine", actor);

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Step crashes are explicit states; an unexpected machine failure remains a defect.
  return yield* join(actor).pipe(Effect.orDie);
}, Effect.scoped);
