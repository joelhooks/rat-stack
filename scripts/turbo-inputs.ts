import { Schema } from "effect";
import { API } from "typescript/unstable/sync";
import type { Snapshot } from "typescript/unstable/sync";

import {
  execFileSync,
  existsSync,
  fileURLToPath,
  globSync,
  path,
  readFileSync,
  realpathSync,
  statSync,
} from "./turbo-inputs-io.ts";
import {
  candidate,
  generatedSourceBoundaries,
  inside,
  inspectSource,
  runtimeReadBoundaries,
  sourceCandidates,
  sourcePattern,
  stringBinding,
} from "./turbo-inputs-source.ts";

const TaskSchema = Schema.Struct({
  taskId: Schema.String,
  directory: Schema.String,
  command: Schema.String,
  inputs: Schema.Record(Schema.String, Schema.String),
  dependencies: Schema.Array(Schema.String),
  outputs: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  excludedOutputs: Schema.optionalKey(
    Schema.NullOr(Schema.Array(Schema.String))
  ),
  resolvedTaskDefinition: Schema.Struct({
    inputs: Schema.Array(Schema.String),
  }),
});

export const TurboGraph = Schema.Struct({
  tasks: Schema.Array(TaskSchema),
  globalCacheInputs: Schema.optionalKey(
    Schema.Struct({ files: Schema.Record(Schema.String, Schema.Unknown) })
  ),
});

type Task = typeof TaskSchema.Type;

type Graph = typeof TurboGraph.Type;

type ModuleTarget =
  | string
  | null
  | readonly ModuleTarget[]
  | { readonly [condition: string]: ModuleTarget };

const ModuleTargetSchema: Schema.Codec<ModuleTarget> = Schema.Union([
  Schema.String,
  Schema.Null,
  Schema.Array(
    Schema.suspend((): Schema.Codec<ModuleTarget> => ModuleTargetSchema)
  ),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<ModuleTarget> => ModuleTargetSchema)
  ),
]);

const Manifest = Schema.Struct({
  name: Schema.String,
  exports: Schema.optionalKey(Schema.Record(Schema.String, ModuleTargetSchema)),
  imports: Schema.optionalKey(Schema.Record(Schema.String, ModuleTargetSchema)),
});

const Config = Schema.Struct({
  extends: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
  compilerOptions: Schema.optionalKey(
    Schema.Struct({
      baseUrl: Schema.optionalKey(Schema.String),
      paths: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.Array(Schema.String))
      ),
    })
  ),
});

const read = (file: string) => readFileSync(file, "utf-8");

const compilerTask = (task: Task) =>
  task.taskId.split("#")[1]?.startsWith("typecheck") === true ||
  task.command
    .split(/&&|;/u)
    .some((command) =>
      /^(?:pnpm(?:\s+exec)?\s+)?(?:tsc|tsrs|effect-tsrs)(?:\s|$)/u.test(
        command.trim()
      )
    );

const configFile = (root: string, task: Task) =>
  path.resolve(
    root,
    task.directory,
    (compilerTask(task)
      ? /(?:--project|-p)(?:=|\s+)(?<file>\S+)/u.exec(task.command)?.groups
          ?.file
      : undefined) ?? "tsconfig.json"
  );

const vitestOption = (command: string) =>
  /--config(?:=|\s+)(?<file>\S+)/u.exec(command)?.groups?.file;

const buildEntries = (root: string, task: Task) => {
  if (task.taskId.split("#")[1]?.startsWith("build") !== true) {
    return [];
  }

  const cwd = path.resolve(root, task.directory);
  const args = task.command.split(/\s+/u);

  const entries = args
    .filter(
      (arg, index) => args[index - 1] === "node" && sourcePattern.test(arg)
    )
    .map((arg) => path.resolve(cwd, arg));

  if (/\bvite\b/u.test(task.command)) {
    const declared = /(?:--config|-c)(?:=|\s+)(?<file>\S+)/u.exec(task.command)
      ?.groups?.file;

    entries.push(
      ...(declared === undefined
        ? globSync("vite.config.{ts,mts,cts,js,mjs,cjs}", { cwd }).map((file) =>
            path.resolve(cwd, file)
          )
        : [path.resolve(cwd, declared)])
    );
  }

  return entries;
};

