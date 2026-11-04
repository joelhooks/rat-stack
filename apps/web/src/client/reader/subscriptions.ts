import { Array, Effect, Option, Stream, pipe } from "effect";
import { Dom, Subscription } from "foldkit";

import * as MotionDemo from "../motion/index.js";
import { Message } from "./message.js";
import type { ReaderMessage } from "./message.js";
import type { ReaderModel } from "./model.js";

const motion = Subscription.lift(MotionDemo.subscriptions)<
  ReaderModel,
  ReaderMessage
>({
  read: (model) => model.motion,
  toParentMessage: (message) => Message.GotMotionMessage({ message }),
});

const keyboard = Subscription.make<ReaderModel, ReaderMessage>()(() => ({
  escape: Subscription.persistentEntry(
    Dom.streamFromKeyBindings<ReaderMessage>({
      bindings: [
        {
          keys: "Escape",
          mapEvent: () => Message.PressedEscape(),
          whileTyping: "Allow",
        },
      ],
    })
  ),
}));

const headingSelector = "main h2[id], main h3[id]";

const readingLine = 120;

const currentHeadingId = (): Option.Option<string> => {
  const headings = Array.fromIterable(
    document.querySelectorAll<HTMLElement>(headingSelector)
  );

  return pipe(
    headings,
    Array.findLast(
      (heading) => heading.getBoundingClientRect().top < readingLine
    ),
    Option.orElse(() => Array.head(headings)),
    Option.map((heading) => heading.id)
  );
};

const scroll = Subscription.make<ReaderModel, ReaderMessage>()(() => ({
  headingInView: Subscription.persistentEntry(
    Stream.concat(
      Stream.fromEffect(Effect.sync(currentHeadingId)),
      Stream.fromEventListener(window, "scroll", { passive: true }).pipe(
        Stream.map(() => currentHeadingId())
      )
    ).pipe(
      Stream.filter(Option.isSome),
      Stream.map((id) => id.value),
      Stream.changes,
      Stream.map((id) => Message.ScrolledToHeading({ id }))
    )
  ),
}));

export const subscriptions = { ...motion, ...keyboard, ...scroll };
