import { DateTime, Schema } from "effect";

import { buildError } from "./content-error.ts";
import { frontmatterData } from "./svx-ast.ts";

export interface ContentDates {
  readonly datePublished?: string;
  readonly dateModified?: string;
}

type MutableContentDates = {
  -readonly [Key in keyof ContentDates]: ContentDates[Key];
};

const dateFields = Schema.Struct({
  created_at: Schema.optional(Schema.String),
  updated: Schema.optional(Schema.String),
  updated_at: Schema.optional(Schema.String),
});

const isoDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));

const contentDate = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const date = Schema.decodeUnknownSync(isoDate)(value);

  const instant = Schema.decodeUnknownSync(Schema.DateTimeUtcFromString)(
    `${date}T00:00:00Z`
  );

  if (DateTime.formatIsoDateUtc(instant) !== date) {
    throw buildError(
      "content date",
      date,
      new Error("Use a real calendar date in YYYY-MM-DD format.")
    );
  }

  return date;
};

export const contentDates = (
  rawText: string,
  sourcePath = "<inline>"
): ContentDates => {
  try {
    const data = Schema.decodeUnknownSync(dateFields)(frontmatterData(rawText));
    const datePublished = contentDate(data.created_at);
    const dateModified = contentDate(data.updated_at ?? data.updated);
    const dates: MutableContentDates = {};

    if (datePublished !== undefined) {
      dates.datePublished = datePublished;
    }

    if (dateModified !== undefined) {
      dates.dateModified = dateModified;
    }

    return dates;
  } catch (error) {
    throw buildError(
      "content dates: use quoted YYYY-MM-DD values or omit unknown fields",
      sourcePath,
      error
    );
  }
};

export const pageTitle = (title: string) => {
  const branded = `${title} | rat-stack`;

  return branded.length > 60 ? title : branded;
};

export const structuredData = (input: {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly origin: string;
  readonly dates?: ContentDates;
}) => {
  if (
    input.path !== "/" &&
    !input.path.startsWith("/lore/") &&
    !input.path.startsWith("/systems/")
  ) {
    return "";
  }

  const publisher = {
    "@type": "Organization",
    name: "rat-stack",
    url: input.origin,
  };

  const data =
    input.path === "/"
      ? {
          "@context": "https://schema.org",
          "@type": "WebSite",
          description: input.description,
          name: "rat-stack",
          publisher,
          url: input.origin,
        }
      : {
          "@context": "https://schema.org",
          "@type": "TechArticle",
          author: publisher,
          description: input.description,
          headline: input.title,
          mainEntityOfPage: `${input.origin}${input.path}`,
          publisher,
          url: `${input.origin}${input.path}`,
          ...input.dates,
        };

  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
};
