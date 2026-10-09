import { pipe } from "effect";
import { Route } from "foldkit";

export const SiteRoute = Route.defineRouteUnion({
  AgentGuide: {},
  ApiDocs: {},
  ChangeLog: {},
  Directory: {},
  Glossary: {},
  Home: {},
  Learn: {},
  Lore: {},
  News: {},
  NewsFeed: {},
  Peers: {},
  Prompts: {},
  Skills: {},
  Systems: {},
  Tokenmaxx: {},
});

export type SiteRouteState = typeof SiteRoute.Type;

export const homeRouter = pipe(Route.root, Route.mapTo(SiteRoute.Home));

export const learnRouter = pipe(
  Route.literal("learn"),
  Route.mapTo(SiteRoute.Learn)
);

export const glossaryRouter = pipe(
  Route.literal("glossary"),
  Route.mapTo(SiteRoute.Glossary)
);

export const loreRouter = pipe(
  Route.literal("lore"),
  Route.mapTo(SiteRoute.Lore)
);

export const promptsRouter = pipe(
  Route.literal("prompts"),
  Route.mapTo(SiteRoute.Prompts)
);

export const skillsRouter = pipe(
  Route.literal("skills"),
  Route.mapTo(SiteRoute.Skills)
);

export const systemsRouter = pipe(
  Route.literal("systems"),
  Route.mapTo(SiteRoute.Systems)
);

export const tokenmaxxRouter = pipe(
  Route.literal("tokenmaxx"),
  Route.mapTo(SiteRoute.Tokenmaxx)
);

export const changeLogRouter = pipe(
  Route.literal("log"),
  Route.mapTo(SiteRoute.ChangeLog)
);

export const peersRouter = pipe(
  Route.literal("resources"),
  Route.slash(Route.literal("peers")),
  Route.mapTo(SiteRoute.Peers)
);

export const agentGuideRouter = pipe(
  Route.literal("llms.txt"),
  Route.mapTo(SiteRoute.AgentGuide)
);

export const apiDocsRouter = pipe(
  Route.literal("openapi.json"),
  Route.mapTo(SiteRoute.ApiDocs)
);

export const isWithinSection = (section: string, path: string) =>
  path === section || path.startsWith(`${section}/`);

export const newsRouter = pipe(
  Route.literal("news"),
  Route.mapTo(SiteRoute.News)
);

export const newsFeedRouter = pipe(
  Route.literal("news.xml"),
  Route.mapTo(SiteRoute.NewsFeed)
);

export const directoryRouter = pipe(
  Route.literal("directory"),
  Route.mapTo(SiteRoute.Directory)
);
