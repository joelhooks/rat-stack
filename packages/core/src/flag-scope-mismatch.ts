import { Schema } from "effect";

export class FlagScopeMismatch extends Schema.TaggedError<FlagScopeMismatch>()(
  "FlagScopeMismatch",
  {
    name: Schema.String,
    repair: Schema.String,
    scope: Schema.Json,
  }
) {
  override get message(): string {
    return this.repair;
  }
}
