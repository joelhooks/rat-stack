import { Schema } from "effect";

export const GEO_LABEL_MAX_LENGTH = 100;

const GeoLabelSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(GEO_LABEL_MAX_LENGTH)
);

export const RequestGeoSchema = Schema.Struct({
  asOrganization: Schema.optionalKey(GeoLabelSchema),
  asn: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  city: Schema.optionalKey(GeoLabelSchema),
  colo: Schema.optionalKey(GeoLabelSchema),
  continent: Schema.optionalKey(GeoLabelSchema),
  country: Schema.optionalKey(GeoLabelSchema),
  isEUCountry: Schema.optionalKey(Schema.Boolean),
  region: Schema.optionalKey(GeoLabelSchema),
  regionCode: Schema.optionalKey(GeoLabelSchema),
  timezone: Schema.optionalKey(GeoLabelSchema),
});

export type RequestGeo = typeof RequestGeoSchema.Type;

export const isGeoLabel = Schema.is(GeoLabelSchema);
