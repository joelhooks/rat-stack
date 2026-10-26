// @effect-diagnostics nodeBuiltinImport:off -- These tests create temporary source fixtures and run the real oxlint binary against them.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const oxlint = path.join(repoRoot, "node_modules/.bin/oxlint");

const plugin = path.join(repoRoot, "scripts/oxlint-plugin-patterns.ts");

const rules = [
  "rat-stack-patterns/acquire-release-constructs-in-acquire-body",
  "rat-stack-patterns/contract-binding-matches-name",
  "rat-stack-patterns/flag-removal-date",
  "rat-stack-patterns/learn-snippet-idiom",
  "rat-stack-patterns/no-module-level-mutable-state",
  "rat-stack-patterns/no-shared-pending-cache",
  "rat-stack-patterns/shared-waiters",
  "rat-stack-patterns/no-sleep-in-loop",
  "rat-stack-patterns/watch-effect-actors",
];

interface LintResult {
  readonly output: string;
  readonly status: number;
}

const lintFixture = (area: string, source: string): LintResult => {
  const directory = mkdtempSync(path.join(tmpdir(), "rat-stack-patterns-"));
  const fixtureDirectory = path.join(directory, area, "pattern-fixtures");
  const config = path.join(directory, "oxlint.json");
  const file = path.join(fixtureDirectory, "fixture.ts");

  mkdirSync(fixtureDirectory, { recursive: true });
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: "rat-stack-patterns", specifier: plugin }],
      rules: Object.fromEntries(rules.map((rule) => [rule, "error"])),
    })
  );
  writeFileSync(file, source);

  try {
    const result = spawnSync(oxlint, ["-c", config, "--no-ignore", file], {
      cwd: repoRoot,
      encoding: "utf-8",
    });

    return {
      output: `${result.stdout}${result.stderr}`,
      status: result.status ?? -1,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

const expectRule = (result: LintResult, message: string) => {
  expect(result.status).not.toBe(0);
  expect(result.output).toContain(message);
};

const expectRuleSoft = (result: LintResult, message: string) => {
  expect.soft(result.status).not.toBe(0);
  expect.soft(result.output).toContain(message);
};

const eagerAcquire = "Build the resource inside acquire";

const moduleState = "Module-level let and var are shared by every request";

describe("rat-stack pattern rules", () => {
  it("keeps sleeping loops in machines without flagging unrelated sleep functions", () => {
    const message = "Move loops that yield Effect.sleep";

    for (const area of ["apps/site/src", "packages/core/src"]) {
      for (const loop of [
        "while (true)",
        "for (;;)",
        "for (const item of items)",
        "for (const key in items)",
      ]) {
        for (const [binding, sleep] of [
          ['import { Effect } from "effect";', "Effect.sleep"],
          ['import { Effect as E } from "effect";', "E.sleep"],
          ['import { sleep as wait } from "effect/Effect";', "wait"],
        ]) {
          expectRule(
            lintFixture(
              area,
              `${binding} function* work() { ${loop} { yield* ${sleep}(1).pipe(identity); } }`
            ),
            message
          );
        }
      }

      expectRule(
        lintFixture(
          area,
          'import { Effect } from "effect"; function* work() { do { yield* Effect.sleep(1); } while (true); }'
        ),
        message
      );

      for (const source of [
        'import { Effect } from "effect"; function* work() { for (;;) { Effect.sleep(1); } }',
        "const Effect = { sleep: () => [] }; function* work() { while (true) { yield* Effect.sleep(1); } }",
        'import { Effect } from "other"; function* work() { for (;;) { yield* Effect.sleep(1); } }',
        'import { Effect } from "effect"; function* work() { yield* Effect.sleep(1); for (;;) { break; } }',
        'import { Effect } from "effect"; for (;;) { const work = function* () { yield* Effect.sleep(1); }; break; }',
      ]) {
        expect(lintFixture(area, source).status).toBe(0);
      }
    }

    expect(
      lintFixture(
        "packages/core/test",
        'import { Effect } from "effect"; function* work() { for (;;) { yield* Effect.sleep(1); } }'
      ).status
    ).toBe(0);
  });
  it("rejects a module-owned waiter even through an Effect runner", () => {
    expectRule(
      lintFixture(
        "apps/site/src",
        'import { Deferred, Effect } from "effect"; export const pending = Effect.runSync(Deferred.make());'
      ),
      "Module-level waiting primitives"
    );
  });
  it("defers Layer construction instead of sharing an eager or already-run value", () => {
    for (const initializer of [
      "Layer.succeed(Tag, Ref.makeUnsafe(0))",
      "Layer.effect(Tag, Effect.runSync(Ref.make(0)))",
    ]) {
      expectRule(
        lintFixture(
          "apps/site/src",
          `import { Effect, Layer, Ref } from "effect"; export const layer = ${initializer};`
        ),
        "Module-level waiting primitives"
      );
    }

    expect(
      lintFixture(
        "apps/site/src",
        'import { Layer, Ref } from "effect"; export const layer = Layer.effect(Tag, Ref.make(0));'
      ).status
    ).toBe(0);
  });

  it("allows only DurableObject instance fields, not static fields or unrelated subclasses", () => {
    for (const declaration of [
      "class Other extends Base { pending = Deferred.makeUnsafe(); }",
      "class Owner extends DurableObject { static pending = Deferred.makeUnsafe(); }",
      "class Other { pending = Deferred.makeUnsafe(); }",
    ]) {
      expectRule(
        lintFixture(
          "apps/site/src",
          `import { Deferred } from "effect"; import { DurableObject } from "cloudflare:workers"; ${declaration}`
        ),
        "Module-level waiting primitives"
      );
    }

    expect(
      lintFixture(
        "apps/site/src",
        'import { Deferred } from "effect"; import { DurableObject as Owner } from "cloudflare:workers"; class State extends Owner { pending = Deferred.makeUnsafe(); }'
      ).status
    ).toBe(0);
  });

  it.each([
    ["Deferred", "make"],
    ["Deferred", "makeUnsafe"],
    ["Cache", "make"],
    ["Cache", "makeWith"],
    ["Ref", "make"],
    ["Ref", "makeUnsafe"],
    ["Semaphore", "make"],
    ["Semaphore", "makeUnsafe"],
    ["Queue", "make"],
    ["Queue", "bounded"],
    ["Queue", "unbounded"],
    ["Queue", "dropping"],
    ["Queue", "sliding"],
    ["Latch", "make"],
    ["Latch", "makeUnsafe"],
    ["PubSub", "make"],
    ["PubSub", "bounded"],
    ["PubSub", "unbounded"],
    ["PubSub", "dropping"],
    ["PubSub", "sliding"],
    ["PartitionedSemaphore", "make"],
    ["PartitionedSemaphore", "makeUnsafe"],
    ["TxSemaphore", "make"],
  ])(
    "keeps %s.%s construction with its invocation owner",
    (primitive, make) => {
      for (const area of ["apps/site/src", "packages/core/src"]) {
        for (const source of [
          `import { ${primitive} as P } from "effect"; export const shared = P.${make}(1);`,
          `import * as P from "effect/${primitive}"; export const shared = P["${make}"](1);`,
          `import { ${make} as construct } from "effect/${primitive}"; export const shared = construct(1);`,
          `import { ${primitive}, Effect } from "effect"; export const shared = await Effect.runPromise(${primitive}.${make}(1));`,
        ]) {
          expectRule(
            lintFixture(area, source),
            "Module-level waiting primitives"
          );
        }

        for (const source of [
          `import { ${primitive} as P, Effect, Layer } from "effect"; export const layer = Layer.effect(Tag, Effect.gen(function* () { const local = yield* P.${make}(1); return local; }));`,
          `import { ${primitive} as P } from "effect"; export const fetch = () => { const local = P.${make}(1); return local; };`,
          `import { ${primitive} as P } from "effect"; import { DurableObject } from "cloudflare:workers"; export class Owner extends DurableObject { pending = P.${make}(1); }`,
          `const ${primitive} = { ${make}: () => 1 }; export const ordinary = ${primitive}.${make}(1);`,
          `import { ${primitive} as P } from "other-library"; export const ordinary = P.${make}(1);`,
        ]) {
          const result = lintFixture(area, source);

          expect(result.output).not.toContain("shared-waiters");
          expect(result.status).toBe(0);
        }
      }

      expect(
        lintFixture(
          "packages/core/test",
          `import { ${primitive} as P } from "effect"; const testState = P.${make}(1);`
        ).status
      ).toBe(0);
    }
  );

  it("rejects missing removal dates through direct, aliased, and namespace declarations", () => {
    const message = "Declare removeBy as a YYYY-MM-DD literal";

    for (const source of [
      'defineFlag("test", Schema.Boolean, { default: false, owner: "test" });',
      'import { defineFlag as flag } from "@rat-stack/core/flags"; flag("test", Schema.Boolean, { default: false, owner: "test" });',
      'import * as flags from "@rat-stack/flags"; flags.defineFlag("test", Schema.Boolean, { default: false, owner: "test", removeBy: "soon" });',
    ]) {
      expectRule(lintFixture("packages/core/src", source), message);
    }

    expect(
      lintFixture(
        "packages/core/src",
        'defineFlag("test", Schema.Boolean, { default: false, owner: "test", removeBy: "2027-01-01" });'
      ).status
    ).toBe(0);
  });
  it("turns every pattern rule on in the repo config", () => {
    const configSource = readFileSync(
      path.join(repoRoot, "oxlint.config.ts"),
      "utf-8"
    );

    for (const rule of rules) {
      expect(configSource).toContain(`"${rule}": "error"`);
    }
  });

  it("flags an acquire that succeeds with an eager or captured handle", () => {
    const eager = lintFixture(
      "packages/database/src",
      'import { Effect } from "effect";\n\nclass Pool { close() {} }\n\nexport const pool = Effect.acquireRelease(Effect.succeed(new Pool()), (opened) => Effect.sync(() => opened.close()));\n'
    );

    const captured = lintFixture(
      "packages/database/src",
      'import { Effect } from "effect";\n\nclass Pool { close() {} }\n\nconst shared = new Pool();\n\nexport const pool = Effect.acquireRelease(Effect.sync(() => shared), (opened) => Effect.sync(() => opened.close()));\n'
    );

    const required = lintFixture(
      "packages/database/src",
      'const { Effect } = require("effect");\n\nclass Pool { close() {} }\n\nconst shared = new Pool();\nexport const pool = Effect.acquireRelease(Effect.succeed(shared), (opened) => Effect.sync(() => opened.close()));\n'
    );

    expectRule(eager, eagerAcquire);
    expectRule(captured, eagerAcquire);
    expectRule(required, eagerAcquire);
  });

  it("unwraps asserted acquires without flagging handles built inside the thunk", () => {
    const asserted = lintFixture(
      "packages/database/src",
      'import { Effect } from "effect";\n\nclass Pool { close() {} }\n\nconst shared = new Pool();\nexport const pool = Effect.acquireRelease(Effect.sync(() => shared) as Effect.Effect<Pool>, (opened) => Effect.sync(() => opened.close()));\n'
    );

    const defaultedParameter = lintFixture(
      "packages/database/src",
      'import { Effect } from "effect";\n\nclass Pool { close() {} }\n\nexport const pool = Effect.acquireRelease(Effect.sync((handle = new Pool()) => handle), (opened) => Effect.sync(() => opened.close()));\n'
    );

    const localHandle = lintFixture(
      "packages/database/src",
      'import { Effect } from "effect";\n\nclass Pool { close() {} }\n\nexport const pool = Effect.acquireRelease(Effect.sync(() => { const handle = new Pool(); return handle; }), (opened) => Effect.sync(() => opened.close()));\n'
    );

    expectRuleSoft(asserted, eagerAcquire);
    expect.soft(defaultedParameter.status).toBe(0);
    expect.soft(localHandle.status).toBe(0);
  });

  it("allows an acquire that constructs the resource", () => {
    const result = lintFixture(
      "packages/database/src",
      'import { Effect } from "effect";\n\nclass Pool { close() {} }\n\nexport const pool = Effect.acquireRelease(Effect.sync(() => new Pool()), (opened) => Effect.sync(() => opened.close()));\n'
    );

    expect(result.status).toBe(0);
  });

  it.each(["cached", "cachedWithTTL", "cachedInvalidateWithTTL"])(
    "rejects %s in shared initialization and permits request-local work",
    (name) => {
      const message = "Cache completed values only";

      const module = lintFixture(
        "apps/site/src",
        `import { Effect as E } from "effect"; export const shared = E.${name}(E.succeed(1), "Infinity");`
      );

      const service = lintFixture(
        "packages/core/src",
        `import { Effect, Layer } from "effect"; export const layer = Layer.effect(Tag, Effect.gen(function* () { return yield* Effect.${name}(loadAsset, "Infinity"); }));`
      );

      const contentStorePlant = lintFixture(
        "apps/site/src",
        `import { Effect, Exit } from "effect"; const cacheData = (effect) => Effect.${name}(effect, (exit) => Exit.isSuccess(exit) ? "Infinity" : 0); const makeStore = Effect.fn("ContentStore.make")(function* () { const catalog = yield* cacheData(readData(assets)); return { catalog }; });`
      );

      const request = lintFixture(
        "apps/site/src",
        `import { Effect } from "effect"; export const fetch = (request) => Effect.gen(function* () { return yield* Effect.${name}(read(request), "Infinity"); });`
      );

      const exception = lintFixture(
        "packages/core/src",
        `import { Effect } from "effect";\n// oxlint-disable-next-line rat-stack-patterns/no-shared-pending-cache -- This cache imports a CryptoKey from a fixed secret without request I/O.\nexport const shared = Effect.${name}(importKey(secret), "Infinity");`
      );

      expectRule(module, message);
      expectRule(service, message);
      expectRule(contentStorePlant, message);
      expect(request.status).toBe(0);
      expect(exception.status).toBe(0);
    }
  );

  it("flags module-level let and var in runtime source", () => {
    const counter = lintFixture(
      "apps/web/src",
      "let count = 0;\n\nexport const next = () => ++count;\n"
    );

    const exported = lintFixture(
      "packages/core/src",
      "export var cache = new Map();\n"
    );

    expectRule(counter, moduleState);
    expectRule(exported, moduleState);
  });

  it("catches nested module var and allows immutable using bindings", () => {
    const nestedVar = lintFixture(
      "packages/core/src",
      "if (Math.random() > 0.5) { var _shared = new Map(); }\n"
    );

    const usingBinding = lintFixture(
      "packages/core/src",
      "export {};\nusing resource = { [Symbol.dispose]() {} };\nvoid resource;\n"
    );

    expectRuleSoft(nestedVar, moduleState);
    expect.soft(usingBinding.status).toBe(0);
  });

  it("allows const at module level, let inside functions, and tests", () => {
    const constant = lintFixture(
      "packages/core/src",
      "export const limit = 10;\n"
    );

    const local = lintFixture(
      "packages/core/src",
      "export const sum = (values: readonly number[]) => {\n  let total = 0;\n\n  for (const value of values) {\n    total += value;\n  }\n\n  return total;\n};\n"
    );

    const test = lintFixture(
      "packages/core/test",
      "let calls = 0;\n\nexport const call = () => ++calls;\n"
    );

    expect(constant.status).toBe(0);
    expect(local.status).toBe(0);
    expect(test.status).toBe(0);
  });

  it("flags a contract binding that does not match its name", () => {
    const result = lintFixture(
      "packages/core/src",
      'import { defineContract } from "@rat-stack/capability/contract";\n\nexport const contract = defineContract("execute", {});\n'
    );

    expectRule(
      result,
      'Name this binding executeContract or execute, to match the contract name "execute".'
    );
  });

  it("tracks contract aliases, static templates, wrappers, and later assignments", () => {
    const alias = lintFixture(
      "packages/core/src",
      'import { defineContract as makeContract } from "@rat-stack/capability/contract";\n\nexport const wrongName = makeContract(`search`, {}) as object;\n'
    );

    const assignment = lintFixture(
      "packages/core/src",
      'import { defineContract } from "@rat-stack/capability/contract";\n\nexport const create = () => { let wrongName; wrongName = defineContract("search", {}); };\n'
    );

    const computedIdentifier = lintFixture(
      "packages/core/src",
      'const defineContract = "other";\nconst source = { other: () => ({}) };\nexport const result = source[defineContract]("search", {});\n'
    );

    expectRuleSoft(alias, 'to match the contract name "search".');
    expectRuleSoft(assignment, 'to match the contract name "search".');
    expect.soft(computedIdentifier.status).toBe(0);
  });

  it("accepts the name, the name plus Contract, and camelCase for snake_case names", () => {
    const result = lintFixture(
      "packages/core/src",
      'import { defineContract } from "@rat-stack/capability/contract";\n\nexport const inspectFileContract = defineContract("inspectFile", {});\nexport const search = defineContract("search", {});\nexport const ratListCalls = defineContract("rat_list_calls", {});\n'
    );

    expect(result.status).toBe(0);
  });

  it("flags a primitive service provided with provideService in a learn snippet", () => {
    const primitive =
      'import { Context, Effect } from "effect";\n\nexport class Greeting extends Context.Service<Greeting, string>()("Greeting") {}\n\nexport const main = Effect.gen(function* greet() { return yield* Greeting; }).pipe(Effect.provideService(Greeting, "hi"));\n';

    const snippet = lintFixture(".brain/data/learn-cards", primitive);

    const runtime = lintFixture("packages/core/src", primitive);

    expectRuleSoft(snippet, "Shape the service as operations");
    expectRuleSoft(snippet, "Give the service a namespaced key");
    expectRuleSoft(snippet, "Attach static readonly layer");
    expectRuleSoft(snippet, "Provide the service's static layer at the edge");
    expect.soft(runtime.status).toBe(0);
  });

  it("accepts every learn card snippet in the repo", () => {
    const directory = path.join(repoRoot, ".brain/data/learn-cards");

    const snippets = readdirSync(directory).filter((file) =>
      file.endsWith(".ts")
    );

    expect(snippets.length).toBeGreaterThan(0);

    for (const file of snippets) {
      const result = lintFixture(
        ".brain/data/learn-cards",
        readFileSync(path.join(directory, file), "utf-8")
      );

      expect.soft(result.output, file).not.toContain("learn-snippet-idiom");
    }
  });

  it("flags an Effect-backed actor that is never watched", () => {
    const result = lintFixture(
      "packages/core/src",
      'import { createEffectActor } from "@xstate/effect";\n\nexport const start = (machine: never) => createEffectActor(machine);\n'
    );

    expectRule(result, 'Call watchActor("<machine>", actor)');
  });

  it("matches actor bindings instead of unrelated or computed watcher calls", () => {
    const unrelated = lintFixture(
      "packages/core/src",
      'import { createEffectActor as makeActor } from "@xstate/effect";\n\nexport const actor = makeActor(machine);\nwatchActor("other", otherActor);\n'
    );

    const computed = lintFixture(
      "packages/core/src",
      'import { createEffectActor } from "@xstate/effect";\n\nexport const actor = createEffectActor(machine);\nwatcher[watchActor]("other", otherActor);\n'
    );

    expectRuleSoft(unrelated, 'Call watchActor("<machine>", actor)');
    expectRuleSoft(computed, 'Call watchActor("<machine>", actor)');
  });

  it("tracks watched actors by binding and permits tests that start actors", () => {
    const watched = lintFixture(
      "packages/core/src",
      'import { watchActor } from "@rat-stack/capability/actor-watch";\nimport { createEffectActor } from "@xstate/effect";\nimport { Effect } from "effect";\n\nexport const start = (machine: never) =>\n  Effect.gen(function* startMachine() {\n    const actor = yield* createEffectActor(machine);\n\n    yield* watchActor("machine", actor);\n  });\n'
    );

    const partialWatch = lintFixture(
      "packages/core/src",
      'import { watchActor } from "@rat-stack/capability/actor-watch";\nimport { createEffectActor as makeActor } from "@xstate/effect";\n\nexport const start = (first: never, second: never) => {\n  const firstActor = makeActor(first);\n  const secondActor = makeActor(second);\n\n  watchActor("first", firstActor);\n  return secondActor;\n};\n'
    );

    const called = lintFixture(
      "packages/core/src",
      'import { watchActor } from "@rat-stack/capability/actor-watch";\nimport { createEffectActor } from "@xstate/effect";\n\nexport const start = (machine: never) => {\n  const actor = createEffectActor.call(undefined, machine);\n\n  watchActor.call(undefined, "machine", actor);\n};\n'
    );

    const test = lintFixture(
      "packages/core/test",
      'import { createEffectActor } from "@xstate/effect";\n\nexport const start = (machine: never) => createEffectActor(machine);\n'
    );

    expectRule(partialWatch, 'Call watchActor("<machine>", actor)');
    expect(called.status).toBe(0);
    expect(watched.status).toBe(0);
    expect(test.status).toBe(0);
  });
});
