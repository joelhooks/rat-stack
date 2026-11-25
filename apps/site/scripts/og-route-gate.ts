import {
  hasOgPngDimensions,
  ogImagePath,
  ogMetadataProblems,
} from "@rat-stack/og/coverage";
import { Effect } from "effect";
import { DomUtils, parseDocument } from "htmlparser2";

import { violation } from "./content-rule-violation.ts";

const exclusions = new Map([
  ["/auth.md", "Raw authentication guide, not an HTML document"],
  ["/llms.txt", "Plain-text agent guide"],
  ["/llms-full.txt", "Plain-text full agent guide"],
  ["/openapi.json", "OpenAPI machine specification"],
  ["/robots.txt", "Crawler policy"],
  ["/sitemap.xml", "Crawler sitemap"],
  ["/.well-known/agent-card.json", "A2A agent card"],
  ["/.well-known/agent.json", "A2A discovery alias"],
  ["/.well-known/agent-skills/index.json", "Agent skills discovery index"],
  ["/.well-known/ai-catalog.json", "Machine capability catalog"],
  ["/.well-known/api-catalog", "Machine API catalog"],
  ["/.well-known/mcp.json", "MCP discovery document"],
]);

const exclusionReason = (route: string) =>
  exclusions.get(route) ??
  (/^\/\.well-known\/agent-skills\/[^/]+\/SKILL\.md$/u.test(route)
    ? "Raw agent skill source, not an HTML document"
    : undefined);

interface OgRouteArtifacts<E, R> {
  readonly routes: readonly string[];
  readonly surface: string;
  readonly origin: string;
  readonly html: (route: string) => Effect.Effect<string | null, E, R>;
  readonly png: (path: string) => Effect.Effect<Uint8Array | null, E, R>;
  readonly metadataFile: string;
}

const failCoverage = (...problem: Parameters<typeof violation>) => {
  const error = violation(...problem);

  return Effect.logError(error.message).pipe(Effect.andThen(error));
};

export const validateOgRoutes = <E, R>(input: OgRouteArtifacts<E, R>) =>
  Effect.gen(function* validateCoverage() {
    const routes = [...new Set(input.routes)];

    const required = routes.filter(
      (route) => exclusionReason(route) === undefined
    );

    const imageFix =
      "add or repair the route card in `apps/site/scripts/generate-content.ts` and regenerate content.";

    const images = yield* Effect.forEach((route: string) =>
      Effect.gen(function* validateRoute() {
        const path = ogImagePath(route);
        const bytes = yield* input.png(path);

        if (bytes === null || !hasOgPngDimensions(bytes)) {
          return yield* failCoverage(
            `OG card for ${route} is missing or invalid at ${path}.`,
            "Every exported or prerendered HTML route needs its own 1200×630 PNG for link previews.",
            imageFix
          );
        }

        const html = yield* input.html(route);

        const head = DomUtils.getElementsByTagName(
          "head",
          parseDocument(html ?? "").children
        ).at(0);

        const tags =
          head === undefined
            ? []
            : DomUtils.getElementsByTagName("meta", head.children);

        const problems = ogMetadataProblems(
          route,
          input.origin,
          (attribute, key) =>
            tags.flatMap(({ attribs }) =>
              attribs[attribute] === key ? [attribs.content ?? ""] : []
            )
        );

        if (problems.length > 0) {
          return yield* failCoverage(
            `OG metadata for ${route} is invalid: ${problems.join(", ")}.`,
            "Link previews need a versioned image URL and matching social metadata in the HTML head.",
            `repair the route metadata in \`${input.metadataFile}\`.`
          );
        }

        return path;
      })
    )(required);

    yield* Effect.log(
      `${input.surface} OG coverage: ${routes.length} routes; ${required.length} with cards; ${routes.length - required.length} excluded.`
    );

    return images;
  });
