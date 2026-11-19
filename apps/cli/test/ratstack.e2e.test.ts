// @effect-diagnostics nodeBuiltinImport:off asyncFunction:off newPromise:off globalTimers:off -- Black-box tests of the published ratstack package: they spawn dist/npm/ratstack as npm would install it and assert on its files, stdout, and an MCP stdio conversation. Node built-ins and a Promise-based stdio conversation are the right tools at that boundary.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { localLearnCapabilities } from "@rat-stack/learn/local";
import { Schema } from "effect";

import { VERSION } from "../src/version.js";

const packageDir = path.resolve(import.meta.dirname, "..", "dist", "npm");

const binPath = path.join(packageDir, "ratstack");

const learnNames = localLearnCapabilities.map(
  (capability) => capability.contract.name
);

const PackEntry = Schema.Struct({
  filename: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String })),
  name: Schema.String,
  version: Schema.String,
});

const decodePackOutput = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Tuple([PackEntry]),
      Schema.Struct({ ratstack: PackEntry }),
    ])
  )
);

const decodePack = (stdout: string) => {
  const output = decodePackOutput(stdout);

  return "ratstack" in output ? output.ratstack : output[0];
};

const verifyPackedFiles = (archive: string, files: readonly string[]) => {
  const chunkPath = /^assets\/[\w-]+\.js$/u;
  const chunks = files.filter((file) => chunkPath.test(file));

  expect(chunks.length).toBeGreaterThan(0);
  expect(
    files.filter((file) => !chunkPath.test(file)).toSorted()
  ).toStrictEqual([
    "README.md",
    "THIRD_PARTY_LICENSES.md",
    "package.json",
    "ratstack",
    "ratstack.js",
  ]);

  const readMember = (file: string) =>
    execFileSync("tar", ["-xOf", archive, `package/${file}`], {
      encoding: "utf-8",
      maxBuffer: Number.POSITIVE_INFINITY,
    });

  expect(readMember("THIRD_PARTY_LICENSES.md")).toContain("## effect@");

  for (const file of ["ratstack.js", ...chunks]) {
    const source = readMember(file);

    for (const marker of [
      "packages/devtools",
      "rat_call",
      "rat_test_person",
      "sandbox-subprocess",
    ]) {
      expect(source.includes(marker), `${file} contains ${marker}`).toBe(false);
    }
  }
};

const decodeJsonRpcResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optional(Schema.Finite),
      result: Schema.optional(Schema.Unknown),
    })
  )
);

const toolsList = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      outputSchema: Schema.optionalKey(
        Schema.Struct({ type: Schema.optionalKey(Schema.String) })
      ),
    })
  ),
});

const decodeToolsList = Schema.decodeUnknownSync(toolsList);

const decodePreferences = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ visual: Schema.String, width: Schema.String })
  )
);

const runRatstack = (arguments_: readonly string[], directory = packageDir) =>
  spawnSync(binPath, arguments_, {
    encoding: "utf-8",
    env: { ...process.env, RAT_LEARN_DIRECTORY: directory },
  });

const listTools = async (
  launcher: string,
  cwd: string
): Promise<typeof toolsList.Type.tools> =>
  // oxlint-disable-next-line promise/avoid-new -- A child process conversation has no library Promise to return.
  await new Promise<typeof toolsList.Type.tools>((resolve, reject) => {
    const child = spawn(launcher, ["mcp"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ratstack mcp timed out with stdout: ${buffer}`));
    }, 15_000);

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const message = line.trim() === "" ? null : decodeJsonRpcResponse(line);

        if (message?.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(decodeToolsList(message.result).tools);
        }
      }
    });
    child.on("error", reject);

    for (const message of [
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "e2e", version: "0.0.0" },
          protocolVersion: "2025-06-18",
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { id: 2, jsonrpc: "2.0", method: "tools/list" },
    ]) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  });

describe("published ratstack package", () => {
  it("lists exactly the local learn commands and mcp", () => {
    const help = runRatstack(["--help"]).stdout;

    const subcommands = help
      .slice(help.indexOf("SUBCOMMANDS"))
      .split("\n")
      .slice(1)
      .flatMap((line) => {
        const name = /^ {2}(?<name>\S+)/u.exec(line)?.groups?.name;

        return name === undefined ? [] : [name];
      });

    expect(subcommands.toSorted()).toStrictEqual(
      [...learnNames, "mcp"].toSorted()
    );
  });

  it("reads and changes local preferences without a checkout or the network", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ratstack-e2e-"));

    try {
      expect(
        decodePreferences(runRatstack(["learnPreferences"], directory).stdout)
      ).toMatchObject({ visual: "inline-text", width: "narrow" });

      runRatstack(["learnSetPreferences", "--width", "wide"], directory);

      expect(
        decodePreferences(runRatstack(["learnPreferences"], directory).stdout)
      ).toMatchObject({ width: "wide" });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("runs the installed tarball and serves exactly the local learn tools over MCP", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ratstack-pack-"));

    try {
      const pack = decodePack(
        execFileSync(
          "npm",
          ["pack", "--json", "--pack-destination", directory],
          {
            cwd: packageDir,
            encoding: "utf-8",
          }
        )
      );

      expect(pack.name).toBe("ratstack");
      expect(pack.version).toBe(VERSION);

      const archive = path.join(directory, pack.filename);

      verifyPackedFiles(
        archive,
        pack.files.map((file) => file.path)
      );

      execFileSync(
        "npm",
        [
          "install",
          "--offline",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--no-package-lock",
          archive,
        ],
        { cwd: directory }
      );

      const launcher = path.join(directory, "node_modules", ".bin", "ratstack");
      expect(
        execFileSync(launcher, ["--version"], {
          cwd: directory,
          encoding: "utf-8",
        })
      ).toContain(VERSION);

      const tools = await listTools(launcher, directory);
      expect(tools.map((tool) => tool.name).toSorted()).toStrictEqual(
        learnNames.toSorted()
      );

      for (const name of ["learnCard", "learnNext"]) {
        expect(
          tools.find((tool) => tool.name === name)?.outputSchema?.type
        ).toBe("object");
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
