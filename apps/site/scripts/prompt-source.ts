import { Prompt } from "@rat-stack/core/contracts";
import { Effect, Result, Schema } from "effect";

import { frontmatterData, scanLeadingFrontmatterFence } from "./svx-ast.ts";

export class PromptBuildError extends Schema.TaggedError<PromptBuildError>()(
  "PromptBuildError",
  {
    issues: Schema.Array(
      Schema.Struct({ message: Schema.String, sourcePath: Schema.String })
    ),
  }
) {}

export const validatePromptSources = Effect.fn("validatePromptSources")(
  function* validatePromptSources(
    documents: readonly {
      readonly slug: string;
      readonly sourcePath: string;
      readonly rawText: string;
    }[]
  ) {
    const results = documents.map((document) => {
      try {
        const fields = frontmatterData(document.rawText, document.sourcePath);

        const candidate = {
          ...fields,
          body: scanLeadingFrontmatterFence(
            document.rawText,
            document.sourcePath
          ).body.trim(),
          credit: fields.credit ?? "",
          slug: document.slug,
        };

        const validations = [
          {
            field: "body",
            result: Schema.decodeUnknownResult(Prompt.fields.body)(
              candidate.body
            ),
          },
          {
            field: "credit",
            result: Schema.decodeUnknownResult(Prompt.fields.credit)(
              candidate.credit
            ),
          },
          {
            field: "description",
            result: Schema.decodeUnknownResult(Prompt.fields.description)(
              fields.description
            ),
          },
          {
            field: "slug",
            result: Schema.decodeUnknownResult(Prompt.fields.slug)(
              candidate.slug
            ),
          },
          {
            field: "title",
            result: Schema.decodeUnknownResult(Prompt.fields.title)(
              fields.title
            ),
          },
        ];

        const failures = validations.flatMap(({ field, result }) =>
          Result.isFailure(result)
            ? [`${field}: ${String(result.failure)}`]
            : []
        );

        if (failures.length > 0) {
          return {
            message: failures.join("\n"),
            sourcePath: document.sourcePath,
          };
        }

        const parsed = Schema.decodeUnknownResult(Prompt)(candidate);

        return Result.isSuccess(parsed)
          ? { prompt: parsed.success, sourcePath: document.sourcePath }
          : {
              message: String(parsed.failure),
              sourcePath: document.sourcePath,
            };
      } catch (error) {
        return { message: String(error), sourcePath: document.sourcePath };
      }
    });

    const issues = results.flatMap((result) =>
      "message" in result
        ? [{ message: result.message, sourcePath: result.sourcePath }]
        : []
    );

    if (issues.length > 0) {
      return yield* new PromptBuildError({ issues });
    }

    return results.flatMap((result) =>
      "prompt" in result
        ? [{ ...result.prompt, sourcePath: result.sourcePath }]
        : []
    );
  }
);
