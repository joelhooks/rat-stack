import { defineMessageUnion } from "foldkit/message";

import { YoutubeVideoId } from "./data.js";

export const Message = defineMessageUnion({
  ClickedPlay: { id: YoutubeVideoId },
});

export type TubeMessage = typeof Message.Type;
