import { expect, it } from "@effect/vitest";
import { CallWatch } from "@rat-stack/capability/call-watch";
import { Effect, Layer, Schema } from "effect";

import {
  JoinInterest,
  MASKED_INTEREST_VALUE,
  JOIN_ANSWER,
  joinInterest,
  joinInterestContract,
} from "../src/join-interest.js";

it.effect(
  "call observation masks the approved card and status reference, and refuses masked replay",
  () =>
    Effect.gen(function* privateObservation() {
      const card = {
        agentRef: "planted-agent-private",
        answers: {
          building: "planted-building-private",
          leaveWith: "planted-leave-private",
          today: "planted-today-private",
        },
        consent: { contact: true, share: true },
        email: "planted-private@example.test",
        ticket: "planted-private-ticket",
      } as const;

      const observations: { input: unknown; result: unknown }[] = [];
      let calls = 0;

      const layers = Layer.mergeAll(
        Layer.succeed(JoinInterest, {
          submit: () =>
            Effect.sync(() => {
              calls += 1;

              return {
                message: JOIN_ANSWER,
                statusRef: "planted-private-status",
              };
            }),
        }),
        Layer.succeed(CallWatch, {
          around: (contract, input, run) =>
            run.pipe(
              Effect.tap((result) =>
                Effect.sync(() => {
                  expect(contract.name).toBe("joinInterest");
                  observations.push({ input, result });
                })
              )
            ),
        })
      );

      const result = yield* joinInterest
        .handler(card)
        .pipe(Effect.provide(layers));

      expect(result.statusRef).toBe("planted-private-status");
      expect(observations.length).toBe(1);
      const serialized = JSON.stringify(observations);

      for (const value of [
        card.agentRef,
        ...Object.values(card.answers),
        card.email,
        card.ticket,
        result.statusRef,
      ]) {
        expect(serialized).not.toContain(value);
      }

      expect(serialized).toContain('"contact":true');
      expect(serialized).toContain('"share":true');
      expect(serialized).toContain('"statusRef":"redacted"');
      const [recorded] = observations;
      expect(
        yield* Schema.decodeUnknownEffect(joinInterestContract.input)(
          recorded?.input
        ).pipe(
          Effect.exit,
          Effect.map((exit) => exit._tag)
        )
      ).toBe("Failure");

      const refusal = yield* joinInterest
        .handler({
          ...card,
          email: MASKED_INTEREST_VALUE,
          ticket: MASKED_INTEREST_VALUE,
        })
        .pipe(Effect.provide(layers), Effect.flip);

      expect(refusal._tag).toBe("MaskedInterestReplay");
      expect(refusal.message).toContain("Cannot replay");
      expect(calls).toBe(1);
    })
);
