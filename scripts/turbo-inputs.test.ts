import assert from "node:assert/strict";
import test from "node:test";

import { fenceMessage } from "../packages/core/test/fixtures/fence-message.ts";
import {
  execFileSync,
  mkdtempSync,
  mkdirSync,
  os,
  path,
  rmSync,
  writeFileSync,
} from "./turbo-inputs-io.ts";
import { audit as inspectAudit } from "./turbo-inputs.ts";

const audit = (...args: Parameters<typeof inspectAudit>) => {
  const result = inspectAudit(...args);

  for (const failure of result.failures) {
    assert.notEqual(fenceMessage(failure), undefined, failure);
  }

  return result;
};

const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "turbo-inputs-"));

  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "nodenext",
        moduleResolution: "nodenext",
        noEmit: true,
      },
      include: [],
    }),
    "packages/probe/package.json": JSON.stringify({
      name: "@probe/test",
      type: "module",
    }),
    "packages/probe/tsconfig.json": JSON.stringify({
      extends: "../../tsconfig.json",
      include: ["src/**/*.ts", "test/**/*.ts"],
    }),
    "packages/probe/vitest.config.ts":
      'import "./vitest-helper.js"; export default { test: { include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"], globalSetup: "test/global.ts" } };',
    "packages/probe/vitest-helper.ts": 'export const helper = "helper";',
    "packages/probe/test/main.test.ts":
      'import "../src/value.js"; import { readFileSync } from "node:fs"; export const data = readFileSync(new URL("../../../.brain/data/fixture.json", import.meta.url));',
    "packages/probe/test/setup.ts": 'export const setup = "setup";',
    "packages/probe/test/global.ts": "export default () => undefined;",
    "packages/probe/src/value.ts": "export const value = 1;",
    ".brain/data/fixture.json": '{"value":1}',
  };

  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }

  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["add", "--", ...Object.keys(files)], { cwd: root });

  const graph = (omitted?: string, taskName = "test") => ({
    tasks: [
      {
        taskId: `@probe/test#${taskName}`,
        directory: "packages/probe",
        command:
          taskName === "test" ? "vitest run" : "tsc --noEmit -p tsconfig.json",
        dependencies: [],
        outputs: [],
        inputs: Object.fromEntries(
          Object.keys(files)
            .filter((file) => file !== omitted)
            .map((file) => [path.relative("packages/probe", file), "hash"])
        ),
        resolvedTaskDefinition: { inputs: ["$TURBO_DEFAULT$"] },
      },
    ],
  });

  return { root, graph };
};

await test("each config, include, setup, import and runtime fixture must be hashed", (context) => {
  const { root, graph } = fixture();

  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  assert.deepEqual(audit(root, graph()).failures, []);

  for (const file of [
    "packages/probe/vitest.config.ts",
    "packages/probe/vitest-helper.ts",
    "packages/probe/test/main.test.ts",
    "packages/probe/test/setup.ts",
    "packages/probe/test/global.ts",
    "packages/probe/src/value.ts",
    ".brain/data/fixture.json",
  ]) {
    const result = audit(root, graph(file));

    assert.ok(
      result.failures.some((failure) =>
        failure.includes(`does not hash ${file}.`)
      ),
      file
    );
    assert.ok(
      result.failures.every((failure) => fenceMessage(failure) !== undefined)
    );
  }
});

await test("runtime fixture joins, directory reads and glob selectors retain their repository root", (context) => {
  const { root, graph } = fixture();

  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  for (const source of [
    'import { readFileSync } from "node:fs"; import path from "node:path"; const directory = new URL("../../../.brain/data/", import.meta.url).pathname; export const data = readFileSync(path.join(directory, "fixture.json"));',
    'import { globSync } from "node:fs"; export const data = globSync("*.json", { cwd: new URL("../../../.brain/data/", import.meta.url).pathname });',
    'import { readdirSync } from "node:fs"; export const data = readdirSync(new URL("../../../.brain/data/", import.meta.url).pathname);',
    'export const data = import.meta.glob("../../../.brain/data/*.json");',
    'import { readFileSync } from "node:fs"; import path from "node:path"; const directory = path.dirname(import.meta.filename); export const data = readFileSync(path.resolve(directory, "../../../.brain/data/fixture.json"));',
  ]) {
    writeFileSync(path.join(root, "packages/probe/test/main.test.ts"), source);
    assert.deepEqual(audit(root, graph()).failures, []);
    assert.ok(
      audit(root, graph(".brain/data/fixture.json")).failures.some((failure) =>
        failure.includes("does not hash .brain/data/fixture.json.")
      )
    );
  }
});

