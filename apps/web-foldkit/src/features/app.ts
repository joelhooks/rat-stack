import { Option, Schema } from "effect";
import type { Runtime, Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { UrlRequest } from "foldkit/navigation";
import { toString as urlToString } from "foldkit/url";

import { LoadExternal, Navigate, ReadDoc, SearchDocs } from "../client/docs.js";
import { Message, ReadState, SearchState } from "../client/model.js";
import type { AppModel, AppMessage } from "../client/model.js";
import { AppRoute, parseRoute, readRouter } from "./route.js";
import type { AppRouteState } from "./route.js";

const enterRoute = (
  model: AppModel,
  route: AppRouteState
): Update.Return<AppModel, AppMessage> => {
  const generation = model.generation + 1;

  const next = {
    ...model,
    generation,
    read: ReadState.Idle(),
    route,
    search: Schema.is(SearchState.Loading)(model.search)
      ? SearchState.Idle()
      : model.search,
  };

  if (!Schema.is(AppRoute.Read)(route)) {
    return { model: next };
  }

  const id = Option.getOrElse(route.id, () => "");

  if (id.length === 0) {
    return {
      model: {
        ...next,
        read: ReadState.Failed({
          message: "No document was selected.",
          notFound: false,
        }),
      },
    };
  }

  return {
    commands: [ReadDoc({ generation, id })],
    model: { ...next, read: ReadState.Loading() },
  };
};

export const init: Runtime.RoutingApplicationInit<AppModel, AppMessage> = (
  url
) =>
  enterRoute(
    {
      generation: 0,
      query: "capability",
      read: ReadState.Idle(),
      route: AppRoute.Home(),
      search: SearchState.Idle(),
    },
    parseRoute(url)
  );

export const update = (
  model: AppModel,
  message: AppMessage
): Update.Return<AppModel, AppMessage> =>
  Message.match<Update.Return<AppModel, AppMessage>>(message, {
    ChangedUrl: ({ url }) => enterRoute(model, parseRoute(url)),
    ClickedLink: ({ request }) =>
      UrlRequest.match<Update.Return<AppModel, AppMessage>>(request, {
        External: ({ href }) => ({ commands: [LoadExternal({ href })], model }),
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

      const generation = model.generation + 1;

      return {
        commands: [SearchDocs({ generation, query })],
        model: { ...model, generation, query, search: SearchState.Loading() },
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
    Idle: () =>
      h.p([h.Class("status")], ["Search the docs to see matching resources."]),
    Loaded: ({ result }) =>
      h.div(
        [],
        [
          h.p(
            [],
            [`${result.total} ${result.total === 1 ? "result" : "results"}`]
          ),
          h.ul(
            [h.Class("result-list")],
            result.matches.map((match) =>
              h.li(
                [h.Class("result-card"), h.Key(match.id)],
                [
                  h.p(
                    [h.Class("result-meta")],
                    [`${match.kind} · ${match.routePath}`]
                  ),
                  h.h2(
                    [],
                    [
                      h.a(
                        [h.Href(readRouter({ id: Option.some(match.id) }))],
                        [match.title]
                      ),
                    ]
                  ),
                  h.p([], [match.description]),
                  h.p([], [match.excerpt]),
                ]
              )
            )
          ),
        ]
      ),
    Loading: () => h.p([h.Class("status")], ["Searching the docs…"]),
  });

const searchView = (model: AppModel, h: HtmlBuilder<AppMessage>): Html =>
  h.main(
    [h.Class("page")],
    [
      h.p([h.Class("eyebrow")], ["Reference docs"]),
      h.h1([], ["Find the rule or skill you need."]),
      h.p(
        [],
        [
          "Search rat-stack's law and skills. Open a result to read the exact source.",
        ]
      ),
      h.form(
        [h.Class("search-form"), h.OnSubmit(Message.SubmittedSearch())],
        [
          h.label(
            [h.For("docs-query"), h.Class("visually-hidden")],
            ["Search the docs"]
          ),
          h.input([
            h.Id("docs-query"),
            h.Name("query"),
            h.Value(model.query),
            h.Autocomplete("off"),
            h.Placeholder("Try ‘capability’ or ‘Effect’"),
            h.OnInput((value) => Message.UpdatedQuery({ value })),
          ]),
          h.button([h.Type("submit")], ["Search"]),
        ]
      ),
      h.section(
        [
          h.AriaLive("polite"),
          h.AriaBusy(Schema.is(SearchState.Loading)(model.search)),
        ],
        [searchResults(model, h)]
      ),
    ]
  );

const readView = (model: AppModel, h: HtmlBuilder<AppMessage>): Html =>
  h.main(
    [h.Class("page")],
    [
      h.a([h.Href("/")], ["← Back to search"]),
      ReadState.match<Html>(model.read, {
        Failed: ({ message, notFound }) =>
          h.div(
            [],
            [
              h.p(
                [h.Class("eyebrow")],
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
              h.p(
                [h.Class("eyebrow")],
                [`${document.kind} · ${document.routePath}`]
              ),
              h.h1([], [document.title]),
              h.p([], [document.description]),
              h.pre([h.Class("document-text")], [document.text]),
            ]
          ),
        Loading: () => h.p([h.Role("status")], ["Loading the document…"]),
      }),
    ]
  );

export const view = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): Document => ({
  body: AppRoute.match<Html>(model.route, {
    Home: () => searchView(model, h),
    NotFound: () =>
      h.main(
        [h.Class("page")],
        [h.h1([], ["Page not found"]), h.a([h.Href("/")], ["Back to search"])]
      ),
    Read: () => readView(model, h),
  }),
  title:
    Schema.is(ReadState.Loaded)(model.read) &&
    Schema.is(AppRoute.Read)(model.route)
      ? `${model.read.document.title} | rat-stack`
      : "rat-stack docs",
});
