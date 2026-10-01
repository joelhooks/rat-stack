import { expect, it } from "@effect/vitest";
import { Option } from "effect";

import { normalizeClientIp } from "../src/interest-ip.js";

const normalized = (raw: string | undefined) =>
  Option.getOrUndefined(normalizeClientIp(raw));

it("keeps IPv4 as a dotted quad", () => {
  expect(normalized("203.0.113.7")).toBe("203.0.113.7");
  expect(normalized(" 203.0.113.007 ")).toBe("203.0.113.7");
});

it("writes IPv6 in RFC 5952 form", () => {
  expect(normalized("2001:DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
  expect(normalized("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(
    "2001:db8::1"
  );
  expect(normalized("2001:db8:0:1:0:0:0:1")).toBe("2001:db8:0:1::1");
  expect(normalized("2001:db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1");
  expect(normalized("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1");
  expect(normalized("0:0:0:0:0:0:0:0")).toBe("::");
  expect(normalized("::1")).toBe("::1");
  expect(normalized("FE80::ABCD")).toBe("fe80::abcd");
});

it("turns an IPv4-mapped IPv6 address into plain IPv4", () => {
  expect(normalized("::ffff:203.0.113.7")).toBe("203.0.113.7");
  expect(normalized("::FFFF:cb00:7107")).toBe("203.0.113.7");
  expect(normalized("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
});

it("rejects a missing or malformed address", () => {
  for (const raw of [
    undefined,
    "",
    "   ",
    "unknown",
    "203.0.113",
    "203.0.113.256",
    "1.2.3.4.5",
    "2001:db8::1::2",
    "2001:db8:::1",
    "12345::1",
    "2001:db8:0:0:0:0:0:0:1",
    "g::1",
  ]) {
    expect(normalized(raw)).toBeUndefined();
  }
});