await test("literal runtime reads preserve brackets and braces in filenames", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  for (const name of ["[id].ts", "{x}.json"]) {
    const relative = `packages/probe/src/${name}`;
    writeFileSync(path.join(root, relative), "");
    writeFileSync(
      path.join(root, "packages/probe/test/main.test.ts"),
      `import { readFileSync } from "node:fs"; readFileSync(new URL(${JSON.stringify(`../src/${name}`)}, import.meta.url));`
    );

    const missing = graph();

    const covered = {
      tasks: missing.tasks.map((task) => ({
        ...task,
        inputs: { ...task.inputs, [`src/${name}`]: "hash" },
      })),
    };

    assert.deepEqual(audit(root, covered).failures, []);
    assert.ok(
      audit(root, missing).failures.some((failure) =>
        failure.includes(`does not hash ${relative}.`)
      )
    );
  }
});

await test("an explicit Vitest config is hashed even when the default config remains present", (context) => {
  const { root, graph } = fixture();

  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "packages/probe/custom.config.ts"),
    'export default { test: { setupFiles: ["test/setup.ts"] } };'
  );

  const selected = {
    tasks: graph().tasks.map((task) => ({
      ...task,
      command: "vitest run --config=custom.config.ts",
    })),
  };

  assert.ok(
    audit(root, selected).failures.some((failure) =>
      failure.includes("does not hash packages/probe/custom.config.ts.")
    )
  );

  const covered = {
    tasks: selected.tasks.map((task) => ({
      ...task,
      inputs: { ...task.inputs, "custom.config.ts": "hash" },
    })),
  };

  assert.deepEqual(audit(root, covered).failures, []);
});

await test("imported path constants count as inputs only when used by a runtime reader", (context) => {
  const { root, graph } = fixture();

  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "packages/probe/src/value.ts"),
    'export const dataFile = ".brain/data/fixture.json";'
  );
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import { dataFile as input } from "../src/value.js"; import { readFileSync } from "node:fs"; export const value = readFileSync(input);'
  );
  assert.deepEqual(audit(root, graph()).failures, []);
  assert.ok(
    audit(root, graph(".brain/data/fixture.json")).failures.some((failure) =>
      failure.includes("does not hash .brain/data/fixture.json.")
    )
  );
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import { dataFile } from "../src/value.js"; export const value = { errorLabel: dataFile };'
  );
  assert.deepEqual(audit(root, graph(".brain/data/fixture.json")).failures, []);
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import { dataFile } from "../src/value.js"; import { readFileSync } from "node:fs"; export const label = { errorLabel: dataFile }; export const value = readFileSync(dataFile);'
  );
  assert.deepEqual(audit(root, graph()).failures, []);
  const labelThenRead = audit(root, graph(".brain/data/fixture.json")).failures;

  context.diagnostic(`Label-then-read omission: ${labelThenRead.join("\n")}`);
  assert.ok(
    labelThenRead.some((failure) =>
      failure.includes("does not hash .brain/data/fixture.json.")
    )
  );
});

await test("unlisted computed paths and directory-loop reads fail closed", (context) => {
  const { root, graph } = fixture();

  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  for (const source of [
    'import { readFileSync } from "node:fs"; import path from "node:path"; const dir = process.argv[2]; const name = process.argv[3]; export const data = readFileSync(path.join(dir, name));',
    'import { readFileSync, readdirSync } from "node:fs"; import path from "node:path"; const directory = new URL("../../../.brain/data/", import.meta.url).pathname; for (const name of readdirSync(directory)) { readFileSync(path.join(directory, name)); }',
  ]) {
    writeFileSync(path.join(root, "packages/probe/test/main.test.ts"), source);
    const { failures } = audit(root, graph());

    context.diagnostic(`Unresolved read mutation: ${failures.join("\n")}`);
    assert.ok(
      failures.some((failure) =>
        failure.includes("has an unresolved runtime read.")
      )
    );
    assert.ok(failures.every((failure) => failure.includes(". Fix: ")));
  }
});

