// @effect-diagnostics nodeBuiltinImport:off -- These tests build the app with the real Vite binary and read the emitted source maps from disk.
import { spawnSync } from "node:child_process";
import {
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ContentAssetManifest } from "../../mischief/src/asset-manifest.js";
import { ReaderFlags } from "../src/client/reader-model.js";
import { readerCodeWithoutPageData } from "./reader-bundle-data.js";

const webRoot = path.resolve(import.meta.dirname, "..");

const vite = path.join(webRoot, "node_modules/.bin/vite");

const decodeSourceMap = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ sources: Schema.Array(Schema.String) }))
);

const decodeReaderPages = Schema.decodeSync(
  Schema.fromJsonString(Schema.Array(ReaderFlags))
);

const forbiddenStrings = [
  "rat_call",
  "rat_test_person",
  "rat-test-person-password",
];

const forbiddenModules = [
  "src/dev/",
  "../../packages/devtools/",
  "../../packages/auth/src/devtools",
  "htmlparser2",
  "code-snippets",
  "shiki",
  "../mischief/scripts/reader-body-document",
  "../mischief/scripts/reader-site-inputs",
];

const build = (nodeEnv: "development" | "production") => {
  const outDir = mkdtempSync(path.join(tmpdir(), "rat-web-bundle-"));

  try {
    symlinkSync(
      path.join(webRoot, "node_modules"),
      path.join(outDir, "node_modules"),
      "dir"
    );

    const result = spawnSync(
      vite,
      ["build", "--sourcemap", "--outDir", outDir, "--logLevel", "error"],
      {
        cwd: webRoot,
        encoding: "utf-8",
        env: { ...process.env, NODE_ENV: nodeEnv },
      }
    );

    expect(result.status, result.stderr).toBe(0);

    const worker = spawnSync(
      vite,
      [
        "build",
        "--ssr",
        "src/worker.ts",
        "--sourcemap",
        "--outDir",
        path.join(outDir, "worker"),
        "--logLevel",
        "error",
      ],
      {
        cwd: webRoot,
        encoding: "utf-8",
        env: { ...process.env, NODE_ENV: nodeEnv },
      }
    );

    expect(worker.status, worker.stderr).toBe(0);
    expect(readFileSync(path.join(outDir, "index.html"), "utf-8")).toContain(
      "<h1>Rat Stack</h1>"
    );

    const contentRoot = path.resolve(webRoot, "../mischief/dist/content");

    const manifest = Schema.decodeUnknownSync(
      Schema.fromJsonString(ContentAssetManifest)
    )(readFileSync(path.join(contentRoot, "manifest.json"), "utf-8"));

    const preparedPages = decodeReaderPages(
      readFileSync(path.join(webRoot, "dist/reader-pages.json"), "utf-8")
    );

    for (const image of manifest.images.filter((asset) =>
      preparedPages.some(
        (page) =>
          new URL(page.page.metadata.ogImagePath, page.origin).pathname ===
            asset ||
          (page.page.path !== "/" && asset.startsWith(`${page.page.path}/`))
      )
    )) {
      expect(readFileSync(path.join(outDir, image.slice(1))), image).toEqual(
        readFileSync(
          path.join(contentRoot, "assets", manifest.generation, image.slice(1))
        )
      );
    }

    const maps = globSync("**/*.map", { cwd: outDir });

    const sources = maps.flatMap((file) =>
      decodeSourceMap(
        readFileSync(path.join(outDir, file), "utf-8")
      ).sources.map((source) =>
        path
          .relative(webRoot, path.resolve(outDir, path.dirname(file), source))
          .split(path.sep)
          .join("/")
          .replace(/\?.*$/u, "")
      )
    );

    const emitted = globSync("**/*.js", { cwd: outDir }).map((file) => {
      const code = readFileSync(path.join(outDir, file), "utf-8");

      return {
        full: code,
        runtime: readerCodeWithoutPageData(code, preparedPages),
      };
    });

    return {
      sources: new Set(sources),
      strings: forbiddenStrings.filter((text) =>
        emitted.some((code) =>
          (text === "rat-test-person-password"
            ? code.full
            : code.runtime
          ).includes(text)
        )
      ),
    };
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
};

const devtoolsModules = (sources: ReadonlySet<string>) =>
  [...sources].filter((source) =>
    forbiddenModules.some((prefix) => source.includes(prefix))
  );

const BUILD = 60_000;

describe("production bundle", () => {
  it(
    "statically renders home and excludes server devtools from browser and Worker output",
    () => {
      const { sources, strings } = build("production");

      expect(sources.has("src/server/backend.ts")).toBe(true);
      expect(devtoolsModules(sources)).toEqual([]);
      expect(strings).toEqual([]);
    },
    BUILD
  );

  it(
    "would contain them in a development build, so the checks can fail",
    () => {
      const { sources, strings } = build("development");

      expect(sources.has("src/dev/backend.ts")).toBe(true);
      expect(sources.has("src/dev/features/overlay/overlay.ts")).toBe(true);
      expect(
        [...sources].some((source) =>
          source.startsWith("../../packages/devtools/")
        )
      ).toBe(true);
      expect(strings).toEqual(forbiddenStrings);
    },
    BUILD
  );
});
