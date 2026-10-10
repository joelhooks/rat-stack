import { Button } from "@foldkit/ui";
import * as stylex from "@stylexjs/stylex";
import { Array, Option } from "effect";
import type { Document, Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/reader/message.js";
import type { ReaderMessage } from "../client/reader/message.js";
import {
  ClipboardAccess,
  copyStatusOf,
  CopyStatus,
  findCopyPrompt,
} from "../client/reader/model.js";
import type { ReaderModel } from "../client/reader/model.js";
import * as CafeView from "./cafe/index.js";
import { readerFooter, readerWorkshop } from "./reader-chrome.js";
import { readerCopyIcon } from "./reader-copy-icon.js";
import { renderReaderBlock } from "./reader-document.js";
import type { SnippetReference } from "./reader-document.js";
import { renderReaderNode } from "./reader-node.js";
import { readerReferences } from "./reader-references.js";
import { readerStyles } from "./reader.stylex.js";
import {
  agentGuideRouter,
  glossaryRouter,
  homeRouter,
  isWithinSection,
  learnRouter,
  loreRouter,
  promptsRouter,
  skillsRouter,
  systemsRouter,
  tokenmaxxRouter,
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

const sectionIndexes: ReadonlySet<string> = new Set([
  homeRouter(),
  loreRouter(),
  glossaryRouter(),
  systemsRouter(),
  skillsRouter(),
  tokenmaxxRouter(),
]);

const missingReference = (h: HtmlBuilder<ReaderMessage>, description: string) =>
  h.p([h.Class("reader-missing"), h.Role("note")], [description]);

const readerBreadcrumb = (path: string, h: HtmlBuilder<ReaderMessage>) => {
  if (isWithinSection(promptsRouter(), path)) {
    return h.a([h.Href(promptsRouter())], ["prompts"]);
  }

  if (path.startsWith(`${loreRouter()}/`)) {
    return h.a([h.Href(loreRouter())], ["lore"]);
  }

  return h.a([h.Href(homeRouter())], ["source files"]);
};

const footerLinksPrompts = (page: ReaderModel["page"]) =>
  page.status < 400 &&
  (page.path === homeRouter() ||
    page.path === learnRouter() ||
    isWithinSection(loreRouter(), page.path) ||
    isWithinSection(promptsRouter(), page.path));

export const readerCopyControl = (
  model: Pick<ReaderModel, "clipboardAccess" | "copyPrompts" | "copyStatuses">,
  h: HtmlBuilder<ReaderMessage>,
  id: string,
  primary: boolean
) => {
  const status = copyStatusOf(model, id);
  const copied = CopyStatus.guards.Copied(status);

  return Option.match(findCopyPrompt(model, id), {
    onNone: () => missingReference(h, `The ${id} prompt is not in this page.`),
    onSome: (prompt) =>
      h.span(
        [h.Class("copy-actions")],
        [
          Button.view(
            {
              onClick: Message.ClickedCopy({ id }),
              toView: ({ button }) =>
                h.button(
                  [
                    ...button,
                    h.Class(primary ? "copy copy-primary" : "copy"),
                    h.DataAttribute("text", prompt.text),
                    h.AriaLabel(prompt.label),
                    h.Hidden(
                      !ClipboardAccess.guards.Available(model.clipboardAccess)
                    ),
                    h.DataAttribute("copied", String(copied)),
                  ],
                  [
                    readerCopyIcon(h, copied),
                    h.span(
                      [h.Class("copy-label")],
                      [copied ? "Copied ✓" : prompt.label]
                    ),
                  ]
                ),
            },
            h
          ),
          h.span(
            [h.Class("copy-status"), h.Role("status"), h.AriaLive("polite")],
            [copyStatusText(status)]
          ),
        ]
      ),
  });
};

const readerCopyPrompt = (
  model: ReaderModel,
  h: HtmlBuilder<ReaderMessage>,
  id: string
) => {
  const control = readerCopyControl(model, h, id, false);

  return Option.match(
    Option.filter(findCopyPrompt(model, id), (prompt) => prompt.showText),
    {
      onNone: () => control,
      onSome: (prompt) =>
        h.div(
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
        ),
    }
  );
};

const builtSnippet = (h: HtmlBuilder<ReaderMessage>, html: string) =>
  h.div([h.Class("reader-snippet"), h.InnerHTML(html)]);

const readerCodeFence = (
  model: ReaderModel,
  h: HtmlBuilder<ReaderMessage>,
  value: string
) =>
  Option.match(
    Array.findFirst(model.codeFences, (fence) => fence.value === value),
    {
      onNone: () =>
        missingReference(h, "This code block is not in the built page."),
      onSome: ({ html }) => builtSnippet(h, html),
    }
  );

const readerSnippet = (
  model: ReaderModel,
  h: HtmlBuilder<ReaderMessage>,
  reference: SnippetReference
) =>
  Option.match(
    Array.findFirst(
      model.snippets,
      (snippet) =>
        snippet.repo === reference.repo &&
        snippet.path === reference.path &&
        snippet.at === reference.at &&
        snippet.lines === reference.lines
    ),
    {
      onNone: () =>
        missingReference(
          h,
          `The excerpt ${reference.path} lines ${reference.lines} is not in the built page.`
        ),
      onSome: ({ html }) => builtSnippet(h, html),
    }
  );

const siteHeader = (h: HtmlBuilder<ReaderMessage>) =>
  h.header(
    [
      h.Class(
        stylex.props(readerStyles.bounded, readerStyles.header).className ?? ""
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
                [h.li([], [h.a([h.Href(agentGuideRouter())], ["agent guide"])])]
              ),
            ]
          ),
        ]
      ),
    ]
  );

