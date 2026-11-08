import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { SideSchema, diff, readPath, summarize } from "../src/index.js";

const json = Arbitrary.schema(Schema.Json);

const isJsonRecord = Schema.is(Schema.Record(Schema.String, Schema.Json));

const isJsonArray = Schema.is(Schema.Array(Schema.Json));

const hasDottedKey = (value: Schema.Json): boolean => {
  if (isJsonArray(value)) {
    return value.some(hasDottedKey);
  }

  return (
    isJsonRecord(value) &&
    Object.entries(value).some(
      ([key, field]) => key.includes(".") || hasDottedKey(field)
    )
  );
};

const dotFreeJson = json.pipe(
  Arbitrary.filter((value) => !hasDottedKey(value))
);

const sameJson = Schema.toEquivalence(Schema.Json);

const InheritedName = Schema.Literals([
  "constructor",
  "hasOwnProperty",
  "toString",
  "valueOf",
]);

const partialRecord = Arbitrary.schema(
  Schema.Record(InheritedName, Schema.optionalKey(Schema.Json))
);

const sideAt = (value: Schema.Json, path: string) =>
  readPath(value, path).pipe(
    Effect.exit,
    Effect.map((read) =>
      Exit.isSuccess(read)
        ? SideSchema.cases.Present.make({ value: summarize(read.value) })
        : SideSchema.cases.Absent.make({})
    )
  );

describe("json diff", () => {
  it.prop("finds no change between a value and itself", [json], ([value]) => {
    expect(diff(value, value)).toEqual([]);
  });

  it.effect.prop(
    "reads only a record's own keys, never its prototype's",
    [partialRecord, Arbitrary.schema(InheritedName)],
    ([record, name]) =>
      Effect.gen(function* readsOwnKeys() {
        const read = yield* readPath(record, `root.${name}`).pipe(Effect.exit);

        expect(Exit.isSuccess(read)).toBe(Object.hasOwn(record, name));
      })
  );

  it.prop(
    "finds a change whenever two values differ",
    [dotFreeJson, dotFreeJson],
    ([before, after]) => {
      expect(diff(before, after).length === 0).toBe(sameJson(before, after));
    }
  );

  it.effect.prop(
    "reports every change at a path that reads back to both recorded sides when no key holds a dot",
    [dotFreeJson, dotFreeJson],
    ([before, after]) =>
      Effect.gen(function* readsBack() {
        for (const change of diff(before, after)) {
          expect(yield* sideAt(before, change.path)).toEqual(change.before);
          expect(yield* sideAt(after, change.path)).toEqual(change.after);
        }
      })
  );
});
