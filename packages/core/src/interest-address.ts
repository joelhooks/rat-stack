import { Option } from "effect";

const ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const CONTROL_CHARACTER = /\p{Cc}/u;

const MAX_ADDRESS_LENGTH = 254;

export const normalizeAddress = (raw: string): Option.Option<string> => {
  const address = raw.trim().toLowerCase();

  return address.length <= MAX_ADDRESS_LENGTH &&
    !CONTROL_CHARACTER.test(address) &&
    ADDRESS_PATTERN.test(address)
    ? Option.some(address)
    : Option.none();
};
