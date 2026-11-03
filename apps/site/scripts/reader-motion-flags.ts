import { Effect, Schema } from "effect";

import {
  initialModel,
  Model as MotionDemoModel,
} from "../../web/src/client/motion/model.ts";
import { ReaderInputError } from "./reader-input-error.ts";

export const motionDemoPath = "/systems/motion";

interface ReaderPageInput {
  readonly page: { readonly path: string };
}

export const attachMotionDemo = Effect.fn("attachMotionDemo")(
  function* attachMotionDemo<Page extends ReaderPageInput>(
    pages: readonly Page[]
  ) {
    if (!pages.some((page) => page.page.path === motionDemoPath)) {
      return yield* new ReaderInputError({
        message: `The systems pages have no ${motionDemoPath} page for the motion demo; restore .brain/areas/motion.svx and regenerate content`,
        sourcePath: ".brain/areas/motion.svx",
      });
    }

    const motion = yield* Schema.encodeEffect(MotionDemoModel)(initialModel);

    return pages.map((page) =>
      page.page.path === motionDemoPath ? { ...page, motion } : page
    );
  }
);
