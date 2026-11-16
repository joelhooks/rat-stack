import { expect, it } from "@effect/vitest";
import { JOIN_CONTACT_RETENTION_MILLIS } from "@rat-stack/core/join-interest";
import { Clock, DateTime, Effect, Option, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import {
  JOIN_CONTACT_KEY,
  joinContactCell,
} from "../src/interest/join-contact-cell.js";
import type { JoinCellStorage } from "../src/interest/join-contact-cell.js";

const Command = Schema.Struct({
  advance: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 86_401 })),
  kind: Schema.Literals([
    "save",
    "erase",
    "requestErase",
    "accepted",
    "tombstone",
    "restart",
    "alarm",
  ]),
});

it.effect.prop(
  "a durable deadline survives saves and restarts; alarms erase sealed data and late saves cannot restore it",
  {
    commands: Arbitrary.array(Arbitrary.schema(Command), {
      minLength: 1,
      maxLength: 15,
    }),
  },
  ({ commands }) =>
    Effect.gen(function* retentionHistory() {
      const entries = yield* Ref.make<ReadonlyMap<string, unknown>>(new Map());
      const alarm = yield* Ref.make(Option.none<number>());

      const storage: JoinCellStorage = {
        delete: (key) =>
          Ref.update(entries, (held) => {
            const next = new Map(held);
            next.delete(key);

            return next;
          }),
        get: (key) =>
          Ref.get(entries).pipe(Effect.map((held) => held.get(key))),
        put: (key, value) =>
          Ref.update(entries, (held) => new Map(held).set(key, value)),
        setAlarm: (at) => Ref.set(alarm, Option.some(at)),
      };

      let cell = joinContactCell(storage);

      const deadline =
        (yield* Clock.currentTimeMillis) + JOIN_CONTACT_RETENTION_MILLIS;

      let erased = false;
      let marker = false;
      let handedToDrovr = false;
      let handedToDrovrAt: string | null = null;
      let sealed = "first-sealed-contact";
      yield* cell.joinSave(
        sealed,
        false,
        deadline,
        "synthetic-retention-contact"
      );

      for (const [index, command] of commands.entries()) {
        yield* TestClock.adjust(command.advance * 1000);
        const now = yield* Clock.currentTimeMillis;
        const alarmAt = Option.getOrUndefined(yield* Ref.get(alarm));

        if (alarmAt !== undefined && alarmAt <= now) {
          yield* cell.alarm();

          erased = true;
        }

        if (command.kind === "restart") {
          cell = joinContactCell(storage);
        } else if (command.kind === "erase" || command.kind === "accepted") {
          if (command.kind === "accepted") {
            if (!handedToDrovr) {
              handedToDrovrAt = DateTime.formatIso(yield* DateTime.now);
            }

            yield* cell.joinMarkHandedToDrovr();
            handedToDrovr = true;
          }

          yield* cell.joinErase();
          erased = true;
        } else if (command.kind === "requestErase") {
          yield* cell.joinRequestErase();
          yield* cell.joinErase();
          marker = true;
          erased = true;
        } else if (command.kind === "tombstone") {
          yield* cell.joinCompleteErasure();
          marker = false;
        } else if (command.kind === "alarm") {
          yield* cell.alarm();
        } else {
          sealed = `sealed-contact-${index}`;
          yield* cell.joinSave(
            sealed,
            false,
            now + JOIN_CONTACT_RETENTION_MILLIS
          );
        }

        expect(yield* cell.joinRead()).toBe(erased ? undefined : sealed);
        expect(yield* cell.joinReadErasure()).toEqual(
          marker
            ? {
                contactRef: "synthetic-retention-contact",
                handedToDrovr,
                handedToDrovrAt,
                pending: "erase",
              }
            : undefined
        );
        expect(Option.getOrUndefined(yield* Ref.get(alarm))).toBe(deadline);

        if (erased) {
          expect((yield* Ref.get(entries)).has(JOIN_CONTACT_KEY)).toBe(false);
        }
      }

      const now = yield* Clock.currentTimeMillis;
      yield* TestClock.adjust(Math.max(0, deadline - now));
      yield* cell.alarm();

      expect((yield* Ref.get(entries)).has(JOIN_CONTACT_KEY)).toBe(false);
      yield* cell.joinSave("late-result", false);
      expect(yield* cell.joinRead()).toBeUndefined();
      expect((yield* cell.joinReadErasure()) !== undefined).toBe(marker);
    }),
  { arbitrary: { runs: 200 } }
);
