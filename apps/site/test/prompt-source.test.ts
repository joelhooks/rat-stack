import { expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import { validatePromptSources } from "../scripts/prompt-source.ts";

const Frontmatter = Schema.Struct({
  body: Schema.String,
  credit: Schema.String,
  description: Schema.String,
  title: Schema.String,
});

it.effect.prop(
  "preserves valid generated prompt fields and rejects blank required fields",
  { fields: Frontmatter },
  ({ fields }) =>
    Effect.gen(function* validatesFields() {
      const rawText = `---\ntitle: ${JSON.stringify(fields.title)}\ndescription: ${JSON.stringify(fields.description)}\ncredit: ${JSON.stringify(fields.credit)}\n---\n${fields.body}`;

      const result = yield* Effect.result(
        validatePromptSources([
          { rawText, slug: "sample", sourcePath: "sample.svx" },
        ])
      );

      const valid = [fields.title, fields.description, fields.body].every(
        (value) => value.trim().length > 0
      );

      expect(Result.isSuccess(result)).toBe(valid);

      if (Result.isSuccess(result)) {
        expect(result.success).toEqual([
          {
            ...fields,
            body: fields.body.trim(),
            slug: "sample",
            sourcePath: "sample.svx",
          },
        ]);
      }
    }),
  { arbitrary: { runs: 100 } }
);

const MissingFields = Schema.Array(
  Schema.Struct({
    body: Schema.Boolean,
    description: Schema.Boolean,
    title: Schema.Boolean,
  })
).check(Schema.isMinLength(1), Schema.isMaxLength(8));

it.effect.prop(
  "accumulates every invalid source and every missing required field",
  { pages: MissingFields },
  ({ pages }) =>
    Effect.gen(function* accumulatesFailures() {
      const documents = pages.map((page, index) => ({
        rawText: `---\n${page.title ? "title: A title\n" : ""}${page.description ? "description: A description\n" : ""}---\n${page.body ? "A prompt body" : "  \n\t"}`,
        slug: `sample-${index}`,
        sourcePath: `sample-${index}.svx`,
      }));

      const result = yield* Effect.result(validatePromptSources(documents));

      const invalid = pages.flatMap((page, index) =>
        Object.values(page).every(Boolean)
          ? []
          : [
              {
                index,
                missing: Object.entries(page)
                  .filter(([, present]) => !present)
                  .map(([field]) => field),
              },
            ]
      );

      expect(Result.isFailure(result)).toBe(invalid.length > 0);

      if (Result.isFailure(result)) {
        expect(result.failure.issues).toHaveLength(invalid.length);

        for (const { index, missing } of invalid) {
          const issue = result.failure.issues.find(
            (candidate) => candidate.sourcePath === `sample-${index}.svx`
          );

          expect(issue).toBeDefined();

          for (const field of missing) {
            expect(issue?.message).toContain(field);
          }
        }
      }
    }),
  { arbitrary: { runs: 100 } }
);
