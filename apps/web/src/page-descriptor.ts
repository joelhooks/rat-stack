import { Schema } from "effect";

export const ReaderMetadata = Schema.Struct({
  canonicalPath: Schema.String,
  dateModified: Schema.optional(Schema.String),
  datePublished: Schema.optional(Schema.String),
  description: Schema.String,
  discoveryLinks: Schema.Array(
    Schema.Struct({
      href: Schema.String,
      rel: Schema.String,
      type: Schema.String,
    })
  ),
  jsonLd: Schema.Literals(["WebSite", "TechArticle", "none"]),
  ogImagePath: Schema.String,
  robots: Schema.Literals(["index", "noindex"]),
  title: Schema.String,
});

export const ReaderRoute = Schema.Struct({
  metadata: ReaderMetadata,
  path: Schema.String,
  preview: Schema.Struct({
    availability: Schema.Literals([
      "included",
      "outside-slice",
      "representation-not-projected",
    ]),
    representation: Schema.Literals(["html", "markdown", "none"]),
    status: Schema.Int,
  }),
  representation: Schema.Literals(["html", "markdown", "redirect"]),
  sourcePath: Schema.String,
  status: Schema.Int,
});

export const ReaderReferences = Schema.Struct({
  anchors: Schema.Array(
    Schema.Struct({ id: Schema.String, text: Schema.String })
  ),
  backlinks: Schema.Array(
    Schema.Struct({
      context: Schema.String,
      description: Schema.String,
      route: Schema.String,
      title: Schema.String,
    })
  ),
  inboundCounts: Schema.Record(Schema.String, Schema.Int),
  lastChange: Schema.optional(
    Schema.Struct({
      date: Schema.String,
      hash: Schema.String,
      short: Schema.String,
    })
  ),
});

export const ReaderRouteLedger = Schema.Struct({
  anchorAdditions: Schema.Array(
    Schema.Struct({
      ids: Schema.Array(Schema.String),
      path: Schema.String,
      reason: Schema.String,
    })
  ),
  deliberateChanges: Schema.Array(
    Schema.Struct({
      location: Schema.String,
      path: Schema.String,
      previewStatus: Schema.Int,
      productionStatus: Schema.Int,
      reason: Schema.String,
    })
  ),
  generation: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  routes: Schema.Array(ReaderRoute),
});

export const ReaderPageDescriptor = Schema.Struct({
  generation: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  metadata: ReaderMetadata,
  path: Schema.String,
  sourcePath: Schema.String,
  status: Schema.Int,
});

export type ReaderPage = typeof ReaderPageDescriptor.Type;

export type ReaderPageMetadata = typeof ReaderMetadata.Type;

export type ReaderRouteEntry = typeof ReaderRoute.Type;
