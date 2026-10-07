import { describe, expect, it } from "@effect/vitest";
import type { ConceptProgress, LearnEvent } from "@rat-stack/core/learn";
import { ConceptProgressSchema, newConcept } from "@rat-stack/core/learn";
import { createEffectActor, send, waitFor } from "@xstate/effect";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { progressMachine } from "../src/progress-machine.js";
import {
  DECAY_GAP_MS,
  LONG_GAP_MS,
  explanationDepth,
  mergeProgress,
} from "../src/progress.js";

const time = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 1_000_000_000_000, minimum: 0 }))
);

const familiarity = Arbitrary.schema(ConceptProgressSchema.fields.familiarity);

const dismissal = Arbitrary.schema(Schema.Boolean);

const gap = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: DECAY_GAP_MS - 1, minimum: 0 }))
);

const step = Schema.Struct({
  advance: Schema.Literals([0, 1, LONG_GAP_MS, DECAY_GAP_MS]),
  kind: Schema.Literals([
    "shown",
    "used",
    "got-it",
    "skipped",
    "dismissed",
    "elapsed",
  ]),
});

const steps = Arbitrary.array(Arbitrary.schema(step), {
  maxLength: 35,
  minLength: 1,
});

const concept = (
  rank: 0 | 1 | 2 | 3,
  at: number,
  isDismissed = false
): ConceptProgress => ({
  ...newConcept("effect.layer"),
  dismissed: isDismissed,
  familiarity: rank,
  lastPracticedAt: at,
  lastShownAt: at,
});

describe("presentation policy", () => {
  it.prop(
    "presents each rank at the specified depth before decay, with dismissal and explicit asking",
    { dismissed: dismissal, gap, time },
    ({ time: shownAt, gap: elapsed, dismissed: isDismissed }) => {
      const expected = [
        "walkthrough",
        elapsed < LONG_GAP_MS ? "line" : "paragraph",
        elapsed < LONG_GAP_MS ? null : "line",
        null,
      ];

      for (const rank of [0, 1, 2, 3] as const) {
        expect(
          explanationDepth(
            concept(rank, shownAt, isDismissed),
            shownAt + elapsed
          )
        ).toBe(isDismissed ? null : expected[rank]);
        expect(
          explanationDepth(
            concept(rank, shownAt, isDismissed),
            shownAt + elapsed,
            true
          )
        ).toBe(
          isDismissed
            ? null
            : ["walkthrough", "paragraph", "paragraph", "paragraph"][rank]
        );
      }
    }
  );

  it.prop(
    "merge converges to newest presentation and maximum familiarity without losing dismissal",
    {
      dismissed: dismissal,
      leftAt: time,
      leftRank: familiarity,
      rightAt: time,
      rightRank: familiarity,
    },
    ({ leftAt, rightAt, leftRank, rightRank, dismissed: isDismissed }) => {
      const left = {
        concepts: [concept(leftRank, leftAt, isDismissed)],
        version: 1 as const,
      };

      const right = {
        concepts: [concept(rightRank, rightAt)],
        version: 1 as const,
      };

      const merged = mergeProgress(left, right);
      expect(merged.concepts[0]).toMatchObject({
        dismissed: isDismissed,
        familiarity: Math.max(leftRank, rightRank),
        lastPracticedAt: Math.max(leftAt, rightAt),
        lastShownAt: Math.max(leftAt, rightAt),
      });
      expect(mergeProgress(right, left)).toStrictEqual(merged);
      expect(mergeProgress(merged, merged)).toStrictEqual(merged);
      expect(mergeProgress(merged, left)).toStrictEqual(merged);
    }
  );

  it.effect.prop(
    "generated learning histories and time passing match an independent model after every event",
    { steps },
    ({ steps: generated }) =>
      Effect.gen(function* replayHistory() {
        const actor = yield* createEffectActor(progressMachine, {
          input: { at: 0, progress: newConcept("effect.layer") },
        });

        yield* waitFor(actor, (snapshot) => snapshot.matches("new")).pipe(
          Effect.orDie
        );
        let rank = 0;
        let shownAt: number | null = null;
        let practicedAt: number | null = null;
        let dismissed = false;
        let now = 0;
        let revision = 0;

        for (const command of generated) {
          now += command.advance;

          if (command.kind === "elapsed") {
            yield* send(actor, { at: now, type: "ELAPSED" });
          } else {
            const event: LearnEvent =
              command.kind === "shown"
                ? {
                    at: now,
                    depth: "line",
                    id: "effect.layer",
                    kind: "shown",
                    version: 1,
                  }
                : {
                    at: now,
                    id: "effect.layer",
                    kind: command.kind,
                    version: 1,
                  };

            yield* send(actor, { event, type: "RECORD" });

            if (command.kind === "shown") {
              shownAt = now;
              rank = Math.max(rank, 1);
            } else if (command.kind === "dismissed") {
              dismissed = true;
            } else {
              practicedAt = now;
              rank = Math.min(rank + 1, 3);
            }
          }

          revision += 1;
          const expectedRevision = revision;

          const snapshot = yield* waitFor(
            actor,
            (state) => state.context.revision === expectedRevision
          ).pipe(Effect.orDie);

          expect(snapshot.context.progress).toStrictEqual({
            dismissed,
            familiarity: rank,
            id: "effect.layer",
            lastPracticedAt: practicedAt,
            lastShownAt: shownAt,
          });

          const stale =
            rank > 0 &&
            now - Math.max(shownAt ?? 0, practicedAt ?? 0) >= DECAY_GAP_MS;

          expect(snapshot.value).toBe(
            stale
              ? "decaying"
              : ["new", "introduced", "familiar", "fluent"][rank]
          );
        }
      }).pipe(Effect.scoped)
  );
});
