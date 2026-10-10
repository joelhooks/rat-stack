import type { Flag, FlagContext } from "@rat-stack/core/flags";
import { Schema } from "effect";

export const Percentage = Schema.Finite.check(
  Schema.isBetween({ maximum: 100, minimum: 0 })
);

export const FlagRule = Schema.Struct({
  percentage: Schema.optionalKey(Percentage),
  subjects: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  value: Schema.Json,
});

export interface Rule<A> {
  readonly subjects?: readonly string[];
  readonly percentage?: number;
  readonly value: A;
}

export const subjectBucket = (name: string, subject: string) => {
  let hash = 2_166_136_261;
  const input = JSON.stringify([name, subject]);

  for (const character of input) {
    // oxlint-disable-next-line eslint/no-bitwise -- FNV-1a mixes each Unicode code point into a fixed 32-bit hash.
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16_777_619);
  }

  // oxlint-disable-next-line eslint/no-bitwise -- Unsigned conversion maps the FNV-1a result into the rollout bucket range.
  return ((hash >>> 0) / 4_294_967_296) * 100;
};

export const evaluateFlag = <A>(
  flag: Flag<A>,
  context: FlagContext,
  rules: readonly Rule<A>[]
): A => {
  if (context.subject === undefined) {
    return flag.default;
  }

  for (const rule of rules) {
    if (
      rule.subjects?.includes(context.subject) === true ||
      (rule.percentage !== undefined &&
        subjectBucket(flag.name, context.subject) < rule.percentage)
    ) {
      return rule.value;
    }
  }

  return flag.default;
};
