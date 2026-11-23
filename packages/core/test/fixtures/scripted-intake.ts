import { Effect, Layer, Ref } from "effect";

import { SubscriberIntake } from "../../src/interest-intake.js";
import type {
  AgentIntakeRequest,
  IntakeRequest,
  IntakeResult,
} from "../../src/interest-intake.js";

type Submission<Request> = (
  request: Request,
  index: number
) => Effect.Effect<IntakeResult>;

interface IntakeScript {
  readonly submit?: Submission<IntakeRequest>;
  readonly agent?: {
    readonly enabled?: boolean;
    readonly submit?: Submission<AgentIntakeRequest>;
  };
}

const submitFromScript =
  <Request>(calls: Ref.Ref<readonly Request[]>, submit: Submission<Request>) =>
  (request: Request) =>
    Ref.modify(calls, (all) => [all.length, [...all, request]]).pipe(
      Effect.flatMap((index) => submit(request, index))
    );

export const makeScriptedIntake = Effect.fnUntraced(
  function* makeScriptedIntake({ agent, submit }: IntakeScript = {}) {
    const calls = yield* Ref.make<readonly IntakeRequest[]>([]);
    const agentCalls = yield* Ref.make<readonly AgentIntakeRequest[]>([]);

    const browser = {
      submit: submitFromScript(
        calls,
        submit ?? (() => Effect.die("Unexpected browser intake submission"))
      ),
    };

    const layer = Layer.succeed(
      SubscriberIntake,
      agent === undefined
        ? browser
        : {
            ...browser,
            agent: {
              enabled: agent.enabled ?? true,
              submit: submitFromScript(
                agentCalls,
                agent.submit ??
                  (() => Effect.die("Unexpected agent intake submission"))
              ),
            },
          }
    );

    return { agentCalls: Ref.get(agentCalls), calls: Ref.get(calls), layer };
  }
);

export const scriptedIntakeLayer = (script?: IntakeScript) =>
  Layer.unwrap(
    Effect.map(makeScriptedIntake(script), (intake) => intake.layer)
  );