await test("dropping a Markdown fixture input fails even when its source is covered", (context) => {
  const { root, graph } = fixture();

  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "packages/probe/test/fixture.md"),
    "# Fixture\n"
  );
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import { readFileSync } from "node:fs"; export const data = readFileSync(new URL("./fixture.md", import.meta.url));'
  );

  const included = {
    tasks: graph().tasks.map((task) => ({
      ...task,
      inputs: { ...task.inputs, "test/fixture.md": "hash" },
    })),
  };

  assert.deepEqual(audit(root, included).failures, []);
  const missingMarkdown = audit(root, graph()).failures;

  context.diagnostic(`Markdown omission: ${missingMarkdown.join("\n")}`);
  assert.ok(
    missingMarkdown.some((failure) =>
      failure.includes("does not hash packages/probe/test/fixture.md.")
    )
  );
});

await test("a bounded reader requires its own input or a real ancestor edge", (context) => {
  const { root, graph } = fixture();

  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const source = "packages/core/test/cafe-people.test.ts";
  const data = ".brain/data/cafe/people.json";

  mkdirSync(path.join(root, "packages/core/test"), { recursive: true });
  mkdirSync(path.join(root, ".brain/data/cafe"), { recursive: true });
  writeFileSync(
    path.join(root, source),
    'import { readFileSync } from "node:fs"; export const value = readFileSync(process.argv[2]);'
  );
  writeFileSync(path.join(root, data), "[]");
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import "../../core/test/cafe-people.test.js";'
  );

  const own = {
    tasks: graph().tasks.map((task) => ({
      ...task,
      inputs: {
        ...task.inputs,
        [path.relative(task.directory, source)]: "hash",
        [path.relative(task.directory, data)]: "hash",
      },
    })),
  };

  assert.deepEqual(audit(root, own).failures, []);
  assert.ok(
    audit(root, own).listedReads.some((entry) =>
      entry.includes("via own input")
    )
  );

  const without = own.tasks.map((task) => ({
    ...task,
    inputs: Object.fromEntries(
      Object.entries(task.inputs).filter(
        ([file]) => file !== path.relative(task.directory, data)
      )
    ),
  }));

  const ownMissing = audit(root, { tasks: without }).failures;

  context.diagnostic(`Bounded input omission: ${ownMissing.join("\n")}`);
  assert.ok(
    ownMissing.some((failure) =>
      failure.includes("does not cover bounded runtime root")
    )
  );

  const ancestor = {
    taskId: "@probe/producer#build",
    directory: "",
    command: "<NONEXISTENT>",
    dependencies: [],
    outputs: [],
    inputs: { [data]: "hash" },
    resolvedTaskDefinition: { inputs: [] },
  };

  const throughAncestor = {
    tasks: [
      ...without.map((task) => ({ ...task, dependencies: [ancestor.taskId] })),
      ancestor,
    ],
  };

  assert.deepEqual(audit(root, throughAncestor).failures, []);
  assert.ok(
    audit(root, throughAncestor).listedReads.some((entry) =>
      entry.includes("via ancestor input")
    )
  );

  const throughOutput = {
    tasks: [
      ...without.map((task) => ({ ...task, dependencies: [ancestor.taskId] })),
      { ...ancestor, inputs: {}, outputs: [".brain/data/cafe/**"] },
    ],
  };

  assert.deepEqual(audit(root, throughOutput).failures, []);
  assert.ok(
    audit(root, throughOutput).listedReads.some((entry) =>
      entry.includes("via ancestor output")
    )
  );

  execFileSync("git", ["add", "--", data], { cwd: root });
  const trackedOutput = audit(root, throughOutput).failures;
  assert.ok(
    trackedOutput.some((failure) =>
      failure.includes("does not cover bounded runtime root")
    )
  );

  const edgeMissing = audit(root, { tasks: [...without, ancestor] }).failures;

  context.diagnostic(`Ancestor edge omission: ${edgeMissing.join("\n")}`);
  assert.ok(
    edgeMissing.some((failure) =>
      failure.includes("does not cover bounded runtime root")
    )
  );
});

await test("computed Vitest selectors fail closed instead of claiming coverage", (context) => {
  const { root, graph } = fixture();

  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "packages/probe/vitest.config.ts"),
    'const select = () => "test/setup.ts"; export default { test: { setupFiles: [select()] } };'
  );
  assert.ok(
    audit(root, graph()).failures.some((failure) =>
      failure.includes("has an unresolved Vitest file selector.")
    )
  );
});

