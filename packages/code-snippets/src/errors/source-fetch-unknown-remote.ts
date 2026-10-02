import { Schema } from "effect";

export class SourceFetchUnknownRemote extends Schema.TaggedError<SourceFetchUnknownRemote>()(
  "SourceFetchUnknownRemote",
  {
    commit: Schema.String,
    fix: Schema.String,
    line: Schema.Finite,
    repo: Schema.String,
    sourcePath: Schema.String,
  }
) {
  override get message() {
    return `${this.sourcePath}:${this.line} [SourceFetchUnknownRemote] ${this.repo}@${this.commit}; ${this.fix}`;
  }
}
