import { Option, Schema } from "effect";

const Execution = Schema.Struct({
  startTime: Schema.Int,
  endTime: Schema.optionalKey(Schema.Int),
  exitCode: Schema.optionalKey(Schema.Int),
});

const TurboSummary = Schema.Struct({
  id: Schema.String,
  version: Schema.Literal("1"),
  turboVersion: Schema.String,
  scm: Schema.Struct({
    sha: Schema.optionalKey(Schema.String),
    branch: Schema.optionalKey(Schema.String),
  }),
  execution: Execution,
  tasks: Schema.Array(
    Schema.Struct({
      taskId: Schema.String,
      command: Schema.String,
      cache: Schema.Struct({
        status: Schema.Literals(["HIT", "MISS", "BYPASS"]),
        local: Schema.Boolean,
        remote: Schema.Boolean,
      }),
      execution: Schema.optionalKey(Execution),
    })
  ),
});

export const SurfaceSchema = Schema.Literals([
  "pr",
  "main",
  "nightly",
  "local",
]);

export type Surface = typeof SurfaceSchema.Type;

const decode = Schema.decodeOption(Schema.fromJsonString(TurboSummary));

export const summarize = (json: string, surface: Surface, ref?: string) => {
  const parsed = decode(json);

  if (Option.isNone(parsed)) {
    return null;
  }

  const run = parsed.value;
  const tasks = run.tasks.filter((task) => task.command !== "<NONEXISTENT>");
  const hits = tasks.filter((task) => task.cache.status === "HIT");

  const slowest = tasks
    .map((task) => ({
      task: task.taskId,
      durationMs:
        task.execution?.endTime === undefined
          ? null
          : task.execution.endTime - task.execution.startTime,
      cache: task.cache.status,
    }))
    .filter((task) => task.durationMs !== null)
    .toSorted((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, 5);

  return {
    runId: run.id,
    turboVersion: run.turboVersion,
    sha: run.scm.sha ?? null,
    ref: ref ?? run.scm.branch ?? null,
    surface,
    startedAt: run.execution.startTime,
    exitCode: run.execution.exitCode ?? null,
    taskCount: tasks.length,
    hits: {
      local: hits.filter((task) => task.cache.local).length,
      remote: hits.filter((task) => !task.cache.local && task.cache.remote)
        .length,
      unknown: hits.filter((task) => !task.cache.local && !task.cache.remote)
        .length,
    },
    misses: tasks.filter((task) => task.cache.status === "MISS").length,
    bypasses: tasks.filter((task) => task.cache.status === "BYPASS").length,
    hitRate: tasks.length === 0 ? 0 : hits.length / tasks.length,
    wallTimeMs:
      run.execution.endTime === undefined
        ? null
        : run.execution.endTime - run.execution.startTime,
    slowest,
  };
};
