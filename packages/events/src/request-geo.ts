import { RequestGeoSchema, isGeoLabel } from "@rat-stack/core/request-geo";
import type { RequestGeo } from "@rat-stack/core/request-geo";
import { Option, Predicate, Schema } from "effect";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";

export interface GeoOptions {
  readonly captureCity: boolean;
}

export const GEO_LABEL_KEYS = [
  "asOrganization",
  "colo",
  "continent",
  "country",
  "region",
  "regionCode",
  "timezone",
] as const;

export const NEVER_CAPTURED_GEO_KEYS = [
  "latitude",
  "longitude",
  "postalCode",
  "metroCode",
] as const;

const decodeGeo = Schema.decodeUnknownOption(RequestGeoSchema);

const isAsn = Schema.is(RequestGeoSchema.fields.asn);

export const requestGeoOf = (
  request: HttpServerRequest.HttpServerRequest,
  options: GeoOptions
): RequestGeo => {
  const { source } = request;

  const cf =
    Predicate.hasProperty(source, "cf") && Predicate.isObject(source.cf)
      ? source.cf
      : {};

  const read = (key: string) =>
    Predicate.hasProperty(cf, key) ? cf[key] : undefined;

  const labelKeys = options.captureCity
    ? [...GEO_LABEL_KEYS, "city" as const]
    : GEO_LABEL_KEYS;

  const entries: [string, boolean | number | string][] = labelKeys.flatMap(
    (key) => {
      const value = read(key);

      return isGeoLabel(value) ? [[key, value]] : [];
    }
  );

  const asn = read("asn");

  if (isAsn(asn)) {
    entries.push(["asn", asn]);
  }

  if (isGeoLabel(read("country"))) {
    entries.push(["isEUCountry", read("isEUCountry") === "1"]);
  }

  return Option.getOrElse(decodeGeo(Object.fromEntries(entries)), () => ({}));
};
