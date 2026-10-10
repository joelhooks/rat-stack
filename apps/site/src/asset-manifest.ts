import { Schema } from "effect";

export const ContentAssetManifest = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.String)),
  generation: Schema.String,
  images: Schema.Array(Schema.String),
  pages: Schema.Array(
    Schema.Struct({
      document: Schema.String,
      markdown: Schema.String,
      route: Schema.String,
    })
  ),
});
