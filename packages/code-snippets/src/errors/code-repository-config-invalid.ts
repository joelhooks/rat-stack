import { Schema } from "effect";

export class CodeRepositoryConfigInvalid extends Schema.TaggedError<
  CodeRepositoryConfigInvalid,
  { readonly brand: unique symbol }
>()("CodeRepositoryConfigInvalid", {
  cause: Schema.optionalKey(Schema.Defect()),
  fix: Schema.String,
}) {
  override get message() {
    return `[CodeRepositoryConfigInvalid] ${this.fix}`;
  }
}
