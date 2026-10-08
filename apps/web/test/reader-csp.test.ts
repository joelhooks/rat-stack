import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { readerContentSecurityPolicy } from "../../mischief/src/security.js";

const directives = new Map(
  readerContentSecurityPolicy.split(";").map((directive) => {
    const [name = "", ...sources] = directive.trim().split(/\s+/u);

    return [name, sources] as const;
  })
);

const sourcesFor = (name: string) =>
  directives.get(name) ?? directives.get("default-src") ?? [];

const sameOrigin = (url: string) =>
  url.startsWith("/") && !url.startsWith("//");

const imagesProductionAlsoBlocks = new Set([
  "https://github.com/joelhooks/rat-stack/actions/workflows/ci.yml/badge.svg",
]);

const dataSchemes = new Set(["application/json", "application/ld+json"]);

const allows = (name: string, url: string) => {
  const sources = sourcesFor(name);

  return (
    (sameOrigin(url) && sources.includes("'self'")) ||
    (url.startsWith("data:") && sources.includes("data:"))
  );
};

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
          fs
            .readFileString(file)
            .pipe(
              Effect.map((html) =>
                new DOMParser().parseFromString(html, "text/html")
              )
            )
        )(files);

        const inlineStyles = pages.some(
          (document) => document.querySelector("style, [style]") !== null
        );

        for (const document of pages) {
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
            const source = image.getAttribute("src") ?? "";

            expect(
              allows("img-src", source) ||
                imagesProductionAlsoBlocks.has(source)
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
      })
  );
});
