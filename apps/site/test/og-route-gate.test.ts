import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { fenceMessage } from "../../../packages/core/test/fixtures/fence-message.ts";
import { validateOgRoutes } from "../scripts/og-route-gate.ts";
import { readerAssetInputs } from "../scripts/reader-site-inputs.ts";

it.layer(NodeServices.layer)((test) => {
  test.effect("rejects incomplete social metadata and a wrong-size PNG", () =>
    Effect.gen(function* checkPublishedArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const { directory, documents } = yield* readerAssetInputs;
      const origin = "https://ratstack.sh";

      const html = (yield* fs.readFileString(
        `${documents}/index.html`
      )).replaceAll("__RATSTACK_ORIGIN__", origin);

      const png = yield* fs.readFile(`${directory}/og/home.png`);

      const run = (document: string, bytes: Uint8Array) =>
        validateOgRoutes({
          html: () => Effect.succeed(document),
          metadataFile: "apps/site/scripts/document-html.ts",
          origin,
          png: () => Effect.succeed(bytes),
          routes: ["/", "/.well-known/mcp.json"],
          surface: "Test export",
        });

      expect(yield* run(html, png)).toEqual(["/og/home.png"]);

      const tags = [
        'property="og:image"',
        'property="og:image:width"',
        'property="og:image:height"',
        'property="og:image:type"',
        'property="og:image:alt"',
        'name="twitter:card"',
        'name="twitter:image"',
      ];

      for (const tag of tags) {
        const error = yield* run(html.replace(tag, 'name="removed"'), png).pipe(
          Effect.flip
        );

        expect(fenceMessage(error.message)?.what).toContain(
          "OG metadata for / is invalid"
        );
      }

      const wrongSize = Uint8Array.from(png);
      new DataView(wrongSize.buffer).setUint32(16, 1199);
      const error = yield* run(html, wrongSize).pipe(Effect.flip);
      expect(fenceMessage(error.message)?.fix).toContain(
        "`apps/site/scripts/generate-content.ts`"
      );
    })
  );
});
