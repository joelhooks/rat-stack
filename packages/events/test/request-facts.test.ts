import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

import { capturedQuery, isSensitiveKey, referrerOf } from "../src/index.js";
import { queryPairs, sensitiveWord, word } from "./arbitraries.js";

describe("request facts", () => {
  it.prop(
    "captured queries drop every sensitive key and keep every other value in order",
    { pairs: queryPairs },
    ({ pairs }) => {
      const params = new URLSearchParams(pairs);

      expect(capturedQuery(params)).toStrictEqual(
        Object.fromEntries(
          [...new Set(pairs.map(([key]) => key))].flatMap((key) =>
            isSensitiveKey(key) ? [] : [[key, params.getAll(key)]]
          )
        )
      );
    }
  );

  it.prop(
    "credentials, emails, codes, and session ids in a query never reach an event",
    {
      pairs: queryPairs,
      secret: sensitiveWord,
      value: word,
    },
    ({ pairs, secret, value }) => {
      const captured = capturedQuery(
        new URLSearchParams([...pairs, [secret, value]])
      );

      expect(Object.hasOwn(captured, secret)).toBe(false);
    }
  );

  it.prop(
    "referrers never carry a query string or fragment",
    {
      fragment: word,
      path: word,
      query: word,
      secure: Arbitrary.schema(Schema.Boolean),
    },
    ({ fragment, path, query, secure }) => {
      const origin = `${secure ? "https" : "http"}://example.test`;

      expect(referrerOf(`${origin}/${path}?q=${query}#${fragment}`)).toBe(
        `${origin}/${path}`
      );
      expect(referrerOf(path)).toBeUndefined();
    }
  );
});
