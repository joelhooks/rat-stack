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
import { routeOfPath } from "./peek.js";
import type { PeekAnchorValue } from "./peek.js";

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

const bandTop = 0.2;

const bandBottom = 0.45;

interface OutlineTarget {
  readonly id: string;
  readonly landmark: boolean;
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
            landmark: link.closest("[data-landmark]") !== null,
            level: link.closest(".outline-sub") === null ? 2 : 3,
            target,
          },
        ];
  });

const measureSections = (): readonly OutlineSection[] => {
  const targets = outlineTargets();

  const mainBottom =
    document.querySelector("main")?.getBoundingClientRect().bottom ?? 0;

  return targets.map(({ id, landmark, level, target }, index) => {
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

const peekWidth = 340;

const peekGutter = 16;

const peekRoom = 200;

const routeOf = (link: HTMLAnchorElement) => routeOfPath(link.pathname);

const hasFileExtension = (pathname: string) =>
  /\.[\da-z]+$/iu.test(pathname.split("/").at(-1) ?? "");

const peekLink = (target: EventTarget | null) => {
  const link =
    target instanceof Element
      ? target.closest<HTMLAnchorElement>("main a[href^='/']")
      : null;

  return link === null ||
    link.classList.contains("paragraph-link") ||
    link.classList.contains("reference-card") ||
    link.closest("sup") !== null ||
    hasFileExtension(link.pathname) ||
    routeOf(link) === routeOfPath(location.pathname)
    ? Option.none()
    : Option.some(link);
};

const inboundCount = (route: string) =>
  pipe(
    Array.fromIterable(
      document.querySelectorAll<HTMLAnchorElement>("main sup.inbound-count a")
    ),
    Array.findFirst((count) => routeOf(count) === route),
    Option.map((count) => Number(count.textContent)),
    Option.filter(Number.isInteger)
  );

const peekAnchor = (link: HTMLAnchorElement): PeekAnchorValue => {
  const box = link.getBoundingClientRect();

  const width = Math.min(
    peekWidth,
    document.documentElement.clientWidth - peekGutter * 2
  );

  const above = box.bottom + peekRoom > window.innerHeight;

  return {
    above,
    inbound: inboundCount(routeOf(link)),
    label: link.textContent.trim(),
    left:
      window.scrollX +
      Math.max(
        peekGutter,
        Math.min(
          box.left,
          document.documentElement.clientWidth - width - peekGutter
        )
      ),
    top: window.scrollY + (above ? box.top - 8 : box.bottom + 8),
  };
};

const linkEvents = (
  type: "focusin" | "focusout" | "pointerout" | "pointerover",
  toMessage: (
    link: HTMLAnchorElement,
    event: Event
  ) => Option.Option<ReaderMessage>
) =>
  Stream.fromEventListener<Event>(document, type, { passive: true }).pipe(
    Stream.map((event) =>
      Option.flatMap(peekLink(event.target), (link) => toMessage(link, event))
    ),
    Stream.filter(Option.isSome),
    Stream.map((message) => message.value)
  );

const relatedTarget = (event: Event) =>
  event instanceof MouseEvent || event instanceof FocusEvent
    ? event.relatedTarget
    : null;

const leftLink = (link: HTMLAnchorElement, event: Event) => {
  const related = relatedTarget(event);

  return related instanceof Node && link.contains(related)
    ? Option.none()
    : Option.some(Message.LeftLink());
};

const peek = Subscription.make<ReaderModel, ReaderMessage>()(() => ({
  peekLinks: Subscription.persistentEntry(
    Stream.mergeAll(
      [
        linkEvents("pointerover", (link, event) =>
          event instanceof PointerEvent && event.pointerType === "touch"
            ? Option.none()
            : Option.some(
                Message.PointedAtLink({
                  anchor: peekAnchor(link),
                  route: routeOf(link),
                })
              )
        ),
        linkEvents("pointerout", leftLink),
        linkEvents("focusin", (link) =>
          Option.some(
            Message.FocusedLink({
              anchor: peekAnchor(link),
              route: routeOf(link),
            })
          )
        ),
        linkEvents("focusout", leftLink),
      ],
      { concurrency: "unbounded" }
    )
  ),
}));

export const subscriptions = { ...motion, ...keyboard, ...peek, ...scroll };
