import { Schema } from "effect";

export const readerErrorPath = "/__error";

const ReaderText = Schema.String.check(
  Schema.makeFilter(
    (value: string) =>
      !value.includes("\u0000") && !/[\uD800-\uDFFF]/u.test(value),
    {
      description:
        "HTML-representable text: no NUL and no unpaired surrogate code unit",
    }
  )
);

export const ReaderErrorMatch = Schema.Struct({
  description: ReaderText,
  routePath: ReaderText.check(
    Schema.isPattern(/^\/(?![/\\])/u, {
      description: "A path on this site, never another origin or scheme",
    })
  ),
  title: ReaderText,
});

export const NoVerifyDetails = Schema.TaggedStruct("NoVerify", {});

export const IncidentDetails = Schema.TaggedStruct("Incident", {
  id: Schema.String.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
    )
  ),
});

export const ReaderErrorDetails = Schema.Union([
  NoVerifyDetails,
  IncidentDetails,
]);

export const ReaderErrorPage = Schema.Struct({
  code: Schema.Int.check(Schema.isBetween({ maximum: 599, minimum: 400 })),
  details: Schema.optional(ReaderErrorDetails),
  matches: Schema.optional(
    Schema.Array(ReaderErrorMatch).check(Schema.isMaxLength(3))
  ),
  message: ReaderText,
  path: ReaderText,
  title: ReaderText,
});