await test("a flat Vitest shard can omit its excluded files, but not an active file or an import", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const config = path.join(root, "packages/probe/vitest.config.ts");
  const runner = "packages/probe/test/runtime.test.ts";

  const writeConfig = (exclude: string) => {
    writeFileSync(
      config,
      `import { omit } from "./vitest-helper.js"; export default { test: { include: ["test/**/*.test.ts"], exclude: [${exclude}] } };`
    );
  };

  writeFileSync(
    path.join(root, "packages/probe/vitest-helper.ts"),
    'export const omit = "test/{main,other}.test.ts";'
  );
  writeFileSync(path.join(root, runner), "export {};");

  const missingExcluded = graph("packages/probe/test/main.test.ts");

  const withRuntime = (sourceGraph: ReturnType<typeof graph>) => ({
    tasks: sourceGraph.tasks.map((task) => ({
      ...task,
      inputs: { ...task.inputs, "test/runtime.test.ts": "hash" },
    })),
  });

  const covered = withRuntime(missingExcluded);

  writeConfig("omit");

  assert.deepEqual(audit(root, covered).failures, []);
  assert.ok(
    audit(root, missingExcluded).failures.some((failure) =>
      failure.includes(`does not hash ${runner}.`)
    )
  );

  for (const file of ["vitest.config.ts", "vitest-helper.ts"]) {
    const omitted = `packages/probe/${file}`;

    assert.ok(
      audit(root, withRuntime(graph(omitted))).failures.some((failure) =>
        failure.includes(`does not hash ${omitted}.`)
      )
    );
  }

  writeFileSync(path.join(root, runner), 'import "./main.test.js";');
  assert.ok(
    audit(root, covered).failures.some((failure) =>
      failure.includes("does not hash packages/probe/test/main.test.ts.")
    )
  );

  writeFileSync(path.join(root, runner), "export {};");

  for (const exclude of [
    "omit.toLowerCase()",
    '"!test/main.test.ts"',
    '"test/@(main|other).test.ts"',
    '"test/[mo]*.test.ts"',
    '"test/mai?.test.ts"',
  ]) {
    writeConfig(exclude);
    assert.ok(
      audit(root, covered).failures.some((failure) =>
        failure.includes("has an unresolved Vitest file selector.")
      ),
      exclude
    );
  }
});

await test("local import variants and query assets require real inputs", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "packages/probe/package.json"),
    JSON.stringify({
      name: "@probe/test",
      type: "module",
      imports: { "#value": { development: "./src/value.ts" } },
      exports: { "./wild/*": "./src/*.ts" },
    })
  );
  writeFileSync(
    path.join(root, "packages/probe/tsconfig.json"),
    JSON.stringify({
      extends: "../../tsconfig.json",
      compilerOptions: { baseUrl: ".", paths: { "alias/*": ["src/*.ts"] } },
      include: ["src/**/*.ts", "test/**/*.ts"],
    })
  );

  for (const specifier of [
    "../src/value.js",
    "#value",
    "@probe/test/wild/value",
    "alias/value",
  ]) {
    for (const source of [
      `import ${JSON.stringify(specifier)};`,
      `export const value = import(${JSON.stringify(specifier)});`,
      `export const value = require(${JSON.stringify(specifier)});`,
    ]) {
      writeFileSync(
        path.join(root, "packages/probe/test/main.test.ts"),
        source
      );
      assert.deepEqual(audit(root, graph()).failures, [], source);
      assert.ok(
        audit(root, graph("packages/probe/src/value.ts")).failures.some(
          (failure) =>
            failure.includes("does not hash packages/probe/src/value.ts.")
        ),
        source
      );
    }
  }

  for (const specifier of [
    "./missing.js",
    "#missing",
    "@probe/test/missing",
    "@probe/test/wild/missing",
    "@probe/missing",
    "alias/missing",
  ]) {
    writeFileSync(
      path.join(root, "packages/probe/test/main.test.ts"),
      `import ${JSON.stringify(specifier)};`
    );
    assert.ok(
      audit(root, graph()).failures.some((failure) =>
        failure.includes("cannot resolve local import")
      ),
      specifier
    );
  }

  writeFileSync(path.join(root, "packages/probe/src/fixture.md"), "# Asset\n");

  for (const query of ["raw", "url", "inline"]) {
    writeFileSync(
      path.join(root, "packages/probe/test/main.test.ts"),
      `import "../src/fixture.md?${query}";`
    );

    const included = {
      tasks: graph().tasks.map((task) => ({
        ...task,
        inputs: { ...task.inputs, "src/fixture.md": "hash" },
      })),
    };

    assert.deepEqual(audit(root, included).failures, []);
    assert.ok(
      audit(root, graph()).failures.some((failure) =>
        failure.includes("does not hash packages/probe/src/fixture.md.")
      )
    );
    assert.ok(
      audit(root, graph(undefined, "build")).failures.some((failure) =>
        failure.includes("does not hash packages/probe/src/fixture.md.")
      )
    );
  }
});