const agentPointer = (model: ReaderModel, h: HtmlBuilder<ReaderMessage>) =>
  h.p(
    [h.Class("agent-pointer visually-hidden"), h.AriaHidden(true)],
    [
      "For agents: start with the ",
      h.a(
        [h.Href(`${model.origin}${agentGuideRouter()}`), h.Tabindex(-1)],
        ["agent guide"]
      ),
      ". Every page is Markdown by default; add Accept: text/html for HTML.",
    ]
  );

const breadcrumbView = (
  model: ReaderModel,
  h: HtmlBuilder<ReaderMessage>
): readonly Html[] =>
  sectionIndexes.has(model.page.path)
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
      ];

const bodyView = (model: ReaderModel, h: HtmlBuilder<ReaderMessage>) => [
  ...Option.match(model.bodyNodes, {
    onNone: () => [h.h1([], [model.heading])],
    onSome: (nodes) =>
      nodes.map((node) =>
        renderReaderNode(node, h, (id, primary) =>
          readerCopyControl(model, h, id, primary)
        )
      ),
  }),
  ...Option.match(model.cafe, {
    onNone: () => [],
    onSome: (cafe) => [
      h.submodel({
        model: cafe,
        slotId: "cafe",
        toParentMessage: (message) => Message.GotCafeMessage({ message }),
        view: CafeView.view,
      }),
    ],
  }),
  ...model.blocks.map((block) =>
    renderReaderBlock(block, h, {
      anchors: Option.match(model.references, {
        onNone: () => [],
        onSome: (references) => references.anchors,
      }),
      codeFence: (value) => readerCodeFence(model, h, value),
      copyPrompt: (id) => readerCopyPrompt(model, h, id),
      inboundCounts: Option.match(model.references, {
        onNone: () => ({}),
        onSome: (references) => references.inboundCounts,
      }),
      pagePath: model.page.path,
      snippet: (reference) => readerSnippet(model, h, reference),
    })
  ),
];

const bibliographyView = (
  model: ReaderModel,
  h: HtmlBuilder<ReaderMessage>
): readonly Html[] =>
  Array.match(model.bibliography, {
    onEmpty: () => [],
    onNonEmpty: (sources) => [
      h.section(
        [h.AriaLabelledBy("sources"), h.Class("bibliography")],
        [
          h.h2([h.Id("sources")], ["Sources"]),
          h.ol(
            [],
            sources.map((source, index) =>
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
    ],
  });

export const view = (
  model: ReaderModel,
  h: HtmlBuilder<ReaderMessage>
): Document => ({
  body: h.div(
    [h.Class(stylex.props(readerStyles.shell).className ?? "")],
    [
      siteHeader(h),
      h.main(
        [h.DataAttribute("path", model.page.path)],
        [
          agentPointer(model, h),
          ...Option.match(model.workshop, {
            onNone: () => [],
            onSome: (workshop) => [readerWorkshop(workshop, h)],
          }),
          ...breadcrumbView(model, h),
          ...bodyView(model, h),
          ...bibliographyView(model, h),
          ...readerReferences(model, h),
        ]
      ),
      readerFooter(h, footerLinksPrompts(model.page)),
    ]
  ),
  canonical: `${model.origin}${model.page.metadata.canonicalPath}`,
  ogUrl: `${model.origin}${model.page.metadata.canonicalPath}`,
  title: model.page.metadata.title,
});
