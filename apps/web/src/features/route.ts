import { pipe, Schema } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal } from "foldkit/route";

export const AppRoute = defineRouteUnion({
  NotFound: { path: Schema.String },
  Read: { id: Schema.String },
  Search: { q: Schema.OptionFromNullOr(Schema.String) },
});

export type AppRouteState = typeof AppRoute.Type;

export const docsReadRouter = pipe(
  literal("search"),
  Route.query(Schema.Struct({ id: Schema.String })),
  Route.mapTo(AppRoute.Read)
);

export const docsSearchRouter = pipe(
  literal("search"),
  Route.query(Schema.Struct({ q: Schema.OptionFromOptional(Schema.String) })),
  Route.mapTo(AppRoute.Search)
);

export const parseRoute = Route.parseUrlWithFallback(
  Route.oneOf(docsReadRouter, docsSearchRouter),
  AppRoute.NotFound
);
