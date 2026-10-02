import { Schema } from "effect";

export class AssetReadError extends Schema.TaggedError<AssetReadError>()(
  "AssetReadError",
  {
    cause: Schema.Defect(),
    path: Schema.String,
    reason: Schema.Literals([
      "binding",
      "response",
      "provider",
      "empty",
      "decode",
      "generation",
    ]),
  },
  { httpApiStatus: 503 }
) {}
