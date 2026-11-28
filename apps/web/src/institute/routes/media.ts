import { Effect } from "effect";

import type { AssetFetch } from "./artifact.js";

const byteRange = (header: string, size: number) => {
  const range = /^bytes=(?<start>\d*)-(?<end>\d*)$/iu.exec(
    header.trim()
  )?.groups;

  if (range === undefined || (range.start === "" && range.end === "")) {
    return null;
  }

  const start =
    range.start === ""
      ? Math.max(0, size - Number(range.end))
      : Number(range.start);

  const end =
    range.start === "" || range.end === ""
      ? size - 1
      : Math.min(size - 1, Number(range.end));

  return { end, start };
};

const rangeResponse = Effect.fn("institute.rangeResponse")(
  function* rangeResponse(response: Response, headers: Headers, range: string) {
    const bytes = yield* Effect.tryPromise(() => response.bytes());
    const interval = byteRange(range, bytes.byteLength);

    if (interval === null) {
      return new Response(bytes, { headers, status: 200 });
    }

    const { end, start } = interval;

    if (start > end) {
      headers.delete("Content-Length");
      headers.set("Cache-Control", "no-store");
      headers.set("Content-Range", `bytes */${bytes.byteLength}`);

      return new Response(null, { headers, status: 416 });
    }

    const slice = bytes.subarray(start, end + 1);
    headers.set("Content-Length", String(slice.byteLength));
    headers.set("Content-Range", `bytes ${start}-${end}/${bytes.byteLength}`);

    return new Response(slice, { headers, status: 206 });
  }
);

const audioType = (pathname: string) => {
  if (pathname.endsWith(".webm")) {
    return "audio/webm";
  }

  return pathname.endsWith(".m4a") ? "audio/mp4" : null;
};

const matchesIfRange = (request: Request, response: Response) => {
  const validator = request.headers.get("If-Range");

  return (
    validator === null ||
    (!validator.startsWith("W/") &&
      (validator === response.headers.get("ETag") ||
        validator === response.headers.get("Last-Modified")))
  );
};

export const serveHashedAsset = Effect.fn("institute.hashedAsset")(
  function* serveHashedAsset(
    request: Request,
    fetchAsset: AssetFetch,
    discoverable: boolean
  ) {
    const response = yield* Effect.tryPromise(() => fetchAsset(request));

    if (
      response.status !== 200 &&
      response.status !== 206 &&
      response.status !== 304
    ) {
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set(
      "Cache-Control",
      discoverable ? "public, max-age=31536000, immutable" : "no-store"
    );
    const mediaType = audioType(new URL(request.url).pathname);

    if (mediaType !== null) {
      headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Type", mediaType);
    }

    const range = request.headers.get("Range");

    if (
      mediaType !== null &&
      response.status === 200 &&
      request.method === "GET" &&
      range !== null &&
      matchesIfRange(request, response)
    ) {
      return yield* rangeResponse(response, headers, range);
    }

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
);