await test("inherited alias settings are hashed and ambiguous base overrides fail closed", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "tsconfig.paths.json"),
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: {
        baseUrl: ".",
        paths: { "inherited/*": ["packages/probe/src/*.ts"] },
      },
    })
  );
  writeFileSync(
    path.join(root, "packages/probe/tsconfig.json"),
    JSON.stringify({
      extends: "../../tsconfig.paths.json",
      include: ["src/**/*.ts", "test/**/*.ts"],
    })
  );
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import "inherited/value";'
  );

  const covered = {
    tasks: graph().tasks.map((task) => ({
      ...task,
      inputs: { ...task.inputs, "../../tsconfig.paths.json": "hash" },
    })),
  };

  assert.deepEqual(audit(root, covered).failures, []);
  assert.ok(
    audit(root, graph()).failures.some((failure) =>
      failure.includes("does not hash tsconfig.paths.json.")
    )
  );
  writeFileSync(
    path.join(root, "packages/probe/tsconfig.json"),
    JSON.stringify({
      extends: "../../tsconfig.paths.json",
      compilerOptions: { baseUrl: "." },
      include: ["src/**/*.ts", "test/**/*.ts"],
    })
  );
  assert.ok(
    audit(root, covered).failures.some((failure) =>
      failure.includes("cannot resolve local import")
    )
  );
});

await test("generated imports need an untracked path, ancestor output and declared covered root", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const source = "apps/web/test/reader-worker-first-head.test.ts";
  const generated = "apps/web/dist/server/fetch.js";
  mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
  mkdirSync(path.dirname(path.join(root, generated)), { recursive: true });
  writeFileSync(
    path.join(root, source),
    'export const value = import(new URL("../dist/server/fetch.js", import.meta.url).href);'
  );

  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import "../../../apps/web/test/reader-worker-first-head.test.js";'
  );

  const producer = {
    taskId: "@probe/producer#build",
    directory: "",
    command: "<NONEXISTENT>",
    dependencies: [],
    outputs: ["apps/web/dist/**"],
    inputs: {},
    resolvedTaskDefinition: { inputs: [] },
  };

  const consumer = graph().tasks.map((task) => ({
    ...task,
    dependencies: [producer.taskId],
    inputs: { ...task.inputs, [path.relative(task.directory, source)]: "hash" },
  }));

  assert.deepEqual(
    audit(root, { tasks: [...consumer, producer] }).failures,
    []
  );
  writeFileSync(path.join(root, generated), "export default {};");
  const positive = audit(root, { tasks: [...consumer, producer] });
  assert.deepEqual(positive.failures, []);
  assert.ok(
    positive.listedReads.some((entry) =>
      entry.includes("generated-artifact boundary:")
    )
  );

  const noEdge = audit(root, {
    tasks: [
      ...consumer.map((task) => ({ ...task, dependencies: [] })),
      producer,
    ],
  });

  assert.ok(
    noEdge.failures.some((failure) =>
      failure.includes("The compiler did not load this source.")
    )
  );
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'export const value = import(new URL("../../../apps/web/dist/server/fetch.js", import.meta.url).href);'
  );
  assert.ok(
    audit(root, { tasks: [...consumer, producer] }).failures.some((failure) =>
      failure.includes("The compiler did not load this source.")
    )
  );
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import "../../../apps/web/test/reader-worker-first-head.test.js";'
  );
  execFileSync("git", ["add", "--", generated], { cwd: root });
  assert.ok(
    audit(root, { tasks: [...consumer, producer] }).failures.some((failure) =>
      failure.includes("The compiler did not load this source.")
    )
  );
});

