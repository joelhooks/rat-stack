import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";

import {
  formatColor,
  formatTransform,
  identityTransform,
  mix,
  mixColor,
  mixTransform,
  mixVector,
  parseColor,
} from "../src/index.js";
import type { Rgba, Transform2D } from "../src/index.js";
import {
  between,
  coordinate,
  decimal,
  falsifies,
  integerBetween,
  unit,
  vectorOf,
} from "./arbitraries.js";

const byte = integerBetween(0, 255);

const color = Arbitrary.all({
  alpha: byte,
  blue: byte,
  green: byte,
  red: byte,
}).pipe(
  Arbitrary.map(({ alpha, blue, green, red }): Rgba => ({
    alpha: alpha / 255,
    blue: blue / 255,
    green: green / 255,
    red: red / 255,
  }))
);

const transform = Arbitrary.all({
  rotate: between(-10, 10),
  scaleX: between(-4, 4),
  scaleY: between(-4, 4),
  translateX: coordinate,
  translateY: coordinate,
});

const hexColor = Arbitrary.all([byte, byte, byte]).pipe(
  Arbitrary.map(
    (channels) =>
      `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
  )
);

type Mixer = (from: number, to: number, amount: number) => number;

const endpointsExact = (lerp: Mixer, from: number, to: number) =>
  lerp(from, to, 0) === from && lerp(from, to, 1) === to;

const naiveMix: Mixer = (from, to, amount) => from + (to - from) * amount;

const isInsideUnitGamut = (value: Rgba) =>
  [value.red, value.green, value.blue, value.alpha].every(
    (channel) => channel >= 0 && channel <= 1
  );

describe("interpolate", () => {
  it.prop(
    "numbers land exactly on both endpoints and stay between them",
    { amount: unit, from: decimal, to: decimal },
    ({ amount, from, to }) => {
      const value = mix(from, to, amount);

      expect(endpointsExact(mix, from, to)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(Math.min(from, to));
      expect(value).toBeLessThanOrEqual(Math.max(from, to));
    }
  );

  it.prop(
    "tuples land exactly on both endpoints",
    { from: vectorOf(4), to: vectorOf(4) },
    ({ from, to }) => {
      expect(mixVector(from, to, 0)).toStrictEqual(from);
      expect(mixVector(from, to, 1)).toStrictEqual(to);
    }
  );

  it.prop(
    "colours land exactly on both endpoints and stay in gamut between them",
    { amount: unit, from: color, to: color },
    ({ amount, from, to }) => {
      expect(mixColor(from, to, 0)).toStrictEqual(from);
      expect(mixColor(from, to, 1)).toStrictEqual(to);
      expect(isInsideUnitGamut(mixColor(from, to, amount))).toBe(true);
    }
  );

  it.prop(
    "mixing a colour with itself in OKLab returns the same 8-bit colour",
    { amount: unit, value: color },
    ({ amount, value }) => {
      expect(formatColor(mixColor(value, value, amount))).toBe(
        formatColor(value)
      );
    }
  );

  it.prop(
    "hex colours survive a parse and format round trip",
    { hex: hexColor },
    ({ hex }) => {
      expect(formatColor(parseColor(hex))).toBe(hex);
    }
  );

  it.prop(
    "transforms land exactly on both endpoints",
    { from: transform, to: transform },
    ({ from, to }) => {
      expect(mixTransform(from, to, 0)).toStrictEqual(from);
      expect(mixTransform(from, to, 1)).toStrictEqual(to);
    }
  );

  it("reads every supported colour syntax and names the fix for the rest", () => {
    expect(formatColor(parseColor("#f0a"))).toBe("#ff00aa");
    expect(formatColor(parseColor("#ff149380"))).toBe("#ff149380");
    expect(formatColor(parseColor("rgb(255 20 147)"))).toBe("#ff1493");
    expect(formatColor(parseColor("rgba(255, 20, 147, 0.5)"))).toBe(
      "#ff149380"
    );
    expect(() => parseColor("hotpink")).toThrow(
      /Use #rgb, #rgba, #rrggbb, #rrggbbaa/u
    );
    expect(() => mixVector([0, 1], [0], 0.5)).toThrow(
      /same number of components/u
    );
  });

  it("formats a decomposed transform for CSS", () => {
    const halfway: Transform2D = mixTransform(
      identityTransform,
      { rotate: Math.PI, scaleX: 3, scaleY: 1, translateX: 40, translateY: -8 },
      0.5
    );

    expect(formatTransform(halfway)).toBe(
      `translate(20px, -4px) rotate(${Math.PI / 2}rad) scale(2, 1)`
    );
  });

  describe("planted bugs", () => {
    it.effect("the endpoint property catches a lerp without exact ends", () =>
      falsifies(Arbitrary.all([decimal, decimal]), ([from, to]) =>
        endpointsExact(naiveMix, from, to)
      )
    );
  });
});
