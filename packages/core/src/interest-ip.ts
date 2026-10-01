import { Option } from "effect";

const parseIpv4 = (value: string) => {
  const parts = value.split(".");

  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/u.test(part))) {
    return Option.none<readonly number[]>();
  }

  const numbers = parts.map(Number);

  return numbers.every((part) => part <= 255)
    ? Option.some(numbers)
    : Option.none<readonly number[]>();
};

const parseHextets = (value: string) => {
  if (value === "") {
    return Option.some<readonly number[]>([]);
  }

  const groups = value.split(":");

  if (!groups.every((group) => /^[0-9a-f]{1,4}$/u.test(group))) {
    return Option.none<readonly number[]>();
  }

  return Option.some(groups.map((group) => Number.parseInt(group, 16)));
};

const parseIpv6 = (raw: string) => {
  let value = raw.toLowerCase();
  const tail = value.slice(value.lastIndexOf(":") + 1);
  let embedded: readonly number[] = [];

  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);

    if (Option.isNone(v4)) {
      return Option.none<readonly number[]>();
    }

    const [a = 0, b = 0, c = 0, d = 0] = v4.value;
    embedded = [a * 256 + b, c * 256 + d];
    value = value.slice(0, value.length - tail.length);

    if (value.endsWith(":") && !value.endsWith("::")) {
      value = value.slice(0, -1);
    }
  }

  const halves = value.split("::");

  if (halves.length > 2) {
    return Option.none<readonly number[]>();
  }

  const head = parseHextets(halves[0] ?? "");
  const rest = halves.length === 2 ? parseHextets(halves[1] ?? "") : undefined;

  if (Option.isNone(head) || (rest !== undefined && Option.isNone(rest))) {
    return Option.none<readonly number[]>();
  }

  const front = head.value;
  const back = [...(rest === undefined ? [] : rest.value), ...embedded];

  if (rest === undefined) {
    const all = [...front, ...embedded];

    return all.length === 8
      ? Option.some(all)
      : Option.none<readonly number[]>();
  }

  const fill = 8 - front.length - back.length;

  return fill < 1
    ? Option.none<readonly number[]>()
    : Option.some([
        ...front,
        ...Array.from({ length: fill }, () => 0),
        ...back,
      ]);
};

const hex = (value: number | undefined) => (value ?? 0).toString(16);

const formatIpv6 = (hextets: readonly number[]) => {
  let bestStart = -1;
  let bestLength = 0;

  for (let start = 0; start < 8; start += 1) {
    let length = 0;

    while (start + length < 8 && hextets[start + length] === 0) {
      length += 1;
    }

    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
  }

  if (bestLength < 2) {
    return hextets.map(hex).join(":");
  }

  const before = hextets.slice(0, bestStart).map(hex).join(":");

  const after = hextets
    .slice(bestStart + bestLength)
    .map(hex)
    .join(":");

  return `${before}::${after}`;
};

export const normalizeClientIp = (raw: string | undefined) => {
  const value = (raw ?? "").trim();

  if (value === "") {
    return Option.none<string>();
  }

  const v4 = parseIpv4(value);

  if (Option.isSome(v4)) {
    return Option.some(v4.value.join("."));
  }

  if (!value.includes(":")) {
    return Option.none<string>();
  }

  const v6 = parseIpv6(value);

  if (Option.isNone(v6)) {
    return Option.none<string>();
  }

  const hextets = v6.value;

  if (
    hextets.length === 8 &&
    hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    hextets[5] === 0xff_ff
  ) {
    const high = hextets[6] ?? 0;
    const low = hextets[7] ?? 0;

    return Option.some(
      [
        Math.floor(high / 256),
        high % 256,
        Math.floor(low / 256),
        low % 256,
      ].join(".")
    );
  }

  return Option.some(formatIpv6(hextets));
};
