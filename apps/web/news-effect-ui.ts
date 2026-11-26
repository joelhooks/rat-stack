import type { Plugin } from "vite";

const browserEntry = "/src/client/news-effect-ui/entry.ts";

const browserInput = new URL(`.${browserEntry}`, import.meta.url).pathname;

const entryName = "news-effect-ui";

const assetModule = "virtual:news-effect-ui-entry";

export const newsEffectUiPlugin = (): Plugin => {
  const entry = { url: browserEntry };

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

      if (chunk === undefined) {
        this.error(
          "Missing Effect UI news entry. Fix: check `newsEffectUiPlugin` client input."
        );
      }

      entry.url = `${this.environment.config.base}${chunk.fileName}`;
    },
    load(id) {
      return id === `\0${assetModule}`
        ? `export default ${JSON.stringify(entry.url)}`
        : undefined;
    },
    name: "reader-news-effect-ui",
    resolveId(id) {
      return id === assetModule ? `\0${id}` : undefined;
    },
    sharedDuringBuild: true,
  };
};
