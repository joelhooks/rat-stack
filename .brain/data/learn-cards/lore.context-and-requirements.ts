import { Context, Effect, Layer } from "effect";

export class Greeter extends Context.Service<
  Greeter,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("myapp/Greeter") {
  static readonly layer = Layer.succeed(
    Greeter,
    Greeter.of({ greet: (name) => Effect.succeed(`hi ${name}`) })
  );
}

const program = Effect.gen(function* greetJoel() {
  const greeter = yield* Greeter;

  return yield* greeter.greet("Joel");
});

export const main = program.pipe(Effect.provide(Greeter.layer));
