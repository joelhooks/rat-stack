import type { Spec } from "@json-render/core";
import { Result, Schema } from "effect";

import generated from "./.generated/page-catalog.json" with { type: "json" };

export { InvalidPage, SpecIssue } from "./invalid-page.js";

export const pageCatalogMetadata = generated.metadata;

export type PageSpecValue = Spec;

// oxlint-disable-next-line no-control-regex -- The featured-sites port must supply text Foldkit can serialize.
const renderableTextPattern = /^[^\u0000\uD800-\uDFFF]*$/u;

const Text = Schema.String.check(Schema.isPattern(renderableTextPattern));

export const FeaturedSite = Schema.Struct({
  author: Text,
  description: Text,
  image: Schema.optionalKey(
    Schema.Struct({
      alt: Text,
      src: Text.check(Schema.isPattern(/^https:\/\//u)),
    })
  ),
  name: Text,
  stack: Schema.Array(Text),
  url: Text.check(Schema.isPattern(/^https:\/\//u)),
});

export const FeaturedSites = Schema.Array(FeaturedSite);

const { author, ...siteFields } = FeaturedSite.fields;

const FeaturedSiteSources = Schema.Array(
  Schema.Struct({ ...siteFields, credit: author })
);

export const decodeFeaturedSites = (
  source: typeof FeaturedSiteSources.Encoded
) =>
  Schema.decodeSync(FeaturedSiteSources)(source).map(({ credit, ...site }) => ({
    ...site,
    author: credit,
  }));

const catalogJsonSchema = Schema.decodeUnknownSync(Schema.JsonObject)(
  generated.schema
);

const catalogSchemaHint = Schema.makeFilter(() => true, {
  toJsonSchema: () => catalogJsonSchema,
});

export const PageSubmission = Schema.Struct({
  spec: Schema.Unknown.pipe(
    Schema.encodeTo(Schema.Json.check(catalogSchemaHint))
  ),
});

const WireElement = Schema.Struct({
  children: Schema.optionalKey(Schema.Array(Schema.String)),
  props: Schema.JsonObject,
  type: Schema.String,
});

const WirePage = Schema.Struct({
  elements: Schema.Record(Schema.String, WireElement),
  root: Schema.String,
});

const NativeSpecWire = Schema.declare<Spec>((input): input is Spec => {
  const result = Schema.decodeUnknownResult(WirePage)(input);

  return (
    Result.isSuccess(result) &&
    Object.hasOwn(result.success.elements, result.success.root) &&
    Object.values(result.success.elements).every((element) =>
      (element.children ?? []).every((id) =>
        Object.hasOwn(result.success.elements, id)
      )
    )
  );
});

export const PageSpec = Schema.JsonObject.check(catalogSchemaHint).pipe(
  Schema.decodeTo(NativeSpecWire)
);
