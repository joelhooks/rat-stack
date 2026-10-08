import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { HttpRouter } from "effect/http";

import { ContentAssetManifest, emitAssets } from "../scripts/emit-assets.ts";
import { mischiefRoutes } from "../src/app.js";
import { contentResources, ogImagePath } from "./content-fixture.js";
import {
  cartridgesImageJpegBase64,
  dillonPosterJpegBase64,
  faviconIcoBase64,
  appleTouchIconPngBase64,
  ratSvg,
  ogImages,
  originToken,
  tokenmaxxImageJpegBase64,
} from "./generated-content.js";
import { TestSandbox } from "./test-sandbox.js";

const manifestAt = (directory: string) =>
  Effect.gen(function* readAssetManifest() {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(`${directory}/manifest.json`);

    return yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(ContentAssetManifest)
    )(text);
  });

it.effect(
  "emits every page and image and serves the Markdown and image bytes unchanged",
  () =>
    Effect.gen(function* emittedContentParity() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.resolve(import.meta.dirname, "../dist/content");
      const manifest = yield* manifestAt(directory);
      expect(manifest.pages.map((page) => page.route).toSorted()).toEqual(
        [
          "/",
          "/lore",
          "/prompts",
          "/systems",
          "/skills",
          "/glossary",
          ...contentResources.map((page) => page.routePath),
        ].toSorted()
      );
      expect(manifest.pages.every((page) => !page.route.endsWith(".svx"))).toBe(
        true
      );
      expect(manifest.pages.some((page) => page.route === "/tokenmaxx")).toBe(
        false
      );

      yield* Effect.acquireUseRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            mischiefRoutes().pipe(Layer.provide(TestSandbox)),
            { disableLogger: true }
          )
        ),
        ({ handler }) =>
          Effect.gen(function* compareServedAssets() {
            const svxLink = /(?:href="|\]\()\/[^"\s)]*\.svx(?:[?#"\s)]|$)/u;

            for (const page of manifest.pages) {
              const html = yield* fs.readFileString(
                `${directory}/assets/${manifest.generation}${page.html}`
              );

              const expected = yield* fs.readFileString(
                `${directory}/assets/${manifest.generation}${page.markdown}`
              );

              const response = yield* Effect.promise(
                handler.bind(
                  undefined,
                  new Request(`https://ratstack.sh${page.route}`, {
                    headers: { accept: "text/markdown" },
                  }),
                  undefined
                )
              );

              const body = yield* Effect.promise(response.text.bind(response));

              expect(html).not.toMatch(svxLink);
              expect(body).not.toMatch(svxLink);
              expect(response.status).toBe(200);
              expect(body).toBe(
                expected.replaceAll(originToken, "https://ratstack.sh")
              );
            }

            for (const page of manifest.pages.filter((entry) =>
              entry.route.startsWith("/resources/")
            )) {
              for (const method of ["GET", "HEAD"]) {
                const response = yield* Effect.promise(
                  handler.bind(
                    undefined,
                    new Request(
                      `https://ratstack.sh${page.route}.svx?view=agent`,
                      { method }
                    ),
                    undefined
                  )
                );

                expect(response.status).toBe(301);
                expect(response.headers.get("location")).toBe(
                  `${page.route}?view=agent`
                );
              }
            }

            const missing = yield* Effect.promise(
              handler.bind(
                undefined,
                new Request("https://ratstack.sh/resources/missing.svx"),
                undefined
              )
            );

            expect(missing.status).toBe(404);

            for (const image of manifest.images) {
              const expected = yield* fs.readFile(
                `${directory}/assets/${manifest.generation}${image}`
              );

              const response = yield* Effect.promise(
                handler.bind(
                  undefined,
                  new Request(`https://ratstack.sh${image}`),
                  undefined
                )
              );

              expect(response.status).toBe(200);

              const bytes = yield* Effect.promise(
                response.arrayBuffer.bind(response)
              );

              expect(bytes.byteLength).toBe(expected.byteLength);
              expect(
                Buffer.from(bytes).equals(Buffer.from(expected)),
                image
              ).toBe(true);
            }
          }),
        ({ dispose }) => Effect.promise(dispose)
      );

      const images = [
        { base64: faviconIcoBase64, path: "/favicon.ico" },
        { base64: appleTouchIconPngBase64, path: "/apple-touch-icon.png" },
        {
          base64: Buffer.from(ratSvg).toString("base64"),
          path: "/favicon.svg",
        },
        ...ogImages.map((image) => ({
          base64: image.pngBase64,
          path: ogImagePath(image.routePath),
        })),
        {
          base64: tokenmaxxImageJpegBase64,
          path: "/tokenmaxx/four-comma-club.jpg",
        },
        {
          base64: cartridgesImageJpegBase64,
          path: "/lore/cartridges/snes-sfam-cartridges.jpg",
        },
        {
          base64: dillonPosterJpegBase64,
          path: "/lore/dependency-injection-is-the-reason-to-choose-effect/dillon-mulroy-di.jpg",
        },
      ];

      expect(manifest.images.toSorted()).toEqual(
        images.map((image) => image.path).toSorted()
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "publishes only current routes and prunes the previous generation",
  () =>
    Effect.gen(function* replaceAssetSet() {
      const fs = yield* FileSystem.FileSystem;
      const temporary = yield* fs.makeTempDirectoryScoped();
      const directory = `${temporary}/content`;
      yield* emitAssets({
        directory,
        images: [],
        pages: [{ documentHtml: "old", routePath: "/old", text: "old" }],
      });
      const previous = yield* manifestAt(directory);
      yield* emitAssets({
        directory,
        images: [],
        pages: [{ documentHtml: "new", routePath: "/new", text: "new" }],
      });
      const current = yield* manifestAt(directory);
      expect(current.generation).not.toBe(previous.generation);
      expect(current.pages.some((page) => page.route === "/old")).toBe(false);
      expect(
        yield* fs.readFileString(
          `${directory}/assets/${current.generation}/new.md`
        )
      ).toBe("new");
      expect(
        yield* fs.exists(`${directory}/assets/${previous.generation}/old.md`)
      ).toBe(false);
      expect(current).toEqual({
        generation: current.generation,
        images: [],
        pages: [{ html: "/new.html", markdown: "/new.md", route: "/new" }],
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
