import { Schema } from "effect";

const Token = Schema.Struct({
  color: Schema.optionalKey(Schema.String),
  text: Schema.String,
});

const CharRange = Schema.Struct({ end: Schema.Finite, start: Schema.Finite });

const Line = Schema.Struct({
  brightBoundaries: Schema.optionalKey(Schema.Array(CharRange)),
  partOrder: Schema.Array(Schema.String),
  parts: Schema.Record(
    Schema.String,
    Schema.Struct({
      tokens: Schema.Array(Token),
      versions: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.Array(Token))
      ),
    })
  ),
});

const Range = Schema.Struct({
  end: Schema.Finite,
  lineIndex: Schema.Int,
  start: Schema.Finite,
});

const Frame = Schema.Struct({
  brightRanges: Schema.optionalKey(Schema.Array(Range)),
  cursor: Schema.optionalKey(
    Schema.Struct({
      charOffset: Schema.Finite,
      lineIndex: Schema.Int,
      textLength: Schema.Finite,
    })
  ),
  id: Schema.Int,
  lineOrder: Schema.Array(Schema.String),
  marks: Schema.optionalKey(Schema.Array(Range)),
  state: Schema.Record(
    Schema.String,
    Schema.Struct({
      dimmed: Schema.optionalKey(Schema.Boolean),
      entering: Schema.optionalKey(Schema.Boolean),
      parts: Schema.Record(
        Schema.String,
        Schema.Union([Schema.Boolean, Schema.String])
      ),
    })
  ),
});

const Word = Schema.Struct({
  end: Schema.Finite,
  paragraphBreak: Schema.optionalKey(Schema.Boolean),
  start: Schema.Finite,
  suffix: Schema.optionalKey(Schema.String),
  style: Schema.optionalKey(
    Schema.Struct({
      bold: Schema.optionalKey(Schema.Boolean),
      code: Schema.optionalKey(Schema.Boolean),
      italic: Schema.optionalKey(Schema.Boolean),
    })
  ),
  word: Schema.String,
});

export const PlayerSectionSchema = Schema.Struct({
  id: Schema.String,
  slideshowData: Schema.optionalKey(
    Schema.Struct({
      frames: Schema.Array(Frame),
      template: Schema.Struct({ lines: Schema.Record(Schema.String, Line) }),
    })
  ),
  stepTimes: Schema.optionalKey(Schema.Array(Schema.Finite)),
  text: Schema.String,
  wordTimings: Schema.optionalKey(Schema.Array(Word)),
});

export type PlayerSection = typeof PlayerSectionSchema.Type;

export type CodeFrame = typeof Frame.Type;

export type CodeLine = typeof Line.Type;

export type CodeToken = typeof Token.Type;

export type WordTiming = typeof Word.Type;
