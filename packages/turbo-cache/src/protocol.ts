import type { R2Object } from "@alchemy.run/cloudflare/R2/BucketTypes";
import type { ReadWriteBucketClient } from "@alchemy.run/cloudflare/R2/ReadWriteBucket";
import { Effect, Option, Predicate, Redacted, Schema } from "effect";

export interface TeamCredential {
  readonly team: string;
  readonly token: Effect.Effect<Redacted.Redacted>;
}

type NativeComparison = (a: ArrayBuffer, b: ArrayBuffer) => boolean;

const NativeCrypto = Schema.Struct({
  timingSafeEqual: Schema.declare<NativeComparison>(
    (input: unknown): input is NativeComparison => Predicate.isFunction(input)
  ),
});

type Storage = Pick<ReadWriteBucketClient, "get" | "head" | "put">;

const segment = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/u));

const hashes = Schema.Struct({ hashes: Schema.Array(segment) });

const validSegment = Schema.is(segment);

const digest = (value: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  );

const refusal = (status: number) =>
  new Response(null, { headers: { "cache-control": "no-store" }, status });

const artifactResponse = (hit: R2Object, body: ReadableStream | null) => {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-length": String(hit.size),
    "content-type": "application/octet-stream",
    "x-artifact-duration": hit.customMetadata?.duration ?? "0",
  });

  const tag = hit.customMetadata?.tag;

  if (tag !== undefined) {
    headers.set("x-artifact-tag", tag);
  }

  return new Response(body, { headers });
};

const forbidden = () =>
  Response.json(
    {
      error: {
        code: "forbidden",
        message: "The credential does not authorize this team.",
      },
    },
    { headers: { "cache-control": "no-store" }, status: 403 }
  );

const authenticate = Effect.fn("TurboCache.authenticate")(
  function* authenticate(
    request: Request,
    credentials: readonly TeamCredential[]
  ) {
    const bearer = /^Bearer (?<token>.+)$/u.exec(
      request.headers.get("authorization") ?? ""
    )?.groups?.token;

    const native = yield* Schema.decodeUnknownEffect(NativeCrypto)(
      crypto.subtle
    ).pipe(Effect.orDie);

    const presented = yield* digest(bearer ?? "");

    const matches = yield* Effect.all(
      credentials.map(({ team, token }) =>
        token.pipe(
          Effect.flatMap((value) => digest(Redacted.value(value))),
          Effect.map((expected) => ({
            matches: native.timingSafeEqual.call(
              crypto.subtle,
              expected,
              presented
            ),
            team,
          }))
        )
      )
    );

    return bearer === undefined
      ? undefined
      : matches.find((candidate) => candidate.matches)?.team;
  }
);

const queryArtifacts = Effect.fn("TurboCache.query")(function* queryArtifacts(
  request: Request,
  bucket: Storage,
  team: string
) {
  const parsed = yield* Effect.tryPromise(() => request.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(hashes)),
    Effect.option
  );

  if (Option.isNone(parsed)) {
    return refusal(400);
  }

  const hits = yield* Effect.all(
    parsed.value.hashes.map((hash) =>
      bucket.head(`${team}/${hash}`).pipe(
        Effect.map(
          (hit) =>
            [
              hash,
              hit === null
                ? null
                : {
                    size: hit.size,
                    taskDurationMs: Number(hit.customMetadata?.duration ?? "0"),
                  },
            ] as const
        )
      )
    )
  );

  return Response.json(Object.fromEntries(hits), {
    headers: { "cache-control": "no-store" },
  });
});

const putArtifact = Effect.fn("TurboCache.put")(function* putArtifact(
  request: Request,
  bucket: Storage,
  key: string
) {
  const length = request.headers.get("content-length");
  const duration = request.headers.get("x-artifact-duration") ?? "0";
  const tag = request.headers.get("x-artifact-tag");

  if (length === null || !/^\d+$/u.test(length) || !/^\d+$/u.test(duration)) {
    return refusal(400);
  }

  const customMetadata = tag === null ? { duration } : { duration, tag };

  yield* bucket.put(key, request.body, {
    customMetadata,
    httpMetadata: { contentType: "application/octet-stream" },
  });

  return refusal(200);
});

const readArtifact = Effect.fn("TurboCache.read")(function* readArtifact(
  request: Request,
  bucket: Storage,
  key: string
) {
  if (request.method === "HEAD") {
    const hit = yield* bucket.head(key);

    return hit === null ? refusal(404) : artifactResponse(hit, null);
  }

  const hit = yield* bucket.get(key);

  return hit === null
    ? refusal(404)
    : artifactResponse(hit, hit.readable ?? null);
});

const routeFor = (request: Request) => {
  const { pathname } = new URL(request.url);

  if (pathname === "/v8/artifacts/status" && request.method === "GET") {
    return { kind: "status" } as const;
  }

  if (pathname === "/v8/artifacts/events" && request.method === "POST") {
    return { kind: "events" } as const;
  }

  if (pathname === "/v8/artifacts" && request.method === "POST") {
    return { kind: "query" } as const;
  }

  const hash = /^\/v8\/artifacts\/(?<hash>[a-zA-Z0-9_-]+)$/u.exec(pathname)
    ?.groups?.hash;

  if (
    hash === undefined ||
    ["status", "events"].includes(hash) ||
    !["GET", "HEAD", "PUT"].includes(request.method)
  ) {
    return { kind: "missing" } as const;
  }

  return { hash, kind: "artifact" } as const;
};

export const artifactHandler = (
  bucket: Storage,
  credentials: readonly TeamCredential[]
) =>
  Effect.fn("TurboCache.request")(function* artifactRequest(request: Request) {
    const route = routeFor(request);

    if (route.kind === "missing") {
      return refusal(404);
    }

    const authorizedTeam = yield* authenticate(request, credentials);

    if (authorizedTeam === undefined) {
      return refusal(401);
    }

    const url = new URL(request.url);
    const slugs = url.searchParams.getAll("slug");
    const [team] = slugs;

    if (
      slugs.length !== 1 ||
      team === undefined ||
      !validSegment(team) ||
      authorizedTeam !== team ||
      url.searchParams.has("teamId")
    ) {
      return forbidden();
    }

    switch (route.kind) {
      case "status": {
        return Response.json(
          { status: "enabled" },
          { headers: { "cache-control": "no-store" } }
        );
      }

      case "events": {
        return refusal(204);
      }

      case "query": {
        return yield* queryArtifacts(request, bucket, team);
      }

      case "artifact": {
        const key = `${team}/${route.hash}`;

        return yield* request.method === "PUT"
          ? putArtifact(request, bucket, key)
          : readArtifact(request, bucket, key);
      }

      default: {
        return refusal(404);
      }
    }
  });
