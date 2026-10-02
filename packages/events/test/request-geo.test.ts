import { describe, expect, it } from "@effect/vitest";
import { Effect, Predicate, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import {
  GEO_LABEL_KEYS,
  NEVER_CAPTURED_GEO_KEYS,
  requestGeoOf,
} from "../src/index.js";

const TOO_LONG = "x".repeat(101);

const CfKeySchema = Schema.Literals([
  ...GEO_LABEL_KEYS,
  ...NEVER_CAPTURED_GEO_KEYS,
  "asn",
  "city",
  "isEUCountry",
  "botManagement",
]);

type CfKey = typeof CfKeySchema.Type;

const CfValueSchema = Schema.Union([
  Schema.Literals([
    "PL",
    "EU",
    "Europe/Warsaw",
    "WAW",
    "Mazovia",
    "14",
    "Cloudflare, Inc.",
    "1",
    "0",
    "",
    TOO_LONG,
  ]),
  Schema.Literals([0, 13_335, -1, 3.5]),
  Schema.Literal(true),
]);

type CfValue = typeof CfValueSchema.Type;

type Cf = Partial<Record<CfKey, CfValue>>;

const cfObject = Arbitrary.array(
  Arbitrary.all([
    Arbitrary.schema(CfKeySchema),
    Arbitrary.schema(CfValueSchema),
  ]),
  { maxLength: 16 }
).pipe(Arbitrary.map((pairs): Cf => Object.fromEntries(pairs)));

const requestWith = (cf: Cf | string | undefined) => {
  const web = new Request("https://ratstack.sh/");

  return HttpServerRequest.fromWeb(
    cf === undefined ? web : Object.defineProperty(web, "cf", { value: cf })
  );
};

const isLabel = (value: CfValue | undefined) =>
  Predicate.isString(value) && value.length >= 1 && value.length <= 100;

const expectedGeo = (cf: Cf, captureCity: boolean) => {
  const expected = new Map<string, boolean | number | string>();

  const labels = captureCity
    ? [...GEO_LABEL_KEYS, "city" as const]
    : GEO_LABEL_KEYS;

  for (const key of labels) {
    const value = cf[key];

    if (value !== undefined && isLabel(value)) {
      expected.set(key, value);
    }
  }

  const { asn } = cf;

  if (Predicate.isNumber(asn) && Number.isInteger(asn) && asn >= 0) {
    expected.set("asn", asn);
  }

  if (isLabel(cf.country)) {
    expected.set("isEUCountry", cf.isEUCountry === "1");
  }

  return Object.fromEntries(expected);
};

describe("request geo", () => {
  it.effect.prop(
    "keeps only valid coarse fields, never coordinates, postal or metro code, and city only when switched on",
    { captureCity: Arbitrary.schema(Schema.Boolean), cf: cfObject },
    ({ captureCity, cf }) =>
      Effect.sync(() => {
        const geo = requestGeoOf(requestWith(cf), { captureCity });

        expect(geo).toStrictEqual(expectedGeo(cf, captureCity));

        for (const key of NEVER_CAPTURED_GEO_KEYS) {
          expect(Object.hasOwn(geo, key)).toBe(false);
        }

        expect(Object.hasOwn(geo, "city")).toBe(
          captureCity && isLabel(cf.city)
        );
      }),
    { arbitrary: { runs: 500 } }
  );

  it.effect("is empty when there is no usable request.cf", () =>
    Effect.sync(() => {
      for (const missing of [undefined, "PL"]) {
        expect(
          requestGeoOf(requestWith(missing), { captureCity: true })
        ).toStrictEqual({});
      }
    })
  );
});
