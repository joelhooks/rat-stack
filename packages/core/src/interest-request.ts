import { Context } from "effect";

export class InterestRequest extends Context.Service<
  InterestRequest,
  {
    readonly ip: string | undefined;
    readonly origin: string;
    readonly userAgent: string;
  }
>()("@rat-stack/core/InterestRequest") {}
