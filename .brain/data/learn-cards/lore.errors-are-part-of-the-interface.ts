import { Effect, Schema } from "effect";

export class RangeOutOfBounds extends Schema.TaggedError<RangeOutOfBounds>()(
  "RangeOutOfBounds",
  {
    at: Schema.String,
    fileLength: Schema.Int,
    fix: Schema.String,
    requested: Schema.String,
  }
) {}

export const checkRange = (at: string, end: number, fileLength: number) =>
  end <= fileLength
    ? Effect.void
    : Effect.fail(
        new RangeOutOfBounds({
          at,
          fileLength,
          fix: `Choose lines within 1-${fileLength}.`,
          requested: `1-${end}`,
        })
      );
