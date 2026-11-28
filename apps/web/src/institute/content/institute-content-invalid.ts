import { Schema } from "effect";

export class InstituteContentInvalid extends Schema.TaggedError<InstituteContentInvalid>()(
  "InstituteContentInvalid",
  {
    path: Schema.String,
    reason: Schema.String,
  }
) {
  override get message() {
    return `Invalid Institute asset ${this.path}: ${this.reason}. Fix: rebuild the pinned Institute artifact with the published content compiler.`;
  }
}
