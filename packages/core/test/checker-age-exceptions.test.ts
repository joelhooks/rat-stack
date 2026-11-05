import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { checkerAgeExceptions } from "../../../scripts/checker-age-exceptions.js";

const version = Arbitrary.schema(Schema.Int).pipe(
  Arbitrary.map((number) => `0.${Math.abs(number)}.0-ts7.1.0-beta`)
);

const movedNames = [
  "tsrs",
  ...[
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64-gnu",
    "linux-arm64-musl",
    "linux-x64-gnu",
    "linux-x64-musl",
    "win32-x64",
  ].map((platform) => `@tsrs/${platform}`),
  "@yielded/effect-tsrs",
  ...[
    "linux-x64",
    "linux-arm64",
    "darwin-x64",
    "darwin-arm64",
    "win32-x64",
  ].map((platform) => `@yielded/effect-tsrs-${platform}`),
];

it.prop(
  "bumps replace every moved package once without changing unrelated YAML",
  {
    nextVersion: version,
    oldVersion: version,
    quote: Arbitrary.schema(Schema.Literals(['"', "'"])),
    repeats: Arbitrary.schema(Schema.Literals([1, 2, 3])),
    salt: Arbitrary.schema(Schema.Int),
  },
  ({ nextVersion, oldVersion, quote, repeats, salt }) => {
    const newVersion = `${nextVersion}.next`;

    const unrelated = [
      `  - ${quote}unrelated@${oldVersion}${quote}`,
      `  - ${quote}@tsrs/unrelated@${salt}${quote}`,
      `  # keep ${salt}: tsrs@${oldVersion}`,
    ];

    const prefix = `packages:\n  - "packages/*"\n# keep ${salt}\nminimumReleaseAgeExclude:\n`;
    const suffix = `nextSetting:\n  - "tsrs@${oldVersion}"\n`;

    const input = `${prefix}${[
      ...movedNames.flatMap((name) => [
        ...Array.from(
          { length: repeats },
          () => `  - ${quote}${name}@${oldVersion}${quote}`
        ),
        `  - ${quote}${name}@${newVersion}${quote}`,
      ]),
      ...unrelated,
    ].join("\n")}\n${suffix}`;

    const changes = ["tsrs", "@yielded/effect-tsrs"].map((name) => ({
      name,
      newVersion,
      oldVersion,
    }));

    const output = checkerAgeExceptions(input, changes);
    const lines = output.slice(prefix.length, -suffix.length).split("\n");

    for (const name of movedNames) {
      expect(lines).not.toContain(`  - ${quote}${name}@${oldVersion}${quote}`);
      expect(
        lines.filter(
          (line) => line === `  - ${quote}${name}@${newVersion}${quote}`
        )
      ).toHaveLength(1);
    }

    expect(output.startsWith(prefix)).toBe(true);
    expect(output.endsWith(suffix)).toBe(true);
    expect(lines.filter((line) => unrelated.includes(line))).toEqual(unrelated);
    expect(checkerAgeExceptions(output, changes)).toBe(output);

    const missing = `${prefix}${unrelated.join("\n")}\n${suffix}`;
    const added = checkerAgeExceptions(missing, changes).split("\n");

    for (const name of movedNames) {
      expect(
        added.filter(
          (line) => line === `  - ${quote}${name}@${newVersion}${quote}`
        )
      ).toHaveLength(1);
    }
  }
);
