import { MotionInputError } from "./easing.pure.js";

export type Vector = readonly number[];

export const mix = (from: number, to: number, amount: number) => {
  if (amount === 0) {
    return from;
  }

  if (amount === 1) {
    return to;
  }

  return from + (to - from) * amount;
};

const requireSameLength = (from: Vector, to: Vector) => {
  if (from.length !== to.length) {
    throw new MotionInputError(
      `Cannot interpolate a ${from.length}-dimensional value toward a ${to.length}-dimensional one. Give both endpoints the same number of components.`
    );
  }
};

export const mixVectorInto = <Into extends number[] | Float64Array>(
  from: Vector,
  to: Vector,
  amount: number,
  into: Into
): Into => {
  requireSameLength(from, to);

  for (let index = 0; index < from.length; index += 1) {
    into[index] = mix(from[index] ?? 0, to[index] ?? 0, amount);
  }

  return into;
};

export const mixVector = (from: Vector, to: Vector, amount: number): Vector =>
  mixVectorInto(
    from,
    to,
    amount,
    Array.from({ length: from.length }, () => 0)
  );

export interface Rgba {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

const HEX_COLOR = /^#(?<digits>[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu;

const FUNCTIONAL_COLOR = /^rgba?\((?<body>[^)]*)\)$/iu;

const hexChannel = (digits: string) =>
  Number.parseInt(digits.length === 1 ? digits + digits : digits, 16) / 255;

const parseHex = (digits: string): Rgba => {
  const width = digits.length <= 4 ? 1 : 2;

  const channels = Array.from({ length: digits.length / width }, (_, index) =>
    hexChannel(digits.slice(index * width, index * width + width))
  );

  return {
    alpha: channels[3] ?? 1,
    blue: channels[2] ?? 0,
    green: channels[1] ?? 0,
    red: channels[0] ?? 0,
  };
};

const invalidColor = (input: string, reason: string) =>
  new MotionInputError(
    `Cannot read colour ${JSON.stringify(input)}: ${reason}. Use #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(r g b) or rgba(r, g, b, a).`
  );

const parseComponent = (input: string, text: string, scale: number) => {
  const percent = text.endsWith("%");
  const value = Number(percent ? text.slice(0, -1) : text);

  if (text === "" || !Number.isFinite(value)) {
    throw invalidColor(input, `${JSON.stringify(text)} is not a number`);
  }

  return clampUnit(percent ? value / 100 : value / scale);
};

const parseFunctional = (input: string, body: string): Rgba => {
  const parts = body
    .trim()
    .split(/\s*[\s,/]\s*/u)
    .filter((part) => part !== "");

  if (parts.length !== 3 && parts.length !== 4) {
    throw invalidColor(
      input,
      `expected 3 or 4 components, got ${parts.length}`
    );
  }

  const [red = "", green = "", blue = "", alpha = "1"] = parts;

  return {
    alpha: parseComponent(input, alpha, 1),
    blue: parseComponent(input, blue, 255),
    green: parseComponent(input, green, 255),
    red: parseComponent(input, red, 255),
  };
};

export const parseColor = (input: string): Rgba => {
  const text = input.trim();
  const hex = HEX_COLOR.exec(text)?.groups?.digits;

  if (hex !== undefined) {
    return parseHex(hex);
  }

  const body = FUNCTIONAL_COLOR.exec(text)?.groups?.body;

  if (body !== undefined) {
    return parseFunctional(input, body);
  }

  throw invalidColor(input, "the format is not recognised");
};

const hexByte = (unit: number) =>
  Math.round(clampUnit(unit) * 255)
    .toString(16)
    .padStart(2, "0");

export const formatColor = (color: Rgba) =>
  `#${hexByte(color.red)}${hexByte(color.green)}${hexByte(color.blue)}${
    color.alpha >= 1 ? "" : hexByte(color.alpha)
  }`;

const toLinear = (encoded: number) =>
  encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;

const toEncoded = (light: number) =>
  light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055;

interface Oklab {
  readonly lightness: number;
  readonly a: number;
  readonly b: number;
}

const toOklab = (color: Rgba): Oklab => {
  const red = toLinear(color.red);
  const green = toLinear(color.green);
  const blue = toLinear(color.blue);

  const long = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue
  );

  const medium = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue
  );

  const short = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue
  );

  return {
    a: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
    lightness:
      0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
  };
};

const fromOklab = (color: Oklab, alpha: number): Rgba => {
  const long =
    (color.lightness + 0.3963377774 * color.a + 0.2158037573 * color.b) ** 3;

  const medium =
    (color.lightness - 0.1055613458 * color.a - 0.0638541728 * color.b) ** 3;

  const short =
    (color.lightness - 0.0894841775 * color.a - 1.291485548 * color.b) ** 3;

  return {
    alpha,
    blue: clampUnit(
      toEncoded(
        -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short
      )
    ),
    green: clampUnit(
      toEncoded(
        -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short
      )
    ),
    red: clampUnit(
      toEncoded(
        4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short
      )
    ),
  };
};

export const mixColor = (from: Rgba, to: Rgba, amount: number): Rgba => {
  if (amount === 0) {
    return from;
  }

  if (amount === 1) {
    return to;
  }

  const start = toOklab(from);
  const end = toOklab(to);
  const alpha = clampUnit(mix(from.alpha, to.alpha, amount));

  const premultiplied = (first: number, second: number) =>
    mix(first * from.alpha, second * to.alpha, amount);

  if (alpha === 0) {
    return fromOklab(
      {
        a: mix(start.a, end.a, amount),
        b: mix(start.b, end.b, amount),
        lightness: mix(start.lightness, end.lightness, amount),
      },
      0
    );
  }

  return fromOklab(
    {
      a: premultiplied(start.a, end.a) / alpha,
      b: premultiplied(start.b, end.b) / alpha,
      lightness: premultiplied(start.lightness, end.lightness) / alpha,
    },
    alpha
  );
};

export interface Transform2D {
  readonly translateX: number;
  readonly translateY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotate: number;
}

export const identityTransform: Transform2D = {
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
};

export const mixTransform = (
  from: Transform2D,
  to: Transform2D,
  amount: number
): Transform2D => {
  if (amount === 0) {
    return from;
  }

  if (amount === 1) {
    return to;
  }

  return {
    rotate: mix(from.rotate, to.rotate, amount),
    scaleX: mix(from.scaleX, to.scaleX, amount),
    scaleY: mix(from.scaleY, to.scaleY, amount),
    translateX: mix(from.translateX, to.translateX, amount),
    translateY: mix(from.translateY, to.translateY, amount),
  };
};

export const formatTransform = (transform: Transform2D) =>
  `translate(${transform.translateX}px, ${transform.translateY}px) rotate(${transform.rotate}rad) scale(${transform.scaleX}, ${transform.scaleY})`;
