import { Option } from "effect";
import type { Update } from "foldkit";
import { modifyFields } from "foldkit/struct";

import { Message } from "./message.js";
import type { TubeMessage } from "./message.js";
import type { TubeModel } from "./model.js";

export const update = (
  model: TubeModel,
  message: TubeMessage
): Update.Return<TubeModel, TubeMessage> =>
  Message.match<Update.Return<TubeModel, TubeMessage>>(message, {
    ClickedPlay: ({ id }) => ({
      model: model.videos.some((video) => video.id === id)
        ? modifyFields(model, { playing: () => Option.some(id) })
        : model,
    }),
  });
