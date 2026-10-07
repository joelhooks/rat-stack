// oxlint-disable-next-line rat-stack-boundaries/no-browser-server-imports -- The signed catalogue entry point contains pure schemas and no server handlers.
import { pageCatalog } from "@rat-stack/core/page-catalog";
import { createRenderer } from "@rat-stack/json-render-foldkit";
import type {
  Components,
  Spec,
  StateModel,
} from "@rat-stack/json-render-foldkit";
import * as stylex from "@stylexjs/stylex";
import type { HtmlBuilder } from "foldkit/html";

import { styles } from "./chrome.stylex.js";
import { specStyles } from "./spec.stylex.js";

const className = (...recipes: readonly stylex.StyleXStyles[]) =>
  stylex.props(...recipes).className ?? "";

export const catalog = <Message>(): Components<
  typeof pageCatalog,
  Message
> => ({
  Callout: ({ h, props, children }) =>
    h.aside(
      [h.Class("workshop-callout")],
      [
        h.h2([h.Class("workshop-callout-label")], [props.title]),
        h.p([h.Class("workshop-callout-title")], [props.text]),
        ...children,
      ]
    ),
  Grid: ({ h, children }) =>
    h.div([h.Class(className(specStyles.grid))], [...children]),
  Page: ({ h, props, children }) =>
    h.div(
      [h.Class(className(specStyles.page))],
      [
        h.h1([h.Class(className(specStyles.title))], [props.title]),
        h.p([h.Class(className(specStyles.intro))], [props.intro]),
        ...children,
      ]
    ),
  SiteCard: ({ h, props, children }) =>
    h.article(
      [h.Class(className(specStyles.card))],
      [
        ...(props.image === undefined
          ? []
          : [h.img([h.Alt(props.image.alt), h.Src(props.image.src)])]),
        h.h2(
          [],
          [
            h.a(
              [
                h.Class(className(specStyles.link, styles.focus)),
                h.Href(props.url),
              ],
              [props.name]
            ),
          ]
        ),
        h.p([], [`By ${props.author}`]),
        h.p([], [props.description]),
        ...(props.stack.length === 0
          ? []
          : [
              h.p(
                [h.Class(className(specStyles.tags))],
                [props.stack.join(" · ")]
              ),
            ]),
        ...children,
      ]
    ),
});

export const renderSpec = <Message>(
  spec: Spec,
  model: StateModel,
  h: HtmlBuilder<Message>
) => createRenderer(pageCatalog, catalog<Message>())(spec, model, h);
