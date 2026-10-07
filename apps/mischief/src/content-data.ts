import { LoreEdge, LoreGroup, LoreNode } from "@rat-stack/core/contracts";
import { Schema } from "effect";

const MetadataFields = {
  dateModified: Schema.optional(Schema.String),
  datePublished: Schema.optional(Schema.String),
  description: Schema.String,
  digest: Schema.String,
  routePath: Schema.TemplateLiteral(["/", Schema.String]),
  sourcePath: Schema.String,
};

const SourceFields = {
  ...MetadataFields,
  bodyMarkdown: Schema.String,
  text: Schema.String,
};

export const LawSource = Schema.Struct({
  ...SourceFields,
  title: Schema.String,
});

export const SkillSource = Schema.Struct({
  ...SourceFields,
  name: Schema.String,
});

const LoreFields = {
  group: LoreGroup,
  slug: Schema.String,
  sources: Schema.Array(Schema.String),
  terms: Schema.Array(Schema.String),
};

export const LoreSource = Schema.Struct({
  ...SourceFields,
  ...LoreFields,
  title: Schema.String,
});

export const PromptSource = Schema.Struct({
  ...SourceFields,
  credit: Schema.String,
  slug: Schema.String,
  title: Schema.String,
});

const ResourceFields = {
  ...MetadataFields,
  id: Schema.String,
  name: Schema.String,
  title: Schema.String,
};

const LawMetadata = Schema.Struct({
  ...ResourceFields,
  kind: Schema.Literal("law"),
});

const SkillMetadata = Schema.Struct({
  ...ResourceFields,
  kind: Schema.Literal("skill"),
});

const LoreMetadata = Schema.Struct({
  ...ResourceFields,
  ...LoreFields,
  kind: Schema.Literal("lore"),
});

const PromptMetadata = Schema.Struct({
  ...ResourceFields,
  credit: Schema.String,
  kind: Schema.Literal("prompt"),
  slug: Schema.String,
});

export const ContentMetadata = Schema.Union([
  PromptMetadata,
  LawMetadata,
  LoreMetadata,
  SkillMetadata,
]);

export const SearchResource = Schema.Union([
  Schema.Struct({ ...PromptMetadata.fields, text: Schema.String }),
  Schema.Struct({ ...LawMetadata.fields, text: Schema.String }),
  Schema.Struct({ ...LoreMetadata.fields, text: Schema.String }),
  Schema.Struct({ ...SkillMetadata.fields, text: Schema.String }),
]);

export const ContentResourceSchema = Schema.Union([
  Schema.Struct({ ...PromptMetadata.fields, ...SourceFields }),
  Schema.Struct({ ...LawMetadata.fields, ...SourceFields }),
  Schema.Struct({ ...LoreMetadata.fields, ...SourceFields }),
  Schema.Struct({ ...SkillMetadata.fields, ...SourceFields }),
]);

export type ContentResource = typeof ContentResourceSchema.Type;

export const GraphSnapshot = Schema.Struct({
  edges: Schema.Array(LoreEdge),
  nodes: Schema.Array(LoreNode),
});

export const ContentCatalog = Schema.Struct({
  glossaryIndexMarkdown: Schema.String,
  glossaryTerms: Schema.Array(
    Schema.Struct({
      routePath: Schema.String,
      summary: Schema.String,
      term: Schema.String,
    })
  ),
  homeMarkdownTemplate: Schema.String,
  imagePaths: Schema.Array(Schema.String),
  llmsLoreLinks: Schema.String,
  loreIndexMarkdown: Schema.String,
  pageRoutes: Schema.Array(Schema.String),
  resources: Schema.Array(ContentMetadata),
  skillIndexMarkdown: Schema.String,
  systemsIndexMarkdown: Schema.String,
});

export type ContentCatalogData = typeof ContentCatalog.Type;

export const contentPagePath = (id: string) =>
  `/_content/pages/${Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(new TextEncoder().encode(id))}.json`;

export const normalizeSources = (input: {
  readonly lawSources: readonly (typeof LawSource.Type)[];
  readonly loreSources: readonly (typeof LoreSource.Type)[];
  readonly skillSources: readonly (typeof SkillSource.Type)[];
  readonly promptSources?: readonly (typeof PromptSource.Type)[];
}): readonly ContentResource[] => [
  ...(input.promptSources ?? []).map((source) => ({
    ...source,
    id: `ratstack://prompts/${source.slug}`,
    kind: "prompt" as const,
    name: source.slug,
  })),
  ...input.lawSources.map((source) => ({
    ...source,
    id: `ratstack://repo/${source.sourcePath.includes(" ") ? source.routePath.slice(1) : source.sourcePath.replace(/^\.brain\//u, "")}`,
    kind: "law" as const,
    name: source.routePath.slice(1),
  })),
  ...input.loreSources.map((source) => ({
    ...source,
    id: `ratstack:/${source.routePath}`,
    kind: "lore" as const,
    name: source.slug,
  })),
  ...input.skillSources.map((source) => ({
    ...source,
    id: `ratstack://skills/${source.name}`,
    kind: "skill" as const,
    title: source.name,
  })),
];
