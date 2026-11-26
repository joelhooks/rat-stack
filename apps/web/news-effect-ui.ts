import type { Plugin } from "vite";

const browserEntry = "/src/client/news-effect-ui/entry.ts";

const browserInput = new URL(`.${browserEntry}`, import.meta.url).pathname;

const entryName = "news-effect-ui";

const assetModule = "virtual:news-effect-ui-entry";

interface NewsAssets {
  readonly entryScript: string;
  readonly modulePreloads: readonly string[];
}

export const newsEffectUiPlugin = (): Plugin => {
  let builtAssets: NewsAssets | undefined;

  return {
    config: () => ({
      environments: {
        client: {
          build: {
            rolldownOptions: { input: { [entryName]: browserInput } },
          },
        },
      },
    }),
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") {
        return;
      }

      const chunk = Object.values(bundle).find(
        (output) =>
          output.type === "chunk" && output.isEntry && output.name === entryName
      );

      if (chunk?.type !== "chunk") {
        this.error(
          "Missing Effect UI news entry. Fix: check `newsEffectUiPlugin` client input."
        );
      }

      const visited = new Set([chunk.fileName]);

      const transitiveImports = (imports: readonly string[]) => {
        for (const fileName of imports) {
          const imported = bundle[fileName];

          if (visited.has(fileName) || imported === undefined) {
            continue;
          }

          if (imported.type === "chunk" && "imports" in imported) {
            visited.add(fileName);
            transitiveImports(imported.imports);
          }
        }
      };

      transitiveImports(chunk.imports);

      const assetUrl = (fileName: string) =>
        `${this.environment.config.base}${fileName}`;

      builtAssets = {
        entryScript: assetUrl(chunk.fileName),
        modulePreloads: [...visited].slice(1).map(assetUrl),
      };
    },
    load(id) {
      if (id !== `\0${assetModule}`) {
        return null;
      }

      const assets =
        this.environment.config.command === "serve"
          ? { entryScript: browserEntry, modulePreloads: [] }
          : builtAssets;

      if (assets === undefined) {
        this.error(
          "Effect UI news server build has no emitted client entry. Fix: run the full `@rat-stack/web` build so its client environment finishes before SSR."
        );
      }

      return `export default ${JSON.stringify(assets)}`;
    },
    name: "reader-news-effect-ui",
    resolveId(id) {
      return id === assetModule ? `\0${id}` : undefined;
    },
    sharedDuringBuild: true,
  };
};
