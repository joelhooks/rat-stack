import { Button, Input } from "@foldkit/ui";
import * as stylex from "@stylexjs/stylex";
import { Option, Schema } from "effect";
import { Submodel } from "foldkit";
import type { Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { UrlRequest } from "foldkit/navigation";
import { toString as urlToString } from "foldkit/url";
import type { Url } from "foldkit/url";

import {
  LoadExternal,
  Navigate,
  ReadDoc,
  ReadLocation,
  ReplaceUrl,
  SearchDocs,
} from "../client/docs/command.js";
import { Message } from "../client/docs/message.js";
import type { AppMessage } from "../client/docs/message.js";
import { initialModel, ReadState, SearchState } from "../client/docs/model.js";
import type { AppModel } from "../client/docs/model.js";
import type { DocumentQueries } from "../client/docs/queries.js";
import { resultCount, searchCopy } from "./docs-copy.js";
import { docsStyles } from "./docs.stylex.js";
import { AppRoute, docsSearchRouter, parseRoute } from "./route.js";
import type { AppRouteState } from "./route.js";
import { agentGuideRouter } from "./site-route.js";

type DocsReturn = Update.Return<AppModel, AppMessage, DocumentQueries>;

const className = (style: stylex.StyleXStyles) =>
  stylex.props(style).className ?? "";

const searchFor = (model: AppModel, query: string): DocsReturn => {
  const generation = model.generation + 1;

  return {
    commands: [SearchDocs({ generation, query })],
    model: { ...model, generation, query, search: SearchState.Loading() },
  };
};

const enterRoute = (model: AppModel, route: AppRouteState): DocsReturn => {
  const next = {
    ...model,
    generation: model.generation + 1,
    read: ReadState.Idle(),
    route,
    search: Schema.is(SearchState.Loading)(model.search)
      ? SearchState.Idle()
      : model.search,
  };

  return AppRoute.match<DocsReturn>(route, {
    NotFound: () => ({ model: next }),
    Read: ({ id }) =>
      id.trim().length === 0
        ? {
            model: {
              ...next,
              read: ReadState.Failed({
                message: "No document was selected.",
                notFound: false,
              }),
            },
          }
        : {
            commands: [ReadDoc({ generation: next.generation, id })],
            model: { ...next, read: ReadState.Loading() },
          },
    Search: ({ q }) => {
      const query = Option.getOrElse(q, () => "").trim();

      return query.length === 0
        ? { model: next }
        : searchFor({ ...next, generation: model.generation }, query);
    },
  });
};

export const init = (url: Url): DocsReturn =>
  enterRoute(initialModel, parseRoute(url));

export const boot: DocsReturn = {
  commands: [ReadLocation()],
  model: initialModel,
};

export const update = (model: AppModel, message: AppMessage): DocsReturn =>
  Message.match<DocsReturn>(message, {
    ChangedUrl: ({ url }) => enterRoute(model, parseRoute(url)),
    ClickedLink: ({ request }) =>
      UrlRequest.match<DocsReturn>(request, {
        External: ({ href }) => ({
          commands: [LoadExternal({ href })],
          model,
        }),
        Internal: ({ url }) => ({
          commands: [Navigate({ url: urlToString(url) })],
          model,
        }),
      }),
    CompletedLoadExternal: () => ({ model }),
    CompletedNavigate: () => ({ model }),
    FailedRead: ({ generation, message: error, notFound }) => ({
      model:
        generation === model.generation
          ? { ...model, read: ReadState.Failed({ message: error, notFound }) }
          : model,
    }),
    FailedSearch: ({ generation }) => ({
      model:
        generation === model.generation
          ? { ...model, search: SearchState.Failed() }
          : model,
    }),
    SubmittedSearch: () => {
      const query = model.query.trim();

      if (query.length === 0) {
        return { model };
      }

      const searched = searchFor(model, query);

      return {
        commands: [
          ...(searched.commands ?? []),
          ReplaceUrl({ url: docsSearchRouter({ q: Option.some(query) }) }),
        ],
        model: searched.model,
      };
    },
    SucceededRead: ({ generation, document }) => ({
      model:
        generation === model.generation
          ? { ...model, read: ReadState.Loaded({ document }) }
          : model,
    }),
    SucceededSearch: ({ generation, result }) => ({
      model:
        generation === model.generation
          ? { ...model, search: SearchState.Loaded({ result }) }
          : model,
    }),
    UpdatedQuery: ({ value }) => ({ model: { ...model, query: value } }),
  });

const searchResults = (model: AppModel, h: HtmlBuilder<AppMessage>): Html =>
  SearchState.match<Html>(model.search, {
    Failed: () =>
      h.p([h.Role("alert")], ["Search failed. Try again in a moment."]),
    Idle: () => h.p([], ["Matches appear here."]),
    Loaded: ({ result }) =>
      h.div(
        [],
        [
          h.p([], [resultCount(result.total)]),
          h.ul(
            [h.Class(className(docsStyles.results))],
            result.matches.map((match) =>
              h.li(
                [h.Key(match.id), h.Class(className(docsStyles.match))],
                [
                  h.h2([], [h.a([h.Href(match.routePath)], [match.title])]),
                  h.p(
                    [h.Class(className(docsStyles.meta))],
                    [`${match.kind} · ${match.routePath}`]
                  ),
                  h.p([], [match.description]),
                  h.p([], [match.excerpt]),
                ]
              )
            )
          ),
        ]
      ),
    Loading: () => h.p([], ["Searching the docs…"]),
  });

const searchView = (model: AppModel, h: HtmlBuilder<AppMessage>): Html =>
  h.section(
    [h.AriaLabel(searchCopy.heading)],
    [
      h.p(
        [],
        [
          `${searchCopy.intro} `,
          h.a([h.Href(agentGuideRouter())], ["The agent guide"]),
          ` ${searchCopy.agents}`,
        ]
      ),
      h.noscript([], [searchCopy.noscript]),
      h.div(
        [h.Class(className(docsStyles.form)), h.Role("search")],
        [
          h.label(
            [h.For("docs-query"), h.Class("visually-hidden")],
            [searchCopy.heading]
          ),
          Input.view(
            {
              id: "docs-query",
              name: "q",
              onInput: (value) => Message.UpdatedQuery({ value }),
              placeholder: "Try ‘capability’ or ‘Effect’",
              toView: ({ input }) =>
                h.input([
                  ...input,
                  h.Class(className(docsStyles.input)),
                  h.Autocomplete("off"),
                  h.OnKeyDownPreventDefault((key) =>
                    key === "Enter"
                      ? Option.some(Message.SubmittedSearch())
                      : Option.none()
                  ),
                ]),
              type: "text",
              value: model.query,
            },
            h
          ),
          Button.view(
            {
              onClick: Message.SubmittedSearch(),
              toView: ({ button }) => h.button(button, ["Search"]),
              type: "button",
            },
            h
          ),
        ]
      ),
      h.section(
        [
          h.AriaLabel("Matches"),
          h.AriaLive("polite"),
          h.AriaBusy(Schema.is(SearchState.Loading)(model.search)),
        ],
        [searchResults(model, h)]
      ),
    ]
  );

const backToSearch = (h: HtmlBuilder<AppMessage>, label: string) =>
  h.p([], [h.a([h.Href(docsSearchRouter({ q: Option.none() }))], [label])]);

const readView = (model: AppModel, h: HtmlBuilder<AppMessage>): Html =>
  h.section(
    [h.AriaLabel("Document")],
    [
      backToSearch(h, "← Back to search"),
      ReadState.match<Html>(model.read, {
        Failed: ({ message, notFound }) =>
          h.div(
            [],
            [
              h.h2(
                [],
                [notFound ? "Document not found" : "Document unavailable"]
              ),
              h.p([h.Role("alert")], [message]),
            ]
          ),
        Idle: () => h.p([], ["Loading the document…"]),
        Loaded: ({ document }) =>
          h.article(
            [],
            [
              h.h2([], [document.title]),
              h.p(
                [h.Class(className(docsStyles.meta))],
                [`${document.kind} · ${document.routePath}`]
              ),
              h.p([], [document.description]),
              h.p(
                [],
                [h.a([h.Href(document.routePath)], ["Open the full page"])]
              ),
              h.pre(
                [h.Class(className(docsStyles.documentText))],
                [document.text]
              ),
            ]
          ),
        Loading: () => h.p([h.Role("status")], ["Loading the document…"]),
      }),
    ]
  );

export const view = Submodel.defineView<AppModel, AppMessage>((model, h) =>
  AppRoute.match<Html>(model.route, {
    NotFound: () =>
      h.section(
        [h.AriaLabel("Page not found")],
        [h.h2([], ["Page not found"]), backToSearch(h, "Back to search")]
      ),
    Read: () => readView(model, h),
    Search: () => searchView(model, h),
  })
);