await test("cold generated source imports require the declared producer even with JavaScript spelling", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const names = ["bundled-content", "interest-pages", "rat-icons"];
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    names
      .flatMap((name) =>
        ["js", "ts"].map(
          (extension) =>
            `import "../../../apps/site/src/${name}.generated.${extension}";`
        )
      )
      .join("\n")
  );

  const producer = {
    taskId: "@rat-stack/site#generate",
    directory: "apps/site",
    command: "<NONEXISTENT>",
    dependencies: [],
    outputs: names.map((name) => `src/${name}.generated.ts`),
    inputs: {},
    resolvedTaskDefinition: { inputs: [] },
  };

  const consumer = graph().tasks.map((task) => ({
    ...task,
    dependencies: [producer.taskId],
  }));

  const positive = audit(root, { tasks: [...consumer, producer] });
  assert.deepEqual(positive.failures, []);
  assert.equal(
    positive.listedReads.filter((entry) =>
      entry.includes("generated-artifact boundary:")
    ).length,
    names.length
  );
  const noEdge = audit(root, { tasks: [...graph().tasks, producer] });

  const wrongOutput = audit(root, {
    tasks: [...consumer, { ...producer, outputs: ["dist/content/**"] }],
  });

  for (const result of [noEdge, wrongOutput]) {
    for (const name of names) {
      assert.ok(
        result.failures.some((failure) =>
          failure.includes(`${name}.generated.`)
        )
      );
    }
  }

  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import "../../../apps/site/src/unknown.generated.js";'
  );

  const undeclared = audit(root, {
    tasks: [...consumer, { ...producer, outputs: ["src/*.generated.ts"] }],
  });

  assert.ok(
    undeclared.failures.some((failure) =>
      failure.includes("unknown.generated.js")
    )
  );
  mkdirSync(path.join(root, "apps/site/src"), { recursive: true });
  const tracked = "apps/site/src/bundled-content.generated.ts";
  writeFileSync(path.join(root, tracked), "export const value = 1;");
  execFileSync("git", ["add", "--", tracked], { cwd: root });
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import "../../../apps/site/src/bundled-content.generated.js";'
  );
  assert.ok(
    audit(root, { tasks: [...consumer, producer] }).failures.length > 0
  );
});

await test("computed loaders run in build configuration but not typecheck source", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    "export const value = import(process.argv[2]);"
  );
  assert.deepEqual(audit(root, graph(undefined, "typecheck")).failures, []);
  writeFileSync(
    path.join(root, "packages/probe/vite.config.ts"),
    "export const value = import(process.argv[2]);"
  );

  const build = {
    tasks: graph(undefined, "build").tasks.map((task) => ({
      ...task,
      command: "vite build",
      inputs: { ...task.inputs, "vite.config.ts": "hash" },
      resolvedTaskDefinition: { inputs: [] },
    })),
  };

  assert.ok(
    audit(root, build).failures.some((failure) =>
      failure.includes("has an unresolved runtime read.")
    )
  );
  writeFileSync(
    path.join(root, "packages/probe/vite.config.ts"),
    "export default {};"
  );
  assert.deepEqual(audit(root, build).failures, []);
});

await test("variable module loaders need a declared boundary", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  for (const loader of ["import", "require"]) {
    writeFileSync(
      path.join(root, "packages/probe/test/main.test.ts"),
      `const specifier = process.argv[2]; export const value = ${loader}(specifier);`
    );
    assert.ok(
      audit(root, graph()).failures.some((failure) =>
        failure.includes("has an unresolved runtime read.")
      )
    );
  }
});

await test("tracked data cannot be covered only by ancestor outputs", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const producer = {
    taskId: "@probe/producer#build",
    directory: "",
    command: "<NONEXISTENT>",
    dependencies: [],
    outputs: [".brain/**"],
    inputs: {},
    resolvedTaskDefinition: { inputs: [] },
  };

  const result = audit(root, {
    tasks: [
      ...graph(".brain/data/fixture.json").tasks.map((task) => ({
        ...task,
        dependencies: [producer.taskId],
      })),
      producer,
    ],
  });

  assert.ok(
    result.failures.some((failure) =>
      failure.includes("does not hash .brain/data/fixture.json.")
    )
  );
});

