import { Console, Effect, Layer } from "effect";

export const helpOnStderr = Layer.effect(
  Console.Console,
  Effect.gen(function* helpOnStderr() {
    const original = yield* Console.Console;

    return {
      assert: original.assert.bind(original),
      clear: original.clear.bind(original),
      count: original.count.bind(original),
      countReset: original.countReset.bind(original),
      debug: original.debug.bind(original),
      dir: original.dir.bind(original),
      dirxml: original.dirxml.bind(original),
      error: original.error.bind(original),
      group: original.group.bind(original),
      groupCollapsed: original.groupCollapsed.bind(original),
      groupEnd: original.groupEnd.bind(original),
      info: original.info.bind(original),
      log: original.error.bind(original),
      table: original.table.bind(original),
      time: original.time.bind(original),
      timeEnd: original.timeEnd.bind(original),
      timeLog: original.timeLog.bind(original),
      trace: original.trace.bind(original),
      warn: original.warn.bind(original),
    };
  })
);