const projectFiles = (root: string, graph: Graph) =>
  [
    ...new Set(
      graph.tasks.flatMap((task) => [
        path.resolve(root, task.directory, "tsconfig.json"),
        configFile(root, task),
      ])
    ),
  ].filter((file) => existsSync(file));

const exportTargets = (value: ModuleTarget): readonly string[] => {
  if (value === null) {
    return [];
  }

  if (Schema.is(Schema.String)(value)) {
    return [value];
  }

  if (Schema.is(Schema.Array(ModuleTargetSchema))(value)) {
    return value.flatMap(exportTargets);
  }

  return Object.values(value).flatMap(exportTargets);
};

const mappedTargets = (
  entries: Readonly<Record<string, ModuleTarget>>,
  specifier: string
) => {
  const matched = Object.keys(entries)
    .toSorted(
      (left, right) =>
        Number(right === specifier) - Number(left === specifier) ||
        (right.split("*")[0]?.length ?? 0) -
          (left.split("*")[0]?.length ?? 0) ||
        right.length - left.length
    )
    .find((key) => {
      const [prefix, suffix] = key.split("*");

      return key.includes("*")
        ? specifier.startsWith(prefix ?? "") && specifier.endsWith(suffix ?? "")
        : key === specifier;
    });

  if (matched === undefined) {
    return null;
  }

  const [prefix = "", suffix = ""] = matched.split("*");

  const capture = matched.includes("*")
    ? specifier.slice(prefix.length, specifier.length - suffix.length)
    : "";

  const target = entries[matched];

  if (target === undefined) {
    return null;
  }

  return exportTargets(target).map((entry) => entry.replaceAll("*", capture));
};

interface ModuleResolution {
  readonly files: readonly string[];
  readonly unresolved: boolean;
  readonly configs: readonly string[];
}

