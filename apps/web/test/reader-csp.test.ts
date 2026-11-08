import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  readerContentSecurityPolicy,
  readerPagePolicy,
  tubeContentSecurityPolicy,
  tubePagePath,
} from "../../site/src/security.js";

const directivesOf = (policy: string) =>
  new Map(
    policy.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/u);

      return [name, sources] as const;
    })
  );

const directives = directivesOf(readerContentSecurityPolicy);

const sourcesIn =
  (policy: ReadonlyMap<string, readonly string[]>) => (name: string) =>
    policy.get(name) ?? policy.get("default-src") ?? [];

const sourcesFor = sourcesIn(directives);

const sameOrigin = (url: string) =>
  url.startsWith("/") && !url.startsWith("//");

const dataSchemes = new Set(["application/json", "application/ld+json"]);

const allowsIn =
  (policy: ReadonlyMap<string, readonly string[]>) =>
  (name: string, url: string) => {
    const sources = sourcesIn(policy)(name);

    return (
      (sameOrigin(url) && sources.includes("'self'")) ||
      (url.startsWith("data:") && sources.includes("data:")) ||
      (url.startsWith("https://") && sources.includes(new URL(url).origin))
    );
  };

const allows = allowsIn(directives);

const routeOf = (client: string, file: string) => {
  const route = file.slice(client.length).replace(/\/?index\.html$/u, "");

  return route === "" ? "/" : route;
};

it("only /tube widens the reader policy, by YouTube's image host and the nocookie player", () => {
  expect(tubeContentSecurityPolicy).toBe(
    "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; frame-src https://www.youtube-nocookie.com"
  );

  expect(directivesOf(tubeContentSecurityPolicy)).toEqual(
    new Map([
      ...directives,
      [
        "img-src",
        [...(directives.get("img-src") ?? []), "https://i.ytimg.com"],
      ],
      ["frame-src", ["https://www.youtube-nocookie.com"]],
    ])
  );

  expect(readerPagePolicy(tubePagePath)).toBe(tubeContentSecurityPolicy);

  for (const path of [
    "/",
    "/tube/",
    "/tube.md",
    "/tubes",
    "/news",
    "/search",
  ]) {
    expect(readerPagePolicy(path), path).toBe(readerContentSecurityPolicy);
  }
});

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "the reader policy allows what built pages load and nothing they do not need",
    () =>
      Effect.gen(function* checkReaderPolicy() {
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;
        const client = paths.resolve(import.meta.dirname, "../dist/client");

        const files = (yield* fs.readDirectory(client, { recursive: true }))
          .filter((file) => file.endsWith(".html"))
          .map((file) => paths.join(client, file));

        const scripts = (yield* fs.readDirectory(
          paths.join(client, "assets")
        )).filter((file) => file.endsWith(".js"));

        expect(files.length).toBeGreaterThan(0);
        expect(scripts.length).toBeGreaterThan(0);

        const pages = yield* Effect.forEach((file: string) =>
          fs.readFileString(file).pipe(
            Effect.map((html) => ({
              document: new DOMParser().parseFromString(html, "text/html"),
              route: routeOf(client, file),
            }))
          )
        )(files);

        expect(pages.map(({ route }) => route)).toContain(tubePagePath);

        const inlineStyles = pages.some(
          ({ document }) => document.querySelector("style, [style]") !== null
        );

        for (const { document, route } of pages) {
          const pageAllows = allowsIn(directivesOf(readerPagePolicy(route)));

          if (route !== tubePagePath) {
            expect(readerPagePolicy(route), route).toBe(
              readerContentSecurityPolicy
            );
          }

          for (const script of document.querySelectorAll("script")) {
            const source = script.getAttribute("src");

            if (source === null) {
              expect(dataSchemes).toContain(script.getAttribute("type"));
            } else {
              expect(allows("script-src", source)).toBe(true);
            }
          }

          for (const link of document.querySelectorAll(
            'link[rel="stylesheet"]'
          )) {
            expect(allows("style-src", link.getAttribute("href") ?? "")).toBe(
              true
            );
          }

          for (const link of document.querySelectorAll('link[rel~="icon"]')) {
            expect(allows("img-src", link.getAttribute("href") ?? "")).toBe(
              true
            );
          }

          for (const image of document.querySelectorAll("img")) {
            expect(
              pageAllows("img-src", image.getAttribute("src") ?? ""),
              image.getAttribute("src") ?? ""
            ).toBe(true);
          }

          expect(
            document.querySelectorAll(
              "form, iframe, object, embed, base, video, audio"
            )
          ).toHaveLength(0);

          for (const element of document.querySelectorAll("*")) {
            expect(
              element
                .getAttributeNames()
                .filter((name) => name.startsWith("on"))
            ).toEqual([]);
          }
        }

        const bundles = yield* Effect.forEach((script: string) =>
          fs.readFileString(paths.join(client, "assets", script))
        )(scripts);

        for (const code of bundles) {
          expect(code).not.toMatch(/\beval\(|new Function\(/u);
        }

        const probesWithBase = bundles.some((code) =>
          /createElement\(\s*[`'"]base[`'"]\s*\)/u.test(code)
        );

        expect(sourcesFor("base-uri")).toEqual([
          probesWithBase ? "'self'" : "'none'",
        ]);

        expect(sourcesFor("script-src")).not.toContain("'unsafe-inline'");
        expect(sourcesFor("script-src")).not.toContain("'unsafe-eval'");
        expect(sourcesFor("style-src").includes("'unsafe-inline'")).toBe(
          inlineStyles
        );
        expect(sourcesFor("form-action")).toEqual(["'none'"]);
      }),
    { timeout: 60_000 }
  );
});
