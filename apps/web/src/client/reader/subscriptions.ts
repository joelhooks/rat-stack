import { Array, Option, Stream, pipe } from "effect";
import { Dom, Subscription } from "foldkit";

import * as MotionDemo from "../motion/index.js";
import { Message } from "./message.js";
import type { ReaderMessage } from "./message.js";
import type { ReaderModel } from "./model.js";
import { outlineRange, sameRange } from "./outline-range.js";
import type {
  OutlineRangeValue,
  OutlineSection,
  ScrollDirection,
} from "./outline-range.js";

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

const landmarkIds = new Set(["linked-from", "sources"]);

const bandTop = 0.2;

const bandBottom = 0.45;

interface OutlineTarget {
  readonly id: string;
  readonly level: 2 | 3;
  readonly target: HTMLElement;
}

const outlineTargets = (): readonly OutlineTarget[] =>
  Array.fromIterable(
    document.querySelectorAll<HTMLAnchorElement>(".page-outline a[href^='#']")
  ).flatMap((link) => {
    const id = decodeURIComponent(link.hash.slice(1));

    const target = document.querySelector<HTMLElement>(`#${CSS.escape(id)}`);

    return target === null
      ? []
      : [
          {
            id,
            level: link.closest(".outline-sub") === null ? 2 : 3,
            target,
          },
        ];
  });

const measureSections = (): readonly OutlineSection[] => {
  const targets = outlineTargets();

  const mainBottom =
    document.querySelector("main")?.getBoundingClientRect().bottom ?? 0;

  return targets.map(({ id, level, target }, index) => {
    const landmark = landmarkIds.has(id);

    const box = (
      landmark ? (target.closest("section") ?? target) : target
    ).getBoundingClientRect();

    const next = targets.at(index + 1);

    return {
      bottom: landmark
        ? box.bottom
        : (next?.target.getBoundingClientRect().top ?? mainBottom),
      id,
      landmark,
      parent:
        level === 3
          ? pipe(
              targets.slice(0, index),
              Array.findLast((entry) => entry.level === 2),
              Option.map((entry) => entry.id)
            )
          : Option.none(),
      top: box.top,
    };
  });
};

const toolbarBottom = () =>
  Math.max(
    0,
    document.querySelector(".toolbar")?.getBoundingClientRect().bottom ?? 0
  );

const directionOf = (from: number, to: number): ScrollDirection => {
  if (to > from) {
    return "down";
  }

  return to < from ? "up" : "still";
};

interface OutlineScroll {
  readonly range: Option.Option<OutlineRangeValue>;
  readonly scrollY: number;
}

const nextScroll = (previous: OutlineScroll): OutlineScroll => ({
  range: outlineRange(
    measureSections(),
    { bottom: window.innerHeight, top: toolbarBottom() },
    {
      bottom: window.innerHeight * bandBottom,
      top: window.innerHeight * bandTop,
    },
    previous.range,
    directionOf(previous.scrollY, window.scrollY)
  ),
  scrollY: window.scrollY,
});

const scroll = Subscription.make<ReaderModel, ReaderMessage>()(() => ({
  outlineInView: Subscription.persistentEntry(
    Stream.merge(
      Stream.concat(
        Stream.make("load"),
        Stream.fromEventListener(window, "scroll", { passive: true })
      ),
      Stream.fromEventListener(window, "resize", { passive: true })
    ).pipe(
      Stream.scan(
        (): OutlineScroll => ({ range: Option.none(), scrollY: 0 }),
        nextScroll
      ),
      Stream.map((state) => state.range),
      Stream.filter(Option.isSome),
      Stream.map((range) => range.value),
      Stream.changesWith(sameRange),
      Stream.map((range) => Message.ScrolledOutline({ range }))
    )
  ),
}));

export const subscriptions = { ...motion, ...keyboard, ...scroll };
