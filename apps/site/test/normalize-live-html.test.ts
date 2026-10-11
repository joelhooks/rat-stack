import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { normalizeLiveHtml } from "../scripts/normalize-live-html.ts";

it.effect(
  "strips the captured live AGENTS beacon and its injected newline only when enabled",
  () =>
    Effect.gen(function* liveBeacon() {
      const fs = yield* FileSystem.FileSystem;

      const tag = yield* fs.readFileString(
        new URL("fixtures/cloudflare-beacon.txt", import.meta.url).pathname
      );

      for (const injected of [tag, tag.replace('type="module"', "defer")]) {
        const page = `<body>generated content${injected}</body>`;
        expect(normalizeLiveHtml(page, "text/html")).toBe(page);
        expect(normalizeLiveHtml(page, "text/html; charset=utf-8", true)).toBe(
          "<body>generated content</body>"
        );

        for (const type of ["text/markdown", "application/json", "image/png"]) {
          expect(normalizeLiveHtml(page, type, true)).toBe(page);
        }
      }

      for (const script of [
        '<script src="/app.js"></script>\n',
        '<script data-src="https://static.cloudflareinsights.com/beacon.min.js" src="/app.js"></script>\n',
        '<script src="https://static.cloudflareinsights.com.evil.test/beacon.min.js"></script>\n',
        '<script src="https://static.cloudflareinsights.com/beacon.min.js">application code</script>\n',
      ]) {
        expect(normalizeLiveHtml(script, "text/html", true)).toBe(script);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
