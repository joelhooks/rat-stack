import { Schema } from "effect";

export const ContentAssetManifest = Schema.Struct({
  generation: Schema.String,
  images: Schema.Array(Schema.String),
  pages: Schema.Array(
    Schema.Struct({
      html: Schema.String,
      markdown: Schema.String,
      route: Schema.String,
    })
  ),
});