await test("missing literal reads require a producer and external literals require a boundary", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import { readFileSync } from "node:fs"; export const value = readFileSync(new URL("../../../.brain/data/generated.json", import.meta.url));'
  );
  assert.ok(
    audit(root, graph()).failures.some((failure) =>
      failure.includes("reads a missing or external path")
    )
  );

  const producer = {
    taskId: "@probe/producer#build",
    directory: "",
    command: "<NONEXISTENT>",
    dependencies: [],
    outputs: [".brain/data/generated.json"],
    inputs: {},
    resolvedTaskDefinition: { inputs: [] },
  };

  assert.deepEqual(
    audit(root, {
      tasks: [
        ...graph().tasks.map((task) => ({
          ...task,
          dependencies: [producer.taskId],
        })),
        producer,
      ],
    }).failures,
    []
  );
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import { readFileSync } from "node:fs"; export const value = readFileSync("/outside-the-repository/fixture.json");'
  );
  assert.ok(
    audit(root, graph()).failures.some((failure) =>
      failure.includes("reads a missing or external path")
    )
  );
});

await test("temporary readers still require their declared repository source roots", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const source = "packages/core/test/no-comments-rule.test.ts";
  const plugin = "scripts/oxlint-plugin-no-comments.ts";
  mkdirSync(path.join(root, "packages/core/test"), { recursive: true });
  mkdirSync(path.join(root, "scripts"));
  writeFileSync(
    path.join(root, source),
    'import { readFileSync } from "node:fs"; export const value = readFileSync(process.argv[2]);'
  );
  writeFileSync(path.join(root, plugin), "export const value = 1;");
  writeFileSync(
    path.join(root, "packages/probe/test/main.test.ts"),
    'import "../../core/test/no-comments-rule.test.js";'
  );

  const included = {
    tasks: graph().tasks.map((task) => ({
      ...task,
      inputs: {
        ...task.inputs,
        [path.relative(task.directory, source)]: "hash",
        [path.relative(task.directory, plugin)]: "hash",
      },
    })),
  };

  assert.deepEqual(audit(root, included).failures, []);

  const dropped = {
    tasks: included.tasks.map((task) => ({
      ...task,
      inputs: Object.fromEntries(
        Object.entries(task.inputs).filter(
          ([file]) => file !== path.relative(task.directory, plugin)
        )
      ),
    })),
  };

  assert.ok(
    audit(root, dropped).failures.some((failure) =>
      failure.includes("does not cover bounded runtime root")
    )
  );
});

await test("ambiguous configs and unloaded sources return fence failures", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "packages/probe/vitest.config.mts"),
    "export default {};"
  );
  assert.ok(
    audit(root, graph()).failures.some((failure) =>
      failure.includes("has multiple default Vitest configurations.")
    )
  );
  rmSync(path.join(root, "packages/probe/vitest.config.mts"));
  writeFileSync(
    path.join(root, "packages/probe/tsconfig.json"),
    JSON.stringify({ extends: "../../tsconfig.json", include: ["src/**/*.ts"] })
  );
  assert.ok(
    audit(root, graph()).failures.some((failure) =>
      failure.includes("The compiler did not load this source.")
    )
  );
});

await test("Vitest project names are not compiler project paths", (context) => {
  const { root, graph } = fixture();
  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(
    path.join(root, "packages/probe/tsc"),
    '{"extends":"./missing-config.json"}'
  );

  for (const option of ["--project", "-p"]) {
    assert.deepEqual(
      audit(root, {
        tasks: graph().tasks.map((task) => ({
          ...task,
          command: `vitest run ${option} tsc`,
        })),
      }).failures,
      []
    );
  }
});

await test("typecheck includes and inherited configs are checked independently of runtime reads", (context) => {
  const { root, graph } = fixture();

  context.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  assert.deepEqual(
    audit(root, graph(".brain/data/fixture.json", "typecheck")).failures,
    []
  );

  for (const file of [
    "tsconfig.json",
    "packages/probe/tsconfig.json",
    "packages/probe/src/value.ts",
    "packages/probe/test/main.test.ts",
  ]) {
    assert.ok(
      audit(root, graph(file, "typecheck")).failures.some((failure) =>
        failure.includes(`does not hash ${file}.`)
      ),
      file
    );
  }
});
