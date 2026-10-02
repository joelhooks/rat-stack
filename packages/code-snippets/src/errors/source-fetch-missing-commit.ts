import { Schema } from "effect";

export class SourceFetchMissingCommit extends Schema.TaggedError<SourceFetchMissingCommit>()(
  "SourceFetchMissingCommit",
  {
    commit: Schema.String,
    fix: Schema.String,
    line: Schema.Finite,
    repo: Schema.String,
    sourcePath: Schema.String,
  }
) {
  override get message() {
    return `${this.sourcePath}:${this.line} [SourceFetchMissingCommit] ${this.repo}@${this.commit}; ${this.fix}`;
  }
}
