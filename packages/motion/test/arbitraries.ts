import { expect } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

export const integerBetween = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ maximum, minimum })));

const UNIT_RESOLUTION = 2 ** 30;

export const unit = integerBetween(0, UNIT_RESOLUTION).pipe(
  Arbitrary.map((steps) => steps / UNIT_RESOLUTION)
);

export const between = (minimum: number, maximum: number) =>
  unit.pipe(Arbitrary.map((amount) => minimum + (maximum - minimum) * amount));

export const orderedUnitPair = Arbitrary.all([unit, unit]).pipe(
  Arbitrary.map(([first, second]) =>
    first <= second ? ([first, second] as const) : ([second, first] as const)
  )
);

export const coordinate = between(-1000, 1000);

export const decimal = integerBetween(-100_000, 100_000).pipe(
  Arbitrary.map((hundredths) => hundredths / 100)
);

export const vectorOf = (dimensions: number) =>
  Arbitrary.array(coordinate, { maxLength: dimensions, minLength: dimensions });

export const oneOf = <const Value>(values: readonly [Value, ...Value[]]) =>
  integerBetween(0, values.length - 1).pipe(
    Arbitrary.map((index) => values[index] ?? values[0])
  );

export const falsifies = <Value>(
  arbitrary: Arbitrary.Arbitrary<Value>,
  property: (value: Value) => boolean
) =>
  Effect.gen(function* checkPlantedBug() {
    const result = yield* Arbitrary.checkEffect(arbitrary, property);

    expect(result).toHaveProperty("shrunkInput");
  });
