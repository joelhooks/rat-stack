import { Schema } from "effect";

export class ContentBuildError extends Schema.TaggedError<ContentBuildError>()(
  "ContentBuildError",
  { cause: Schema.Defect(), sourcePath: Schema.String, stage: Schema.String }
) {
  override get message() {
    return `${this.stage} failed for ${this.sourcePath}`;
  }
}

export const buildError = (stage: string, sourcePath: string, cause: unknown) =>
  new ContentBuildError({ cause, sourcePath, stage });
