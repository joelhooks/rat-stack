import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const PackageManifest = Schema.fromJsonString(
  Schema.Struct({
    license: Schema.optional(Schema.String),
    name: Schema.String,
    version: Schema.String,
  })
);

const licenseFile = /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?$/iu;

const thirdPartyLicenses = Effect.fn("thirdPartyLicenses")(
  function* thirdPartyLicenses(moduleIds: readonly string[]) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const packageRoot = Effect.fn("packageRoot")(function* packageRoot(
      moduleId: string
    ) {
      let directory = path.dirname(
        moduleId.replace(/^\0/u, "").split("?")[0] ?? ""
      );

      while (directory !== path.dirname(directory)) {
        if (yield* fs.exists(path.join(directory, "package.json"))) {
          return Option.some(directory);
        }

        directory = path.dirname(directory);
      }

      return Option.none<string>();
    });

    const roots = new Set<string>();

    for (const moduleId of moduleIds) {
      const root = yield* packageRoot(moduleId);

      if (Option.isSome(root)) {
        roots.add(root.value);
      }
    }

    const sections: { readonly name: string; readonly text: string }[] = [];

    for (const root of roots) {
      const manifest = yield* fs
        .readFileString(path.join(root, "package.json"))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PackageManifest)));

      if (!manifest.name.startsWith("@rat-stack/")) {
        const file = (yield* fs.readDirectory(root)).find((name) =>
          licenseFile.test(name)
        );

        const text =
          file === undefined
            ? "No license file is published with this package."
            : `\`\`\`text\n${(yield* fs.readFileString(path.join(root, file))).trim()}\n\`\`\``;

        sections.push({
          name: manifest.name,
          text: [
            `## ${manifest.name}@${manifest.version}`,
            `License: ${manifest.license ?? "not declared"}`,
            text,
          ].join("\n\n"),
        });
      }
    }

    return [
      "# Third-party licenses",
      "The ratstack bundle includes these packages. rat-stack itself is MIT licensed.",
      ...sections
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map((section) => section.text),
    ].join("\n\n");
  }
);

const thirdPartyLicensesPlugin = (): Plugin => ({
  // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits generateBundle as a plugin hook, so this is the edge where the Effect program runs.
  async generateBundle(_options, bundle) {
    const moduleIds = Object.values(bundle).flatMap((output) =>
      output.type === "chunk" ? output.moduleIds : []
    );

    const source = await Effect.runPromise(
      thirdPartyLicenses(moduleIds).pipe(Effect.provide(NodeServices.layer))
    );

    this.emitFile({
      fileName: "THIRD_PARTY_LICENSES.md",
      source,
      type: "asset",
    });
  },
  name: "third-party-licenses",
});

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: "dist/npm",
    rolldownOptions: { output: { entryFileNames: "ratstack.js" } },
    ssr: "src/ratstack.ts",
    target: "node24",
  },
  plugins: [thirdPartyLicensesPlugin()],
  publicDir: "npm/ratstack",
  ssr: { noExternal: true, target: "node" },
});