const moduleResolver = (root: string) => {
  const manifests = globSync(
    ["apps/*/package.json", "packages/*/package.json"],
    { cwd: root }
  ).map((file) => ({
    directory: path.dirname(path.resolve(root, file)),
    file: path.resolve(root, file),
    manifest: Schema.decodeSync(Schema.fromJsonString(Manifest))(
      read(path.resolve(root, file))
    ),
  }));

  interface AliasSettings {
    readonly baseUrl: string | undefined;
    readonly configs: readonly string[];
    readonly hasPaths: boolean;
    readonly unsupported: boolean;
    readonly entries: readonly {
      readonly pattern: string;
      readonly targets: readonly string[];
      readonly configs: readonly string[];
    }[];
  }

  const aliases = new Map<string, AliasSettings>();

  const settings = (file: string, seen = new Set<string>()): AliasSettings => {
    if (!existsSync(file) || seen.has(file)) {
      return {
        baseUrl: undefined,
        configs: [],
        entries: [],
        hasPaths: false,
        unsupported: false,
      };
    }

    seen.add(file);
    const config = Schema.decodeSync(Schema.fromJsonString(Config))(read(file));
    const bases = config.extends ?? [];

    const inherited = (Schema.is(Schema.String)(bases) ? [bases] : bases)
      .toReversed()
      .filter((base) => base.startsWith("."))
      .map((base) =>
        settings(path.resolve(path.dirname(file), base), new Set(seen))
      );

    const baseUrl =
      config.compilerOptions?.baseUrl === undefined
        ? inherited.find((base) => base.baseUrl !== undefined)?.baseUrl
        : path.resolve(path.dirname(file), config.compilerOptions.baseUrl);

    const configs = [file, ...inherited.flatMap((base) => base.configs)];
    const parent = inherited.find((base) => base.hasPaths);
    const ownPaths = config.compilerOptions?.paths !== undefined;

    return {
      baseUrl,
      configs,
      hasPaths: ownPaths || parent !== undefined,
      unsupported:
        !ownPaths &&
        parent !== undefined &&
        (parent.unsupported || baseUrl !== parent.baseUrl),
      entries: ownPaths
        ? Object.entries(config.compilerOptions?.paths ?? {}).map(
            ([pattern, targets]) => ({
              pattern,
              targets: targets.map((target) =>
                path.resolve(baseUrl ?? path.dirname(file), target)
              ),
              configs,
            })
          )
        : (parent?.entries ?? []),
    };
  };

  const resolveAlias = (
    specifier: string,
    from: string
  ): ModuleResolution | null => {
    let directory = path.dirname(from);

    while (
      inside(root, directory) &&
      !existsSync(path.join(directory, "tsconfig.json"))
    ) {
      directory = path.dirname(directory);
    }

    const configFileName = path.join(directory, "tsconfig.json");

    if (!aliases.has(configFileName)) {
      aliases.set(configFileName, settings(configFileName));
    }

    const configuration = aliases.get(configFileName);
    const entries = configuration?.entries ?? [];

    const matched =
      entries.find((entry) => entry.pattern === specifier) ??
      entries
        .toSorted(
          (left, right) =>
            (right.pattern.split("*")[0]?.length ?? 0) -
              (left.pattern.split("*")[0]?.length ?? 0) ||
            right.pattern.length - left.pattern.length
        )
        .find(
          (entry) =>
            mappedTargets({ [entry.pattern]: entry.targets }, specifier) !==
            null
        );

    if (matched === undefined) {
      return null;
    }

    const targets =
      mappedTargets({ [matched.pattern]: matched.targets }, specifier) ?? [];

    const files = targets.flatMap((target) => {
      const file = candidate(target);

      return file === undefined ? [] : [file];
    });

    return {
      files: files.length === 0 ? targets : files,
      unresolved: targets.length === 0 || configuration?.unsupported === true,
      configs: configuration?.configs ?? matched.configs,
    };
  };

  const resolveWorkspace = (specifier: string): ModuleResolution => {
    const workspace = manifests.find(
      ({ manifest }) =>
        specifier === manifest.name || specifier.startsWith(`${manifest.name}/`)
    );

    if (workspace === undefined) {
      const local = manifests.some(
        ({ manifest }) =>
          manifest.name.startsWith("@") &&
          specifier.startsWith(`${manifest.name.split("/")[0]}/`)
      );

      return { files: [], unresolved: local, configs: [] };
    }

    const targets =
      mappedTargets(
        workspace.manifest.exports ?? {},
        `.${specifier.slice(workspace.manifest.name.length)}`
      ) ?? [];

    const files = targets.map(
      (target) =>
        candidate(
          path.resolve(workspace.directory, target.replace("/dist/", "/src/"))
        ) ??
        candidate(path.resolve(workspace.directory, target)) ??
        path.resolve(workspace.directory, target)
    );

    return {
      files,
      unresolved: targets.length === 0,
      configs: [workspace.file],
    };
  };

  const resolve = (
    raw: string,
    from: string,
    seen = new Set<string>()
  ): ModuleResolution => {
    const queryFree = raw.split("?")[0] ?? raw;

    const specifier = queryFree.startsWith("file:")
      ? fileURLToPath(queryFree)
      : queryFree;

    const key = `${from}:${specifier}`;

    if (seen.has(key)) {
      return { files: [], unresolved: true, configs: [] };
    }

    seen.add(key);

    if (
      [
        "virtual:reader-pages",
        "virtual:reader-page-sources",
        "virtual:reader-error",
      ].includes(specifier)
    ) {
      return {
        files: [path.resolve(root, "apps/web/reader-pages.ts")],
        unresolved: false,
        configs: [],
      };
    }

    if (specifier === "virtual:reader-effect-ui-assets") {
      return {
        files: [path.resolve(root, "apps/web/effect-ui.ts")],
        unresolved: false,
        configs: [],
      };
    }

    if (/^[a-z]+:/iu.test(specifier)) {
      return {
        files: [],
        unresolved: !["node:", "cloudflare:"].some((prefix) =>
          specifier.startsWith(prefix)
        ),
        configs: [],
      };
    }

    if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
      const file = candidate(path.resolve(path.dirname(from), specifier));

      return {
        files: [file ?? path.resolve(path.dirname(from), specifier)],
        unresolved: false,
        configs: [],
      };
    }

    const owner = manifests.find(({ directory }) => inside(directory, from));

    if (specifier.startsWith("#")) {
      const targets =
        mappedTargets(owner?.manifest.imports ?? {}, specifier) ?? [];

      const resolutions = targets.map((target) =>
        resolve(
          target.startsWith(".")
            ? (candidate(
                path
                  .resolve(owner?.directory ?? root, target)
                  .replace("/dist/", "/src/")
              ) ?? path.resolve(owner?.directory ?? root, target))
            : target,
          from,
          new Set(seen)
        )
      );

      return {
        files: resolutions.flatMap((result) => result.files),
        unresolved:
          targets.length === 0 ||
          resolutions.some((result) => result.unresolved),
        configs: [
          ...(owner ? [owner.file] : []),
          ...resolutions.flatMap((result) => result.configs),
        ],
      };
    }

    return resolveAlias(specifier, from) ?? resolveWorkspace(specifier);
  };

  return resolve;
};

