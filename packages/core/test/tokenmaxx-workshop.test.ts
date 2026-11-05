import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";

import { WorkshopPublicData, WorkshopRun } from "../src/tokenmaxx-workshop.js";
import {
  WorkshopDirectory,
  currentExercise,
} from "../src/workshop-directory.js";

const segment = Schema.Struct({
  duration: Schema.Int.check(Schema.isBetween({ maximum: 1200, minimum: 1 })),
  gap: Schema.Int.check(Schema.isBetween({ maximum: 60, minimum: 0 })),
});

const epoch = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-11-17T16:00:00Z")
);

const iso = (milliseconds: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(milliseconds)).replace(".000Z", "Z");

describe("workshop current exercise", () => {
  it.effect.prop(
    "matches generated half-open intervals, including every boundary and gap",
    {
      offset: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ maximum: 20_000, minimum: -1000 }))
      ),
      segments: Arbitrary.schema(
        Schema.Array(segment).check(
          Schema.isMinLength(1),
          Schema.isMaxLength(8)
        )
      ),
    },
    ({ offset, segments }) =>
      Effect.gen(function* checkGeneratedTimeline() {
        const intervals: { start: number; end: number; id: string }[] = [];

        for (const [index, value] of segments.entries()) {
          const start = (intervals.at(-1)?.end ?? epoch) + value.gap * 1000;
          intervals.push({
            end: start + value.duration * 1000,
            id: `block-${index}`,
            start,
          });
        }

        const run = yield* Schema.decodeUnknownEffect(WorkshopRun)({
          blocks: intervals.map((interval, index) => ({
            end: iso(interval.end),
            id: interval.id,
            kind: index % 2 === 0 ? "block" : "break",
            name: interval.id,
            start: iso(interval.start),
          })),
          date: "2026-11-17",
          end: iso(intervals.at(-1)?.end ?? epoch + 1000),
          label: "Generated run",
          localNote: "",
          start: iso(epoch),
        });

        const data = yield* Schema.decodeUnknownEffect(WorkshopPublicData)({
          exercises: intervals.map((interval) => ({
            body: "Published body",
            id: interval.id,
            section: interval.id,
            status: "published",
            title: interval.id,
          })),
          links: { links: [], status: "not-yet-published" },
          prep: { items: [], status: "not-yet-published" },
          runs: [run],
        });

        const instants = [
          epoch + offset * 1000,
          ...intervals.flatMap((interval) => [
            interval.start - 1,
            interval.start,
            interval.end - 1,
            interval.end,
            interval.end + 1,
          ]),
        ];

        for (const now of instants) {
          yield* TestClock.setTime(now);

          const actual = yield* currentExercise
            .handler({ run: run.date })
            .pipe(Effect.provide(WorkshopDirectory.layer(data)));

          const expected = intervals.find(
            (interval) => now >= interval.start && now < interval.end
          );

          if (expected === undefined) {
            const next = intervals.find((interval) => interval.start > now);

            expect(actual).toStrictEqual({
              nextStart: next === undefined ? null : iso(next.start),
              status: "not-running",
            });
          } else {
            expect(actual.status).toBe("running");

            if (actual.status === "running") {
              expect(actual.block.id).toBe(expected.id);
              const index = intervals.indexOf(expected);
              expect(
                actual.exercises.map((exercise) => exercise.id)
              ).toStrictEqual(index % 2 === 0 ? [expected.id] : []);
            }
          }
        }
      }),
    { arbitrary: { runs: 100 } }
  );
});
