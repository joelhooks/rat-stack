import { Schema } from "effect";

import { TubeVideo, YoutubeVideoId } from "./data.js";

export const Model = Schema.Struct({
  playing: Schema.OptionFromOptional(YoutubeVideoId),
  videos: Schema.Array(TubeVideo),
});

export type TubeModel = typeof Model.Type;
