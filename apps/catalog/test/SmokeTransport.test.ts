import { expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { smokeCatalog, smokeTarget } from "../src/Smoke.ts";

it.effect.prop(
  "remote plaintext and non-HTTP targets are refused before any native request or bearer token can leave",
  {
    host: Arbitrary.schema(
      Schema.Literals([
        "example.test",
        "localhost.example.test",
        "127.0.0.1.example.test",
        "192.0.2.1",
      ])
    ),
    scheme: Arbitrary.schema(Schema.Literals(["http", "ftp", "ws"])),
  },
  ({ host, scheme }) =>
    Effect.gen(function* preventCredentialEgress() {
      const calls = yield* Ref.make(0);

      const http = HttpClient.make(() =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.andThen(Effect.die("Unexpected transport call"))
        )
      );

      const failure = yield* smokeCatalog(
        `${scheme}://${host}/catalog`,
        Redacted.make("synthetic-transport-token")
      ).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.flip);

      expect(failure.phase).toBe("configuration-or-transport");
      expect(yield* Ref.get(calls)).toBe(0);
    })
);

it.effect.prop(
  "HTTPS targets and only the two explicit HTTP loopback hosts are accepted",
  {
    target: Arbitrary.schema(
      Schema.Literals([
        "https://example.test/catalog",
        "http://localhost/catalog",
        "http://127.0.0.1/catalog",
      ])
    ),
  },
  ({ target }) =>
    Effect.gen(function* acceptSecureTransport() {
      const decoded = yield* Schema.decodeEffect(smokeTarget)(target);
      expect(decoded.toString()).toBe(target);
    })
);
