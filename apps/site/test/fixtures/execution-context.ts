import type * as Cloudflare from "@alchemy.run/cloudflare";
import { Predicate, Schema } from "effect";

type RawExecutionContext = Cloudflare.WorkerExecutionContext["Service"]["raw"];

const UntouchedRawExecutionContext = Schema.declare<RawExecutionContext>(
  (input): input is RawExecutionContext => Predicate.isObject(input)
);

export const untouchedRawExecutionContext = Schema.decodeUnknownSync(
  UntouchedRawExecutionContext
)({});
