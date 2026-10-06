import { pipe, Schema } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal } from "foldkit/route";

export const AppRoute = defineRouteUnion({
  Featured: {},
  Home: {},
  NotFound: { path: Schema.String },
  Read: { id: Schema.Option(Schema.String) },
});

export type AppRouteState = typeof AppRoute.Type;

export const homeRouter = pipe(Route.root, Route.mapTo(AppRoute.Home));

export const readRouter = pipe(
  literal("read"),
  Route.query(Schema.Struct({ id: Schema.OptionFromOptional(Schema.String) })),
  Route.mapTo(AppRoute.Read)
);

export const parseRoute = Route.parseUrlWithFallback(
  Route.oneOf(
    homeRouter,
    readRouter,
    pipe(literal("featured"), Route.mapTo(AppRoute.Featured))
  ),
  AppRoute.NotFound
);
