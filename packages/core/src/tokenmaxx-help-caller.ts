import { Context } from "effect";
import type { Option, Redacted } from "effect";

export class HelpCaller extends Context.Service<
  HelpCaller,
  { readonly authorization: Option.Option<Redacted.Redacted> }
>()("rat-stack/HelpCaller") {}
