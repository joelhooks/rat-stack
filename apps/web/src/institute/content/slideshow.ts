import { Schema } from "effect";

const StatusKind = Schema.Literals([
  "running",
  "success",
  "error",
  "interrupted",
  "die",
]);

const CursorType = Schema.Literals(["pointer", "hand", "thumbsDown"]);

const LineBackground = Schema.Literals(["success", "error", "warning", "info"]);

export const AnimationSoundName = Schema.Literals([
  "tick",
  "pop",
  "whoosh",
  "sad",
  "celebrate",
  "chime",
  "success",
  "error",
  "alarm",
  "doom",
  "spooky",
  "press",
  "fail",
  "succeed",
  "ping1",
  "ping2",
  "ping3",
  "derp",
  "skip",
]);

const Token = Schema.Struct({
  text: Schema.String,
  type: Schema.Literals([
    "keyword",
    "type",
    "string",
    "number",
    "operator",
    "comment",
    "identifier",
    "punctuation",
    "default",
  ]),

  color: Schema.optionalKey(Schema.String),
});

const TemplatePart = Schema.Struct({
  tokens: Schema.Array(Token),

  animateEntry: Schema.Boolean,

  crossfade: Schema.Boolean,

  inline: Schema.optionalKey(Schema.String),

  versions: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Array(Token))
  ),
});

const CharRange = Schema.Struct({ start: Schema.Finite, end: Schema.Finite });

const TemplateLine = Schema.Struct({
  parts: Schema.Record(Schema.String, TemplatePart),

  partOrder: Schema.Array(Schema.String),

  brightBoundaries: Schema.optionalKey(Schema.Array(CharRange)),
});

const Template = Schema.Struct({
  lines: Schema.Record(Schema.String, TemplateLine),
});

const LineState = Schema.Struct({
  parts: Schema.Record(
    Schema.String,
    Schema.Union([Schema.Boolean, Schema.String])
  ),
  entering: Schema.optionalKey(Schema.Boolean),
  dimmed: Schema.optionalKey(Schema.Boolean),
  background: Schema.optionalKey(LineBackground),
});

const StatusRange = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  status: StatusKind,
});

const Overlay = Schema.Struct({
  lineIndex: Schema.Finite,
  start: Schema.Finite,
  end: Schema.Finite,
  color: Schema.optionalKey(Schema.String),
});

const CursorTarget = Schema.Struct({
  lineIndex: Schema.Finite,
  charOffset: Schema.Finite,
  textLength: Schema.Finite,
  type: Schema.optionalKey(CursorType),
});

const BurstTarget = Schema.Struct({
  lineIndex: Schema.Finite,
  charOffset: Schema.Finite,
  textLength: Schema.Finite,
  emoji: Schema.Array(Schema.String),
  count: Schema.Finite,
});

const Spotlight = Schema.Struct({
  ranges: Schema.Record(Schema.String, Schema.Array(CharRange)),

  allRanges: Schema.Record(Schema.String, Schema.Array(CharRange)),
  dim: Schema.Finite,
  glow: Schema.Boolean,
});

const StatusIndicators = Schema.Struct({
  ranges: Schema.Record(Schema.String, Schema.Array(StatusRange)),

  allRanges: Schema.Record(Schema.String, Schema.Array(CharRange)),
});

const FrameState = Schema.Struct({
  id: Schema.Finite,

  lineOrder: Schema.Array(Schema.String),
  state: Schema.Record(Schema.String, LineState),
  marks: Schema.Array(Overlay),
  glows: Schema.Array(Overlay),
  squiggles: Schema.Array(Overlay),
  brightRanges: Schema.Array(Overlay),
  spotlight: Schema.optionalKey(Spotlight),
  status: Schema.optionalKey(StatusIndicators),
  cursor: Schema.optionalKey(CursorTarget),
  bursts: Schema.Array(BurstTarget),
  sound: Schema.optionalKey(AnimationSoundName),

  say: Schema.optionalKey(Schema.String),
});

export const CodeSlideshow = Schema.Struct({
  template: Template,
  frames: Schema.Array(FrameState),
});
