import { Schema } from "effect";

import { ContentRuleViolation } from "./content-rule-violation.ts";

export { ContentRuleViolation, violation } from "./content-rule-violation.ts";

const isContentRuleViolation = Schema.is(ContentRuleViolation);

export class ContentBuildError extends Schema.TaggedError<
  ContentBuildError,
  { readonly brand: unique symbol }
>()("ContentBuildError", {
  cause: Schema.Defect(),
  sourcePath: Schema.String,
  stage: Schema.String,
}) {
  override get message() {
    const location = `${this.stage} failed for ${this.sourcePath}`;

    return isContentRuleViolation(this.cause)
      ? `${location}: ${this.cause.message}`
      : location;
  }
}

export const buildError = (stage: string, sourcePath: string, cause: unknown) =>
  new ContentBuildError({ cause, sourcePath, stage });
