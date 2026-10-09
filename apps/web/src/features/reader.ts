import * as stylex from "@stylexjs/stylex";
import { Option } from "effect";
import type { Document, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/reader/message.js";
import type { ReaderMessage } from "../client/reader/message.js";
import {
  ClipboardAccess,
  copyStatusOf,
  CopyStatus,
} from "../client/reader/model.js";
import type { ReaderModel } from "../client/reader/model.js";
import { readerFooter, readerWorkshop } from "./reader-chrome.js";
import { readerCopyIcon } from "./reader-copy-icon.js";
import { renderReaderBlock } from "./reader-document.js";
import { renderReaderNode } from "./reader-node.js";
import { readerReferences } from "./reader-references.js";
import { readerStyles } from "./reader.stylex.js";
import {
  agentGuideRouter,
  glossaryRouter,
  homeRouter,
  loreRouter,
  promptsRouter,
  skillsRouter,
  systemsRouter,
} from "./site-route.js";

const copyStatusText = CopyStatus.match({
  Copied: () => "Copied ✓",
  Copying: () => "",
  Failed: () => "Copy failed. Select the text and copy it.",
  Idle: () => "",
});

const siteSections = [
  [skillsRouter(), "skills"],
  [loreRouter(), "lore"],
  [systemsRouter(), "systems"],
  [glossaryRouter(), "glossary"],
] as const;

const readerBreadcrumb = (path: string, h: HtmlBuilder<ReaderMessage>) => {
  if (path.startsWith("/prompts")) {
    return h.a([h.Href(promptsRouter())], ["prompts"]);
  }

  if (path.startsWith("/lore/")) {
    return h.a([h.Href(loreRouter())], ["lore"]);
  }

  return h.a([h.Href(homeRouter())], ["source files"]);
};

const footerLinksPrompts = (page: ReaderModel["page"]) =>
  page.status < 400 &&
  (page.path === "/" ||
    page.path === "/learn" ||
    /^\/(?:lore|prompts)(?:\/|$)/u.test(page.path));

export const readerCopyControl = (
  model: Pick<ReaderModel, "clipboardAccess" | "copyPrompts" | "copyStatuses">,
  h: HtmlBuilder<ReaderMessage>,
  id: string,
  primary: boolean
) => {
  const prompt = model.copyPrompts.find((entry) => entry.id === id);
  const status = copyStatusOf(model, id);
  const copied = CopyStatus.guards.Copied(status);

  if (prompt === undefined) {
    throw new Error(`Missing copy prompt: ${id}`);
  }

  return h.span(
    [h.Class("copy-actions")],
    [
      h.button(
        [
          h.Type("button"),
          h.Class(primary ? "copy copy-primary" : "copy"),
          h.DataAttribute("text", prompt.text),
          h.AriaLabel(prompt.label),
          h.Hidden(!ClipboardAccess.guards.Available(model.clipboardAccess)),
          h.OnClick(Message.ClickedCopy({ id })),
          h.DataAttribute("copied", String(copied)),
        ],
        [
          readerCopyIcon(h, copied),
          h.span([h.Class("copy-label")], [copied ? "Copied ✓" : prompt.label]),
        ]
      ),
      h.span(
        [h.Class("copy-status"), h.Role("status"), h.AriaLive("polite")],
        [copyStatusText(status)]
      ),
    ]
  );
};

const readerCopyPrompt = (
  model: ReaderModel,
  h: HtmlBuilder<ReaderMessage>,
  id: string
) => {
  const prompt = model.copyPrompts.find((entry) => entry.id === id);
  const control = readerCopyControl(model, h, id, false);

  return prompt?.showText === true
    ? h.div(
        [h.Class("prompt")],
        [
          control,
          h.details(
            [h.Class("prompt-text")],
            [
              h.summary([], ["See the prompt"]),
              h.pre([], [h.code([], [prompt.text])]),
            ]
          ),
        ]
      )
    : control;
};

export const view = (
  model: ReaderModel,
  h: HtmlBuilder<ReaderMessage>
): Document => {
  const copyControl = (id: string, primary: boolean) =>
    readerCopyControl(model, h, id, primary);

  return {
    body: h.div(
      [h.Class(stylex.props(readerStyles.shell).className ?? "")],
      [
        h.header(
          [
            h.Class(
              stylex.props(readerStyles.bounded, readerStyles.header)
                .className ?? ""
            ),
          ],
          [
            h.nav(
              [h.AriaLabel("Primary navigation"), h.Class("site-nav")],
              [
                h.a(
                  [h.Class("brand"), h.Href(homeRouter())],
                  [h.strong([], ["🐀 Rat Stack"])]
                ),
                h.div(
                  [h.Class("site-links")],
                  [
                    h.ul(
                      [],
                      siteSections.map(([href, name]) =>
                        h.li([], [h.a([h.Href(href)], [name])])
                      )
                    ),
                    h.ul(
                      [],
                      [
                        h.li(
                          [],
                          [h.a([h.Href(agentGuideRouter())], ["agent guide"])]
                        ),
                      ]
                    ),
                  ]
                ),
              ]
            ),
          ]
        ),
        h.main(
          [h.DataAttribute("path", model.page.path)],
          [
            h.p(
              [h.Class("agent-pointer visually-hidden"), h.AriaHidden(true)],
              [
                "For agents: start with the ",
                h.a(
                  [
                    h.Href(`${model.origin}${agentGuideRouter()}`),
                    h.Tabindex(-1),
                  ],
                  ["agent guide"]
                ),
                ". Every page is Markdown by default; add Accept: text/html for HTML.",
              ]
            ),
            ...Option.match(model.workshop, {
              onNone: () => [],
              onSome: (workshop) => [readerWorkshop(workshop, h)],
            }),
            ...(model.page.path === "/" ||
            model.page.path === "/lore" ||
            model.page.path === "/glossary" ||
            model.page.path === "/systems" ||
            model.page.path === "/skills" ||
            model.page.path === "/tokenmaxx"
              ? []
              : [
                  h.nav(
                    [h.AriaLabel("Breadcrumb"), h.Class("breadcrumb")],
                    [
                      Option.match(model.breadcrumb, {
                        onNone: () => readerBreadcrumb(model.page.path, h),
                        onSome: (breadcrumb) =>
                          h.a([h.Href(breadcrumb.href)], [breadcrumb.label]),
                      }),
                      ` / ${Option.match(model.breadcrumb, {
                        onNone: () => model.heading,
                        onSome: (breadcrumb) => breadcrumb.name,
                      })}`,
                    ]
                  ),
                ]),
            ...Option.match(model.bodyNodes, {
              onNone: () => [h.h1([], [model.heading])],
              onSome: (nodes) =>
                nodes.map((node) => renderReaderNode(node, h, copyControl)),
            }),
            ...model.blocks.map((block) =>
              renderReaderBlock(block, h, {
                anchors: Option.match(model.references, {
                  onNone: () => [],
                  onSome: (references) => references.anchors,
                }),
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
                copyPrompt: (id) => readerCopyPrompt(model, h, id),
                inboundCounts: Option.match(model.references, {
                  onNone: () => ({}),
                  onSome: (references) => references.inboundCounts,
                }),
                pagePath: model.page.path,
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
                    [h.AriaLabelledBy("sources"), h.Class("bibliography")],
                    [
                      h.h2([h.Id("sources")], ["Sources"]),
                      h.ol(
                        [],
                        model.bibliography.map((source, index) =>
                          h.li(
                            [h.Id(`source-${index + 1}`)],
                            source.kind === "linked"
                              ? [
                                  h.a([h.Href(source.url)], [source.title]),
                                  `. ${source.publisher}. ${source.note} Accessed ${source.accessed}.`,
                                ]
                              : [
                                  `${source.title}. Recorded ${source.recordedAt}. ${source.note}.`,
                                ]
                          )
                        )
                      ),
                    ]
                  ),
                ]),
            ...readerReferences(model, h),
          ]
        ),
        readerFooter(h, footerLinksPrompts(model.page)),
      ]
    ),
    canonical: `${model.origin}${model.page.metadata.canonicalPath}`,
    ogUrl: `${model.origin}${model.page.metadata.canonicalPath}`,
    title: model.page.metadata.title,
  };
};
