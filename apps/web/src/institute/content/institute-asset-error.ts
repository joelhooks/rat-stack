import { Schema } from "effect";

export class InstituteAssetError extends Schema.TaggedError<InstituteAssetError>()(
  "InstituteAssetError",
  {
    path: Schema.String,
    cause: Schema.Unknown,
  }
) {
  override get message() {
    return `Cannot read Institute asset ${this.path}: ${String(this.cause)}. Fix: verify the pinned Institute artifact and rebuild Website assets.`;
  }
}
