import { DrovrIntake } from "@rat-stack/core/interest";
import type { IntakeRequest, IntakeResult } from "@rat-stack/core/interest";
import { Effect, Layer, Ref } from "effect";

export const fakeIntake = (script: readonly IntakeResult[]) =>
  Effect.gen(function* makeFakeIntake() {
    const calls = yield* Ref.make<readonly IntakeRequest[]>([]);

    const layer = Layer.succeed(DrovrIntake, {
      submit: (request: IntakeRequest) =>
        Ref.modify(calls, (all) => [
          script[all.length] ?? script.at(-1) ?? { kind: "refused" as const },
          [...all, request],
        ]),
    });

    return { calls: Ref.get(calls), layer } as const;
  });

export const fakeIntakeLayer = Layer.succeed(DrovrIntake, {
  submit: () => Effect.succeed<IntakeResult>({ kind: "accepted" }),
});
