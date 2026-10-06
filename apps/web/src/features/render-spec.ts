// oxlint-disable-next-line rat-stack-boundaries/no-browser-server-imports -- The signed catalogue entry point contains pure schemas and no server handlers.
import { pageCatalog } from "@rat-stack/core/page-catalog";
import { createRenderer } from "@rat-stack/json-render-foldkit";
import type { Components } from "@rat-stack/json-render-foldkit";
import * as stylex from "@stylexjs/stylex";

import { Message } from "../client/model.js";
import type { AppMessage } from "../client/model.js";
import { styles } from "./chrome.stylex.js";
import { specStyles } from "./spec.stylex.js";

const className = (...recipes: readonly stylex.StyleXStyles[]) =>
  stylex.props(...recipes).className ?? "";

export const catalog: Components<typeof pageCatalog, AppMessage> = {
  Callout: ({ h, props, children }) =>
    h.aside(
      [h.Class(className(specStyles.callout))],
      [h.h2([], [props.title]), h.p([], [props.text]), ...children]
    ),
  Grid: ({ h, children }) =>
    h.div([h.Class(className(specStyles.grid))], [...children]),
  Page: ({ h, props, children, on }) => {
    const toggle = on("toggleNote");

    return h.main(
      [h.Class(className(specStyles.page))],
      [
        h.p([], ["FEATURED SITES"]),
        h.h1([h.Class(className(specStyles.title))], [props.title]),
        h.p([h.Class(className(specStyles.intro))], [props.intro]),
        ...(toggle === undefined
          ? []
          : [
              h.button(
                [
                  h.Type("button"),
                  h.Class(className(styles.focus)),
                  h.OnClick(toggle),
                ],
                ["Toggle note"]
              ),
            ]),
        ...children,
      ]
    );
  },
  SiteCard: ({ h, props, children }) =>
    h.article(
      [h.Class(className(specStyles.card))],
      [
        h.div(
          [h.Class(className(specStyles.preview)), h.AriaHidden(true)],
          [props.name]
        ),
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
};

export const renderSpec = createRenderer(pageCatalog, catalog, (actions) =>
  Message.ToggledFeaturedNote({
    count: actions.filter((action) => action.action === "toggleNote").length,
  })
);