const ancestors = (
  task: Task,
  tasks: ReadonlyMap<string, Task>,
  seen = new Set<string>()
): readonly Task[] => {
  for (const id of task.dependencies) {
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);

    const dependency = tasks.get(id);

    if (dependency) {
      ancestors(dependency, tasks, seen);
    }
  }

  return [...seen].flatMap((id) => {
    const dependency = tasks.get(id);

    return dependency ? [dependency] : [];
  });
};

type CoveragePath = "own input" | "ancestor input" | "ancestor output";

type CoverageLookup = (file: string, direct: boolean) => CoveragePath | null;

const taskCoverage = (
  root: string,
  task: Task,
  tasks: ReadonlyMap<string, Task>,
  globalFiles: ReadonlySet<string>,
  tracked: ReadonlySet<string>
) => {
  const inputs = (entry: Task) =>
    Object.keys(entry.inputs).map((file) =>
      path.resolve(root, entry.directory, file)
    );

  const own = new Set([...inputs(task), ...globalFiles]);
  const dependencies = ancestors(task, tasks);
  const covered = new Set([...own, ...dependencies.flatMap(inputs)]);

  const outputs = dependencies.map((dependency) => ({
    included: (dependency.outputs ?? []).map((output) =>
      path.resolve(root, dependency.directory, output)
    ),
    excluded: (dependency.excludedOutputs ?? []).map((output) =>
      path.resolve(root, dependency.directory, output)
    ),
  }));

  const has: CoverageLookup = (file, direct) => {
    const patternRead = ["*", "?", "[", "{"].some((marker) =>
      file.includes(marker)
    );

    if (own.has(file)) {
      return "own input";
    }

    if (!direct && covered.has(file)) {
      return "ancestor input";
    }

    if (
      !tracked.has(file) &&
      (!patternRead ||
        ![...tracked].some((entry) => path.matchesGlob(entry, file))) &&
      outputs.some(
        (output) =>
          output.included.some((pattern) =>
            patternRead
              ? pattern.endsWith(`${path.sep}**`) &&
                file.startsWith(pattern.slice(0, -2))
              : path.matchesGlob(file, pattern)
          ) &&
          (!patternRead || output.excluded.length === 0) &&
          !output.excluded.some(
            (pattern) =>
              path.matchesGlob(file, pattern) || path.matchesGlob(pattern, file)
          )
      )
    ) {
      return "ancestor output";
    }

    return null;
  };

  return has;
};

type RequireFile = (
  file: string,
  from: string,
  direct?: boolean,
  kind?: "runtime read" | "configuration/import closure"
) => void;

const loadConfig = (
  file: string,
  requireFile: RequireFile,
  seen = new Set<string>()
): void => {
  if (seen.has(file)) {
    return;
  }

  seen.add(file);
  requireFile(file, file, true);

  const config = Schema.decodeSync(Schema.fromJsonString(Config))(read(file));

  const bases = config.extends ?? [];

  for (const base of Schema.is(Schema.String)(bases) ? [bases] : bases) {
    if (base.startsWith(".")) {
      loadConfig(path.resolve(path.dirname(file), base), requireFile, seen);
    }
  }
};

const selectedVitestTests = (
  root: string,
  cwd: string,
  task: Task,
  vitest: string,
  inspect: ReturnType<typeof inspector>,
  failures: Set<string>
) => {
  if (!/^vitest run(?: --config(?:=| )\S+)?$/u.test(task.command)) {
    return null;
  }

  const tests = inspect(vitest, cwd)?.selectedTests ?? null;

  if (tests?.length === 0) {
    failures.add(
      `${task.taskId} selects no Vitest files. An empty shard cannot verify behavior. Fix: select existing tests in \`${path.relative(root, vitest)}\`.`
    );
  }

  return tests;
};

