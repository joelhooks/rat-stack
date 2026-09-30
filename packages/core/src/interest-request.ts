import { Context } from "effect";

export class InterestRequest extends Context.Service<
  InterestRequest,
  { readonly ip: string; readonly origin: string }
>()("@rat-stack/core/InterestRequest") {}
