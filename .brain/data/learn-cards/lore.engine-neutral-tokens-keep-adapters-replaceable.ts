import { Context, Effect, Layer } from "effect";

interface Token {
  readonly fontStyle: number;
  readonly role: "ink" | "keyword" | "literal" | "muted";
  readonly text: string;
}

export class Highlighter extends Context.Service<
  Highlighter,
  { readonly tokens: (source: string) => Effect.Effect<Token[][]> }
>()("myapp/Highlighter") {
  static readonly layer = Layer.succeed(
    Highlighter,
    Highlighter.of({
      tokens: (source) =>
        Effect.succeed(
          source
            .split("\n")
            .map((text) => [{ fontStyle: 0, role: "ink", text }])
        ),
    })
  );
}