const roots = (
  root: string,
  task: Task,
  snapshot: Snapshot,
  inspect: ReturnType<typeof inspector>,
  requireFile: RequireFile,
  failures: Set<string>
) => {
  const cwd = path.resolve(root, task.directory);
  const [, taskName = ""] = task.taskId.split("#");
  const config = configFile(root, task);
  const pending: string[] = [];
  const configFiles = new Set<string>();

  if (existsSync(config) && compilerTask(task)) {
    const project = snapshot.getProject(config);

    if (project) {
      pending.push(
        ...project.program
          .getSourceFileNames()
          .filter(
            (file) => inside(root, file) && !file.includes("node_modules")
          )
      );
    }

    loadConfig(config, requireFile);
  }

  for (const entry of buildEntries(root, task)) {
    requireFile(entry, entry, true);
    pending.push(entry);
  }

  if (!taskName.startsWith("test")) {
    return { pending, configFiles };
  }

  const declared = vitestOption(task.command);
  const defaults = globSync("vitest.config.{ts,mts,cts,js,mjs,cjs}", { cwd });

  if (declared === undefined && defaults.length > 1) {
    failures.add(
      `${task.taskId} has multiple default Vitest configurations. The check cannot prove which one Vitest loads. Fix: select one with \`vitest --config <file>\` in its package script.`
    );

    return { pending, configFiles };
  }

  const vitest = path.resolve(
    cwd,
    declared ?? defaults.at(0) ?? "vitest.config.ts"
  );

  if (declared !== undefined) {
    requireFile(vitest, vitest, true);
  }

  if (existsSync(vitest)) {
    pending.push(vitest);
    configFiles.add(vitest);
  }

  const selectedTests = selectedVitestTests(
    root,
    cwd,
    task,
    vitest,
    inspect,
    failures
  );

  if (selectedTests) {
    pending.push(...selectedTests);

    return { pending, configFiles, selectedVitest: vitest };
  }

  if (cwd === root) {
    for (const argument of task.command.split(/\s+/u)) {
      if (
        sourcePattern.test(argument) &&
        existsSync(path.resolve(cwd, argument))
      ) {
        pending.push(path.resolve(cwd, argument));
      }
    }
  } else {
    pending.push(
      ...globSync("**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", {
        cwd,
        exclude: ["node_modules/**", "dist/**"],
      }).map((file) => path.resolve(cwd, file))
    );
  }

  return { pending, configFiles };
};

const inspector = (
  root: string,
  snapshot: Snapshot,
  resolve: ReturnType<typeof moduleResolver>
) => {
  const facts = new Map<string, ReturnType<typeof inspectSource>>();
  const projects = snapshot.getProjects();

  const source = (file: string) => {
    const project =
      snapshot.getDefaultProjectForFile(file) ??
      projects.find((entry) => entry.program.getSourceFile(file));

    const ast = project?.program.getSourceFile(file);

    return ast ?? null;
  };

  return (file: string, cwd: string) => {
    const key = `${cwd}:${file}`;
    const existing = facts.get(key);

    if (existing) {
      return existing;
    }

    const ast = source(file);

    if (ast === null) {
      return null;
    }

    const result = inspectSource(file, cwd, root, ast, (specifier, name) => {
      for (const loaded of resolve(specifier, file).files) {
        const imported = source(loaded);

        const binding =
          imported === null ? null : stringBinding(imported, name);

        if (binding !== null) {
          return binding;
        }
      }

      return null;
    });

    facts.set(key, result);

    return result;
  };
};

