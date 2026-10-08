import { Context, Effect, Layer, ManagedRuntime } from "effect";

export class Greeter extends Context.Service<
  Greeter,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("myapp/Greeter") {
  static readonly layer = Layer.succeed(
    Greeter,
    Greeter.of({ greet: (name) => Effect.succeed(`hi ${name}`) })
  );
}

export const makeForeignApi = () => {
  const runtime = ManagedRuntime.make(Greeter.layer);

  return {
    close: runtime.dispose.bind(runtime),
    // @effect-diagnostics-next-line asyncFunction:off -- The foreign framework expects a native Promise API.
    greet: async (name: string) =>
      await runtime.runPromise(Greeter.use((greeter) => greeter.greet(name))),
  };
};
