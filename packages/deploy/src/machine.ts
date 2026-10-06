import { watchActor } from "@rat-stack/capability/actor-watch";
import { gateOutcome } from "@rat-stack/check-harness";
import type { Verdict } from "@rat-stack/check-harness";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import { Cause, Effect, Schema } from "effect";
import { types } from "xstate";

import { ApplyReceiptSchema, DeployInputSchema } from "./contracts.js";
import type {
  DeployInput,
  DeployStepError,
  DeployVerdict,
} from "./contracts.js";
import { DeployRunner } from "./deploy-runner.js";
import { classifyPlan } from "./plan.js";

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
  Effect.matchEffect(work, {
    onFailure: (failure) =>
      Effect.succeed<StepResult<A>>({
        keys: failure.keys,
        kind: "refused",
        reason: failure.reason,
      }),
    onSuccess: (value) => Effect.succeed<StepResult<A>>({ kind: "ok", value }),
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.interrupt
        : Effect.succeed<StepResult<A>>({ kind: "crashed" })
    )
  );

interface DeployContext {
  readonly input: DeployInput;
  readonly plan: string;
  readonly verdict: DeployVerdict;
}

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
    Effect.sync(() => classifyPlan(input.plan, input.allow)),
  schemas: {
    input: Schema.Struct({
      allow: DeployInputSchema.fields.allow,
      plan: Schema.String,
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
  actors: { apply, checks, classify, plan, preflight },
  schemas: { context: types<DeployContext>(), input: DeployInputSchema },
}).createMachine({
  context: ({ input }) => ({
    input,
    plan: "",
    verdict: {
      checks: [],
      keys: [],
      outcome: "unknown",
      rows: [],
      step: "preflight",
    },
  }),
  initial: "preflight",
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
              context: ended(context, "failed", "apply"),
              target: "failed",
            };
          }

          if (event.output.value.outcome !== "applied") {
            return {
              context: {
                verdict: {
                  ...context.verdict,
                  outcome: event.output.value.outcome,
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
    checks: {
      invoke: {
        input: ({ context }) =>
          context.verdict.receipt ?? {
            notUpdated: [],
            outcome: "crashed",
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
          plan: context.plan,
        }),
        onDone: ({ context, event }) => {
          if (event.output.outcome !== "pass") {
            return {
              context: ended(
                context,
                event.output.outcome === "unknown" ? "unknown" : "refused",
                "classify",
                context.verdict.keys,
                event.output.error.reason
              ),
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
            target: "apply",
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

          return { context: { plan: event.output.value }, target: "classify" };
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
                event.output.keys
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
    refused: { type: "final" },
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
