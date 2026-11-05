import { Array, Option, Record } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Peek, PeekCard } from "../client/reader/peek.js";
import type { PeekAnchorValue } from "../client/reader/peek.js";
import { readerPeekId } from "./reader-node.js";

const sectionOf = (route: string) => {
  const section = route.split("/").at(1) ?? "";

  return section === "" ? "page" : section;
};

const inboundText = (count: number) =>
  `← ${count} ${count === 1 ? "page links" : "pages link"} here`;

const card = <Message>(
  h: HtmlBuilder<Message>,
  route: string,
  anchor: PeekAnchorValue,
  title: string,
  summary: string
) =>
  h.div(
    [
      h.Id(readerPeekId),
      h.Class(anchor.above ? "peek peek-above" : "peek"),
      h.Role("tooltip"),
      h.Style({ left: `${anchor.left}px`, top: `${anchor.top}px` }),
    ],
    Array.intersperse(
      [
        h.span([h.Class("peek-kicker")], [`${sectionOf(route)} · ${route}`]),
        h.strong([h.Class("peek-title")], [title]),
        ...(summary === ""
          ? []
          : [h.span([h.Class("peek-summary")], [summary])]),
        ...Option.match(anchor.inbound, {
          onNone: () => [],
          onSome: (count) => [
            h.span([h.Class("peek-inbound")], [inboundText(count)]),
          ],
        }),
      ],
      " "
    )
  );

export const readerPeekView = <Message>(
  h: HtmlBuilder<Message>,
  peek: typeof Peek.Type,
  cards: Readonly<Record<string, typeof PeekCard.Type>>
): readonly Html[] =>
  Peek.match({
    Hidden: (): readonly Html[] => [],
    Open: ({ anchor, route }): readonly Html[] =>
      Option.match(Record.get(cards, route), {
        onNone: () => [],
        onSome: PeekCard.match({
          Loaded: ({ summary, title }) => [
            card(h, route, anchor, title, summary),
          ],
          Loading: () => [],
        }),
      }),
    Waiting: (): readonly Html[] => [],
  })(peek);

export const describedRoute = (model: {
  readonly peek: typeof Peek.Type;
  readonly peekCards: Readonly<Record<string, typeof PeekCard.Type>>;
}): Option.Option<string> =>
  Peek.guards.Open(model.peek) &&
  Option.exists(Record.get(model.peekCards, model.peek.route), (cached) =>
    PeekCard.guards.Loaded(cached)
  )
    ? Option.some(model.peek.route)
    : Option.none();
