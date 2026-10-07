import * as stylex from "@stylexjs/stylex";
import type { Document, HtmlBuilder } from "foldkit/html";

import type { ReaderModel } from "../client/reader-model.js";
import { readerFooter, readerWorkshop } from "./reader-chrome.js";
import { renderReaderBlock } from "./reader-document.js";
import { readerStyles } from "./reader.stylex.js";
import { renderSpec } from "./render-spec.js";

export const readerView = <Message>(
  model: ReaderModel,
  h: HtmlBuilder<Message>
): Document => ({
  body: h.div(
    [h.Class(stylex.props(readerStyles.shell).className ?? "")],
    [
      h.header(
        [
          h.Class(
            stylex.props(readerStyles.bounded, readerStyles.header).className ??
              ""
          ),
        ],
        [
          h.nav(
            [h.AriaLabel("Primary navigation"), h.Class("site-nav")],
            [
              h.a(
                [h.Class("brand"), h.Href("/")],
                [h.strong([], ["🐀 Rat Stack"])]
              ),
              h.div(
                [h.Class("site-links")],
                [
                  h.ul(
                    [],
                    ["skills", "lore", "systems", "glossary", "featured"].map(
                      (name) => h.li([], [h.a([h.Href(`/${name}`)], [name])])
                    )
                  ),
                  h.ul(
                    [],
                    [h.li([], [h.a([h.Href("/llms.txt")], ["agent guide"])])]
                  ),
                ]
              ),
            ]
          ),
        ]
      ),
      h.main(
        [h.DataAttribute("path", model.page.path)],
        model.featured === undefined
          ? [
              readerWorkshop(model, h),
              ...(model.page.path === "/"
                ? []
                : [
                    h.nav(
                      [h.AriaLabel("Breadcrumb"), h.Class("breadcrumb")],
                      [h.a([h.Href("/lore")], ["lore"]), ` / ${model.heading}`]
                    ),
                  ]),
              h.h1([], [model.heading]),
              ...model.blocks.map((block) =>
                renderReaderBlock(block, h, {
                  codeFence: (value) => {
                    const resolved = model.codeFences.find(
                      (fence) => fence.value === value
                    );

                    if (resolved === undefined) {
                      throw new Error("Missing built home code fence");
                    }

                    return h.div([
                      h.Class("reader-snippet"),
                      h.InnerHTML(resolved.html),
                    ]);
                  },
                  copyPrompt: (id) => {
                    const prompt = model.copyPrompts.find(
                      (entry) => entry.id === id
                    );

                    if (prompt === undefined) {
                      throw new Error(`Missing copy prompt: ${id}`);
                    }

                    return h.span(
                      [h.Class("copy-actions")],
                      [
                        h.button(
                          [
                            h.Type("button"),
                            h.Class("copy"),
                            h.DataAttribute("text", prompt.text),
                            h.AriaLabel(prompt.label),
                            h.Hidden(true),
                          ],
                          [h.span([h.Class("copy-label")], [prompt.label])]
                        ),
                        h.span(
                          [
                            h.Class("copy-status"),
                            h.Role("status"),
                            h.AriaLive("polite"),
                          ],
                          []
                        ),
                      ]
                    );
                  },
                  snippet: (reference) => {
                    const resolved = model.snippets.find(
                      (snippet) =>
                        snippet.repo === reference.repo &&
                        snippet.path === reference.path &&
                        snippet.at === reference.at &&
                        snippet.lines === reference.lines
                    );

                    if (resolved === undefined) {
                      throw new Error(
                        `Missing built excerpt: ${reference.repo}:${reference.path}@${reference.at}:${reference.lines}`
                      );
                    }

                    return h.div([
                      h.Class("reader-snippet"),
                      h.InnerHTML(resolved.html),
                    ]);
                  },
                })
              ),
              ...(model.bibliography.length === 0
                ? []
                : [
                    h.section(
                      [h.AriaLabel("Sources"), h.Class("sources")],
                      [
                        h.h2([], ["Sources"]),
                        h.ol(
                          [],
                          model.bibliography.map((source, index) =>
                            h.li(
                              [h.Id(`source-${index + 1}`)],
                              [
                                h.a([h.Href(source.url)], [source.title]),
                                h.p([], [source.note]),
                                h.p(
                                  [],
                                  [
                                    `${source.publisher}. Accessed ${source.accessed}.`,
                                  ]
                                ),
                              ]
                            )
                          )
                        ),
                      ]
                    ),
                  ]),
            ]
          : [renderSpec(model.featured.spec, model.featured, h)]
      ),
      readerFooter(h),
    ]
  ),
  canonical: `${model.origin}${model.page.metadata.canonicalPath}`,
  ogUrl: `${model.origin}${model.page.metadata.canonicalPath}`,
  title: model.page.metadata.title,
});
