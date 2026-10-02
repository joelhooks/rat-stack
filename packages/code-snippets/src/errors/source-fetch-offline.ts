import { Schema } from "effect";

export class SourceFetchOffline extends Schema.TaggedError<SourceFetchOffline>()(
  "SourceFetchOffline",
  {
    commit: Schema.String,
    fix: Schema.String,
    line: Schema.Finite,
    repo: Schema.String,
    sourcePath: Schema.String,
  }
) {
  override get message() {
    return `${this.sourcePath}:${this.line} [SourceFetchOffline] ${this.repo}@${this.commit}; ${this.fix}`;
  }
}