const boundedRootCoverage = (
  root: string,
  pattern: string,
  has: CoverageLookup,
  exclude: readonly string[] = []
) => {
  const absolute = path.resolve(root, pattern);
  const declared = has(absolute, false);

  if (
    declared !== null &&
    (!existsSync(absolute) || statSync(absolute).isFile())
  ) {
    return new Set([declared]);
  }

  const search =
    existsSync(absolute) && statSync(absolute).isDirectory()
      ? path.join(absolute, "**/*")
      : absolute;

  const files = globSync(search, {
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/.turbo/**",
      "**/.agent_sources/**",
      ...exclude,
    ],
  }).filter((file) => statSync(file).isFile());

  const paths = new Set<CoveragePath>();

  if (files.length === 0) {
    return null;
  }

  for (const file of files) {
    const via = has(file, false);

    if (via === null) {
      return null;
    }

    paths.add(via);
  }

  return paths;
};

type RootCoverage = (
  pattern: string,
  exclude?: readonly string[]
) => ReadonlySet<CoveragePath> | null;

const recordDynamicReads = (
  root: string,
  file: string,
  task: Task,
  expressions: ReadonlySet<string>,
  failures: Set<string>,
  listedReads: Set<string>,
  cover: RootCoverage
) => {
  if (expressions.size === 0) {
    return;
  }

  const boundaries = runtimeReadBoundaries(root, file);
  const source = path.relative(root, file);

  if (boundaries === undefined) {
    for (const expression of expressions) {
      failures.add(
        `${task.taskId} has an unresolved runtime read. The file set of \`${expression}\` in \`${source}\` cannot be proven from its inputs. Fix: use a statically resolvable path or declare a bounded reader in \`scripts/turbo-inputs-source.ts\`.`
      );
    }

    return;
  }

  for (const expression of expressions) {
    listedReads.add(
      `${task.taskId} ${source} reader ${expression.replaceAll(/\s+/gu, " ")}`
    );
  }

  for (const boundary of boundaries) {
    if (boundary.kind === "unbounded") {
      listedReads.add(
        `${task.taskId} ${source} bare exception: ${boundary.reason}`
      );
    } else if (boundary.kind === "fixture") {
      listedReads.add(
        `${task.taskId} ${source} test-created root: ${boundary.root}`
      );
    } else {
      const via = cover(boundary.root, boundary.exclude);

      if (via === null) {
        failures.add(
          `${task.taskId} does not cover bounded runtime root \`${boundary.root}\`. Dynamic reads in \`${source}\` can change without invalidating the task. Fix: hash that root in \`turbo.json\` or depend on its producer.`
        );
      } else {
        listedReads.add(
          `${task.taskId} ${source} root ${boundary.root} via ${[...via].toSorted().join(", ")}`
        );
      }
    }
  }
};

const unfilteredVitestIncludes = (
  file: string,
  configFiles: ReadonlySet<string>,
  selectedVitest: string | undefined,
  info: ReturnType<typeof inspectSource>
) =>
  file !== selectedVitest && configFiles.has(file) ? info.includedTests : [];

const inspectTask = (
  root: string,
  task: Task,
  snapshot: Snapshot,
  inspect: ReturnType<typeof inspector>,
  resolve: ReturnType<typeof moduleResolver>,
  requireFile: RequireFile,
  failures: Set<string>,
  listedReads: Set<string>,
  has: CoverageLookup
) => {
  const cwd = path.resolve(root, task.directory);
  const [, taskName = ""] = task.taskId.split("#");

  const { pending, configFiles, selectedVitest } = roots(
    root,
    task,
    snapshot,
    inspect,
    requireFile,
    failures
  );

  const visited = new Set<string>();
  const runtimeFiles = new Set(buildEntries(root, task));
  const rootsChecked = new Map<string, ReadonlySet<CoveragePath> | null>();

  const cover: RootCoverage = (pattern, exclude) => {
    const key = JSON.stringify([pattern, exclude]);

    if (!rootsChecked.has(key)) {
      rootsChecked.set(key, boundedRootCoverage(root, pattern, has, exclude));
    }

    return rootsChecked.get(key) ?? null;
  };

  const generatedImport = (real: string, from: string) => {
    if (has(real, false) !== "ancestor output") {
      return false;
    }

    const boundary = [
      ...generatedSourceBoundaries,
      ...(runtimeReadBoundaries(root, from) ?? []),
    ].find(
      (entry) =>
        entry.kind === "hashed" &&
        path.matchesGlob(real, path.resolve(root, entry.root)) &&
        cover(entry.root, entry.exclude) !== null
    );

    if (boundary?.kind !== "hashed") {
      return false;
    }

    requireFile(real, from);
    listedReads.add(
      `${task.taskId} ${path.relative(root, from)} generated-artifact boundary: ${path.relative(root, real)} within ${boundary.root} via ancestor output`
    );

    return true;
  };

  const followImport = (specifier: string, file: string) => {
    const resolution = resolve(specifier, file);

    if (resolution.unresolved) {
      failures.add(
        `${task.taskId} cannot resolve local import \`${specifier}\`. Its source in \`${path.relative(root, file)}\` cannot be checked against the task inputs. Fix: provide a resolvable relative, package-import, workspace export or tsconfig path in \`${path.relative(root, file)}\`.`
      );
    }

    for (const config of resolution.configs) {
      requireFile(config, file);
    }

    for (const loaded of resolution.files) {
      if (!inside(root, loaded)) {
        failures.add(
          `${task.taskId} imports outside the repository. The source \`${loaded}\` is outside its input census. Fix: move the imported source inside the repository and declare it in \`turbo.json\`.`
        );
        continue;
      }

      const real = existsSync(loaded) ? realpathSync(loaded) : loaded;

      if (
        existsSync(real)
          ? generatedImport(real, file)
          : sourceCandidates(real).some((entry) => generatedImport(entry, file))
      ) {
        continue;
      }

      if (!existsSync(real)) {
        failures.add(
          `${task.taskId} cannot resolve local import \`${specifier}\`. The source \`${path.relative(root, real)}\` does not exist and has no declared generated-artifact boundary. Fix: provide the source or declare its producer and reader root in \`scripts/turbo-inputs-source.ts\`.`
        );
        continue;
      }

      if (configFiles.has(file)) {
        configFiles.add(real);
      }

      if (runtimeFiles.has(file)) {
        runtimeFiles.add(real);
      }

      pending.push(real);
    }
  };

  while (pending.length > 0) {
    const file = pending.pop();

    if (
      file === undefined ||
      visited.has(file) ||
      !inside(root, file) ||
      file.includes("node_modules")
    ) {
      continue;
    }

    visited.add(file);
    requireFile(file, configFile(root, task), configFiles.has(file));

    if (!sourcePattern.test(file)) {
      continue;
    }

    const info = inspect(file, cwd);

    if (info === null) {
      failures.add(
        `${task.taskId} cannot inspect \`${path.relative(root, file)}\`. The compiler did not load this source. Fix: add it to a project in \`tsconfig.json\`.`
      );
      continue;
    }

    const runtime = taskName.startsWith("test") || runtimeFiles.has(file);

    if (runtime) {
      recordDynamicReads(
        root,
        file,
        task,
        info.unresolvedImports,
        failures,
        listedReads,
        cover
      );
    }

    if (configFiles.has(file)) {
      for (const unresolved of info.unresolvedConfigs) {
        failures.add(
          `${task.taskId} has an unresolved Vitest file selector. The selector \`${unresolved}\` cannot be checked against its inputs. Fix: use literal file selectors in \`${path.relative(root, file)}\`.`
        );
      }
    }

    if (taskName.startsWith("test")) {
      recordDynamicReads(
        root,
        file,
        task,
        info.unresolvedReads,
        failures,
        listedReads,
        cover
      );

      for (const fixture of info.reads) {
        requireFile(
          fixture,
          file,
          inside(cwd, file) && !sourcePattern.test(fixture),
          "runtime read"
        );
      }
    }

    pending.push(
      ...unfilteredVitestIncludes(file, configFiles, selectedVitest, info)
    );

    for (const loaded of info.configs) {
      requireFile(loaded, file, true);

      if (path.basename(loaded).startsWith("vitest")) {
        configFiles.add(loaded);
      }

      pending.push(loaded);
    }

    for (const specifier of [
      ...info.imports,
      ...(runtime ? info.runtimeImports : []),
    ]) {
      followImport(specifier, file);
    }
  }
};

const auditSnapshot = (root: string, graph: Graph, snapshot: Snapshot) => {
  const tasks = new Map(graph.tasks.map((task) => [task.taskId, task]));

  const globalFiles = new Set(
    Object.keys(graph.globalCacheInputs?.files ?? {}).map((file) =>
      path.resolve(root, file)
    )
  );

  const failures = new Set<string>();
  const listedReads = new Set<string>();

  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf-8" })
      .split("\0")
      .filter(Boolean)
      .map((file) => path.resolve(root, file))
  );

  const resolve = moduleResolver(root);
  const inspect = inspector(root, snapshot, resolve);
  let checked = 0;

  for (const task of graph.tasks) {
    const [, taskName = ""] = task.taskId.split("#");

    if (
      task.command === "<NONEXISTENT>" ||
      !/^(?:test|typecheck|build)/u.test(taskName)
    ) {
      continue;
    }

    checked += 1;

    const cwd = path.resolve(root, task.directory);
    const has = taskCoverage(root, task, tasks, globalFiles, tracked);

    const requireFile: RequireFile = (
      file,
      from,
      direct = false,
      kind = "configuration/import closure"
    ) => {
      const via = has(file, direct);

      if (
        kind === "runtime read" &&
        (!inside(root, file) || !existsSync(file))
      ) {
        const boundaries = runtimeReadBoundaries(root, from);

        if (
          !inside(root, file) &&
          boundaries?.some(
            (boundary) =>
              boundary.kind === "fixture" || boundary.kind === "unbounded"
          ) === true
        ) {
          return;
        }

        if (inside(root, file) && via === "ancestor output") {
          return;
        }

        failures.add(
          `${task.taskId} reads a missing or external path \`${file}\`. Its literal read from \`${path.relative(root, from)}\` has no repository input or generated producer. Fix: provide the file and its input, declare its producer, or declare an external reader boundary in \`scripts/turbo-inputs-source.ts\`.`
        );

        return;
      }

      if (via !== null) {
        return;
      }

      const input = inside(cwd, file)
        ? path.relative(cwd, file)
        : `$TURBO_ROOT$/${path.relative(root, file)}`;

      failures.add(
        `${task.taskId} does not hash ${path.relative(root, file)}. Its ${kind} from ${path.relative(root, from)} can change without invalidating the task. Fix: add \`${input}\` to the task's inputs in \`turbo.json\`.`
      );
    };

    inspectTask(
      root,
      task,
      snapshot,
      inspect,
      resolve,
      requireFile,
      failures,
      listedReads,
      has
    );
  }

  return {
    checked,
    failures: [...failures].toSorted(),
    listedReads: [...listedReads].toSorted(),
  };
};

export const audit = (root: string, graph: Graph) => {
  const api = new API();

  try {
    const openFiles = globSync(
      [
        "scripts/*.{ts,mts,cts,mjs,js,cjs}",
        "apps/*/vitest*.{ts,mts,cts,js,mjs,cjs}",
        "packages/*/vitest*.{ts,mts,cts,js,mjs,cjs}",
      ],
      { cwd: root }
    ).map((file) => path.resolve(root, file));

    const selectedConfigs = graph.tasks
      .flatMap((task) => {
        const declared = vitestOption(task.command);

        return declared === undefined
          ? []
          : [path.resolve(root, task.directory, declared)];
      })
      .filter((file) => existsSync(file));

    const snapshot = api.updateSnapshot({
      openProjects: projectFiles(root, graph),
      openFiles: [
        ...openFiles,
        ...selectedConfigs,
        ...graph.tasks
          .flatMap((task) => buildEntries(root, task))
          .filter((file) => existsSync(file)),
      ],
    });

    try {
      return auditSnapshot(root, graph, snapshot);
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
};

const [, entrypoint] = process.argv;

if (
  entrypoint !== undefined &&
  path.resolve(entrypoint) === import.meta.filename
) {
  const root = process.cwd();

  const json = execFileSync(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "check",
      "test",
      "build",
      "typecheck:tsc",
      "typecheck:fast",
      "typecheck:tsc-scripts",
      "typecheck:fast-scripts",
      "--dry=json",
    ],
    { cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
  );

  const graph = Schema.decodeSync(Schema.fromJsonString(TurboGraph))(json);

  const result = audit(root, graph);

  for (const listed of result.listedReads) {
    process.stdout.write(`Explicit dynamic read boundary: ${listed}\n`);
  }

  if (result.failures.length > 0) {
    process.stderr.write(`${result.failures.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Turbo input coverage: ${result.checked} tasks cover their configuration, imports and statically resolved runtime fixtures.\n`
    );
  }
}
