import { Schema } from "effect";
import type { Plugin } from "vite";

const entries = {
  "all-stars-effect-ui": "src/client/all-stars-effect-ui/entry.ts",
  "directory-effect-ui": "src/client/directory-effect-ui/entry.ts",
  "news-effect-ui": "src/client/news-effect-ui/entry.ts",
  "reader-effect-ui": "src/client/reader-effect-ui/entry.ts",
};

const manifestFile = ".vite/manifest.json";

const assetModule = "virtual:reader-effect-ui-assets";

const Manifest = Schema.Record(
  Schema.String,
  Schema.Struct({
    css: Schema.optionalKey(Schema.Array(Schema.String)),
    file: Schema.String,
    imports: Schema.optionalKey(Schema.Array(Schema.String)),
    isEntry: Schema.optionalKey(Schema.Boolean),
  })
);

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Manifest)
);

export const manifestAssets = (
  manifest: typeof Manifest.Type,
  entry: string,
  base: string
) => {
  const input = manifest[entry];

  if (input?.isEntry !== true) {
    throw new Error(
      `Missing Effect UI client entry for ${entry}. Fix: check \`effectUiPlugin\` client inputs.`
    );
  }

  const visited = new Set([entry]);
  const modulePreloads = new Set<string>();
  const stylesheets = new Set(input.css);

  const visit = (imports: readonly string[]) => {
    for (const key of imports) {
      if (visited.has(key)) {
        continue;
      }

      const chunk = manifest[key];

      if (chunk === undefined) {
        throw new Error(
          `Effect UI entry ${entry} imports missing manifest chunk ${key}. Fix: rebuild \`@rat-stack/web\`.`
        );
      }

      visited.add(key);
      modulePreloads.add(chunk.file);

      for (const href of chunk.css ?? []) {
        stylesheets.add(href);
      }

      visit(chunk.imports ?? []);
    }
  };

  visit(input.imports ?? []);

  const assetUrl = (file: string) => `${base}${file}`;

  return {
    entryScript: assetUrl(input.file),
    modulePreloads: [...modulePreloads].map(assetUrl),
    stylesheets: [...stylesheets].map(assetUrl),
  };
};

export const effectUiPlugin = (): Plugin => {
  let builtAssets:
    | Record<string, ReturnType<typeof manifestAssets>>
    | undefined;

  return {
    config: () => ({
      environments: {
        client: {
          build: {
            manifest: manifestFile,
            rolldownOptions: {
              input: Object.fromEntries(
                Object.entries(entries).map(([name, path]) => [
                  name,
                  new URL(path, import.meta.url).pathname,
                ])
              ),
            },
          },
        },
      },
    }),
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        if (this.environment.name !== "client") {
          return;
        }

        const asset = bundle[manifestFile];

        if (asset?.type !== "asset") {
          this.error(
            "Missing Vite client manifest. Fix: enable `build.manifest` in the client environment."
          );
        }

        const { base } = this.environment.config;
        const manifest = decodeManifest(asset.source);

        builtAssets = Object.fromEntries(
          Object.entries(entries).map(([name, path]) => [
            name,
            manifestAssets(manifest, path, base),
          ])
        );

        delete bundle[".vite/manifest.json"];
      },
    },
    load(id) {
      if (id !== `\0${assetModule}`) {
        return null;
      }

      const assets =
        this.environment.config.command === "serve"
          ? Object.fromEntries(
              Object.entries(entries).map(([name, path]) => [
                name,
                {
                  entryScript: `/${path}`,
                  modulePreloads: [],
                  stylesheets: [],
                },
              ])
            )
          : builtAssets;

      if (assets === undefined) {
        this.error(
          "Effect UI server build has no client manifest. Fix: run the full `@rat-stack/web` build so its client environment finishes before SSR."
        );
      }

      return `export default ${JSON.stringify(assets)}`;
    },
    name: "reader-effect-ui",
    resolveId(id) {
      return id === assetModule ? `\0${id}` : undefined;
    },
    sharedDuringBuild: true,
  };
};
