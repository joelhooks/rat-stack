import {
  IntakeApplications,
  IntakeErasure,
  IntakeRedeliver,
  JoinRetentionBackfill,
} from "@rat-stack/core/join-interest";
import { Effect, Layer } from "effect";
import type { Context } from "effect";

import type { AgentSignupOptions, agentSignupLayer } from "./join-layer.js";

export const interestOperatorOptions = Effect.fnUntraced(
  function* interestOperatorOptions(
    agentSignup?: AgentSignupOptions,
    joinServices?: Context.Context<
      Layer.Success<ReturnType<typeof agentSignupLayer>>
    >
  ) {
    const applications =
      agentSignup?.applications === undefined || joinServices === undefined
        ? undefined
        : yield* IntakeApplications.pipe(
            Effect.provide(
              agentSignup.applications.pipe(
                Layer.provide(Layer.succeedContext(joinServices))
              )
            )
          );

    const erasure =
      joinServices === undefined
        ? undefined
        : yield* IntakeErasure.pipe(
            Effect.provide(
              IntakeErasure.layer.pipe(
                Layer.provide(Layer.succeedContext(joinServices))
              )
            )
          );

    const redelivery =
      joinServices === undefined
        ? undefined
        : yield* IntakeRedeliver.pipe(
            Effect.provide(
              IntakeRedeliver.layer.pipe(
                Layer.provide(Layer.succeedContext(joinServices))
              )
            )
          );

    const backfill =
      joinServices === undefined
        ? undefined
        : yield* JoinRetentionBackfill.pipe(
            Effect.provideContext(joinServices)
          );

    return { applications, erasure, redelivery, backfill };
  }
);
