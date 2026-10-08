// @effect-diagnostics nodeBuiltinImport:off asyncFunction:off newPromise:off globalTimers:off -- Black-box tests of the published ratstack package: they spawn dist/npm/ratstack as npm would install it and assert on its files, stdout, and an MCP stdio conversation. Node built-ins and a Promise-based stdio conversation are the right tools at that boundary.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

const decodePack = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Tuple([
      Schema.Struct({
        files: Schema.Array(Schema.Struct({ path: Schema.String })),
        name: Schema.String,
        version: Schema.String,
      }),
    ])
  )
);

const decodeJsonRpcResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optional(Schema.Number),
      result: Schema.optional(Schema.Unknown),
    })
  )
);

const decodeToolsList = Schema.decodeUnknownSync(
  Schema.Struct({
    tools: Schema.Array(Schema.Struct({ name: Schema.String })),
  })
);

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

const toolNames = async (): Promise<readonly string[]> =>
  // oxlint-disable-next-line promise/avoid-new -- A child process conversation has no library Promise to return.
  await new Promise<readonly string[]>((resolve, reject) => {
    const child = spawn(binPath, ["mcp"], { stdio: ["pipe", "pipe", "pipe"] });
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
          resolve(
            decodeToolsList(message.result).tools.map((tool) => tool.name)
          );
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
  it("packs the launcher, one self-contained bundle, its licenses, and the CLI version", () => {
    const [pack] = decodePack(
      spawnSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: packageDir,
        encoding: "utf-8",
      }).stdout
    );

    expect(pack.name).toBe("ratstack");
    expect(pack.version).toBe(VERSION);
    expect(pack.files.map((file) => file.path).toSorted()).toStrictEqual([
      "README.md",
      "THIRD_PARTY_LICENSES.md",
      "package.json",
      "ratstack",
      "ratstack.js",
    ]);
    expect(
      readFileSync(path.join(packageDir, "THIRD_PARTY_LICENSES.md"), "utf-8")
    ).toContain("## effect@");
    expect(runRatstack(["--version"]).stdout).toContain(VERSION);
  });

  it("contains no devtools, test people, or code-mode sandbox", () => {
    const bundle = readFileSync(path.join(packageDir, "ratstack.js"), "utf-8");

    for (const marker of [
      "packages/devtools",
      "rat_call",
      "rat_test_person",
      "sandbox-subprocess",
    ]) {
      expect(bundle).not.toContain(marker);
    }
  });

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

  it("serves exactly the local learn tools over MCP", async () => {
    const names = await toolNames();

    expect(names.toSorted()).toStrictEqual(learnNames.toSorted());
  });
});
