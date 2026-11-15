// @effect-diagnostics nodeBuiltinImport:off -- These seam tests create local artifacts and spawn the report CLI.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { summarize } from "./turbo-summary.ts";

const task = (
  taskId: string,
  status: string,
  source: string,
  duration = 20
) => ({
  taskId,
  command: "node task.js",
  cache: { status, local: source === "local", remote: source === "remote" },
  execution: { startTime: 100, endTime: 100 + duration, exitCode: 0 },
});

const run = (tasks: readonly unknown[]) => ({
  id: "run-1",
  version: "1",
  turboVersion: "2.11.11",
  scm: { sha: "sha-1", branch: "main" },
  execution: { startTime: 100, endTime: 300, exitCode: 0 },
  tasks,
});

await test("cache accounting partitions runnable tasks across every cache-state combination", () => {
  for (const status of ["HIT", "MISS", "BYPASS"]) {
    for (const source of ["local", "remote", "none"]) {
      const row = summarize(
        JSON.stringify(run([task("a#test", status, source)])),
        "local"
      );

      assert.ok(row);

      const hits = row.hits.local + row.hits.remote + row.hits.unknown;

      assert.equal(hits + row.misses + row.bypasses, row.taskCount);
      assert.equal(hits, status === "HIT" ? 1 : 0);
      assert.equal(
        row.hits.local,
        status === "HIT" && source === "local" ? 1 : 0
      );
      assert.equal(
        row.hits.remote,
        status === "HIT" && source === "remote" ? 1 : 0
      );
      assert.equal(row.hitRate, hits / row.taskCount);
    }
  }
});

await test("summary seam distinguishes hit sources, excludes phantom tasks and ranks elapsed execution", () => {
  const tasks = [
    task("a#build", "HIT", "local", 1),
    task("b#build", "HIT", "remote", 2),
    ...Array.from({ length: 6 }, (_, index) =>
      task(`p${index}#test`, "MISS", "none", 10 + index)
    ),
    {
      ...task("phantom#check", "MISS", "none", 1000),
      command: "<NONEXISTENT>",
    },
  ];

  const row = summarize(JSON.stringify(run(tasks)), "local");

  assert.ok(row);
  assert.deepEqual(row.hits, { local: 1, remote: 1, unknown: 0 });
  assert.equal(row.misses, 6);
  assert.equal(row.taskCount, 8);
  assert.equal(row.wallTimeMs, 200);
  assert.equal(row.sha, "sha-1");
  assert.equal(row.ref, "main");
  assert.deepEqual(
    row.slowest.map((entry) => entry.task),
    ["p5#test", "p4#test", "p3#test", "p2#test", "p1#test"]
  );
  assert.deepEqual(
    row.slowest.map((entry) => entry.durationMs),
    [15, 14, 13, 12, 11]
  );
});

await test("failed and interrupted executions never turn into a successful zero-duration run", () => {
  const row = summarize(
    JSON.stringify({
      ...run([
        { ...task("a#test", "MISS", "none"), execution: { startTime: 100 } },
      ]),
      execution: { startTime: 100 },
    }),
    "local"
  );

  assert.ok(row);
  assert.equal(row.wallTimeMs, null);
  assert.equal(row.exitCode, null);
  assert.deepEqual(row.slowest, []);
  assert.equal(
    summarize(
      JSON.stringify({
        ...run([]),
        execution: { startTime: 100, endTime: 150, exitCode: 1 },
      }),
      "local"
    )?.exitCode,
    1
  );
});

await test("unsupported, malformed and dry-run artifacts are not counted as runs", () => {
  assert.equal(summarize("not json", "local"), null);
  assert.equal(
    summarize(JSON.stringify({ ...run([]), version: "2" }), "local"),
    null
  );
  assert.equal(
    summarize(JSON.stringify({ ...run([]), execution: undefined }), "local"),
    null
  );
  assert.equal(
    summarize(JSON.stringify(run([task("a", "NEW_STATUS", "none")])), "local"),
    null
  );

  const empty = summarize(JSON.stringify(run([])), "local");

  assert.ok(empty);
  assert.equal(empty.taskCount, 0);
  assert.equal(empty.hitRate, 0);
});

const cli = (directory: string, ...args: readonly string[]) =>
  spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("turbo-summary-report.ts", import.meta.url)),
      "--surface",
      "nightly",
      directory,
      ...args,
    ],
    { encoding: "utf-8" }
  );

await test("CLI emits safe JSONL for each valid run and keeps going after malformed artifacts", (t) => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "ratstack-turbo-summary-")
  );

  t.after(() => {
    rmSync(directory, { recursive: true });
  });

  const secret = "PRIVATE_VALUE_MUST_NOT_APPEAR";

  const first = {
    ...run([task("a#test", "MISS", "none")]),
    globalCacheInputs: { environmentVariables: { token: secret } },
    user: secret,
  };

  const second = { ...run([]), id: "run-2" };

  writeFileSync(path.join(directory, "a.json"), JSON.stringify(first));
  writeFileSync(path.join(directory, "b.json"), secret);
  writeFileSync(path.join(directory, "c.json"), JSON.stringify(second));

  const result = cli(directory, "--ref", "refs/pull/42/merge");

  const expected = [first, second]
    .map((value) =>
      JSON.stringify(
        summarize(JSON.stringify(value), "nightly", "refs/pull/42/merge")
      )
    )
    .join("\n");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${expected}\n`);
  assert.match(result.stderr, /b\.json is invalid/u);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
});

await test("missing or empty directories warn without inventing data or failing the gate", (t) => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "ratstack-turbo-summary-empty-")
  );

  t.after(() => {
    rmSync(directory, { recursive: true });
  });

  for (const target of [directory, path.join(directory, "missing")]) {
    const result = cli(target);

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Fix:/u);
  }
});
