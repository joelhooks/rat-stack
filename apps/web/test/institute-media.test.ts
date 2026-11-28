import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { serveHashedAsset } from "../src/institute/routes/media.js";

const media =
  "https://ratstack.sh/institute/content/one-contract/lesson.01234567.webm";

it.effect(
  "supplies single and suffix ranges when ASSETS returns the full WebM",
  () =>
    Effect.gen(function* rangeFallback() {
      for (const [range, status, contentRange, body] of [
        ["bytes=1-2", 206, "bytes 1-2/5", "bc"],
        ["bytes=-2", 206, "bytes 3-4/5", "de"],
        ["bytes=3-", 206, "bytes 3-4/5", "de"],
        ["bytes=0-1,3-4", 200, null, "abcde"],
        ["bytes=5-", 416, "bytes */5", ""],
      ] as const) {
        const request = new Request(media, { headers: { range } });

        const response = yield* serveHashedAsset(
          request,
          (forwarded) => {
            expect(forwarded).toBe(request);

            return Promise.resolve(
              new Response("abcde", {
                headers: { "Content-Type": "audio/webm" },
              })
            );
          },
          true
        );

        expect(response.status).toBe(status);
        expect(response.headers.get("accept-ranges")).toBe("bytes");
        expect(response.headers.get("content-range")).toBe(contentRange);
        expect(response.headers.get("cache-control")).toBe(
          status === 416 ? "no-store" : "public, max-age=31536000, immutable"
        );
        expect(yield* Effect.promise(response.text.bind(response))).toBe(body);
      }
    })
);

it.effect("AAC uses audio/mp4 and the same range fallback", () =>
  Effect.gen(function* aacRange() {
    const request = new Request(media.replace(/\.webm$/u, ".m4a"), {
      headers: { Range: "bytes=0-1" },
    });

    const response = yield* serveHashedAsset(
      request,
      () =>
        Promise.resolve(
          new Response("abcd", {
            headers: { "Content-Type": "application/octet-stream" },
          })
        ),
      true
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(response.headers.get("content-range")).toBe("bytes 0-1/4");
  })
);

it.effect(
  "preserves ASSETS's range response, without caching when unlisted",
  () =>
    Effect.gen(function* providerRange() {
      const request = new Request(media, { headers: { Range: "bytes=0-1" } });

      const partial = yield* serveHashedAsset(
        request,
        () =>
          Promise.resolve(
            new Response("ab", {
              headers: { "Content-Range": "bytes 0-1/5" },
              status: 206,
            })
          ),
        false
      );

      expect(partial.status).toBe(206);
      expect(partial.headers.get("content-range")).toBe("bytes 0-1/5");
      expect(partial.headers.get("cache-control")).toBe("no-store");
      expect(yield* Effect.promise(partial.text.bind(partial))).toBe("ab");

      const refused = new Response(null, {
        headers: { "Content-Range": "bytes */5" },
        status: 416,
      });

      expect(
        yield* serveHashedAsset(request, () => Promise.resolve(refused), true)
      ).toBe(refused);
    })
);
