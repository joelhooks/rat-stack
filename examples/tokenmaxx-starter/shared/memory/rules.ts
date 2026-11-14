import { randomBytes } from "node:crypto";

import { sha256 } from "#shared/core/ids.ts";

// The memory piece's house rules. Each one says how a person is written in
// the release log. A fresh agent writes the name the way the task gives it
// ("Priya Nair"), which breaks every rule here, so the first try fails and
// the rejection says why.
//
// The rules are mutually exclusive: an entry that follows one breaks all the
// others. That is what lets the check tell "followed the new rule" apart
// from "still applying the old one".
//
// Which rule is in force is stored sealed (a salted hash of its id), so
// neither this file nor the state folder says which one it is. Only a
// rejection, or `change-rule`, does.

export type Person = { readonly first: string; readonly last: string };

export type HouseRule = {
  readonly id: string;
  /** How this rule writes `person`, e.g. `PN`. */
  readonly form: (person: Person) => string;
  /** Matches this rule's form of `person` in an entry. */
  readonly marker: (person: Person) => RegExp;
  /** The rule in words, ending with `person` as the example. */
  readonly says: (person: Person) => string;
};

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
const initial = (name: string) => name.slice(0, 1);
const fullName = (p: Person) => `${p.first} ${p.last}`;

const initials = (p: Person) =>
  `${initial(p.first)}${initial(p.last)}`.toUpperCase();
const handle = (p: Person) => `@${initial(p.first)}${p.last}`.toLowerCase();
const surnameFirst = (p: Person) => `${p.last}, ${p.first}`;
const firstAndInitial = (p: Person) => `${p.first} ${initial(p.last)}.`;

export const houseRules: readonly HouseRule[] = [
  {
    id: "initials",
    form: initials,
    marker: (p) => new RegExp(`\\b${initials(p)}\\b`),
    says: (p) =>
      `people are written as their initials in capitals, never by name. ${fullName(p)} is ${initials(p)}`,
  },
  {
    id: "handle",
    form: handle,
    marker: (p) => new RegExp(`${escape(handle(p))}\\b`, "i"),
    says: (p) =>
      `people are written as their handle, never by name: @, first initial, surname, all lowercase. ${fullName(p)} is ${handle(p)}`,
  },
  {
    id: "surname-first",
    form: surnameFirst,
    marker: (p) => new RegExp(`\\b${escape(surnameFirst(p))}\\b`),
    says: (p) =>
      `people are written surname first, with a comma. ${fullName(p)} is "${surnameFirst(p)}"`,
  },
  {
    id: "first-and-initial",
    form: firstAndInitial,
    marker: (p) => new RegExp(`\\b${escape(firstAndInitial(p))}(?!\\w)`),
    says: (p) =>
      `people are written as first name and surname initial. ${fullName(p)} is "${firstAndInitial(p)}"`,
  },
];

export function ruleById(id: string): HouseRule {
  const rule = houseRules.find((r) => r.id === id);
  if (rule === undefined) {
    throw new Error(`no house rule ${id}`);
  }
  return rule;
}

/** True when `entry` names `person` in any form: first name, surname, initials or handle. */
export function mentions(entry: string, person: Person): boolean {
  const word = (w: string) => new RegExp(`\\b${escape(w)}\\b`, "i");
  return (
    word(person.first).test(entry) ||
    word(person.last).test(entry) ||
    houseRules.some((rule) => rule.marker(person).test(entry))
  );
}

/** The entry writes `person` this rule's way, and in no other way. */
export function follows(
  rule: HouseRule,
  entry: string,
  person: Person
): boolean {
  const marker = rule.marker(person);
  if (!marker.test(entry)) {
    return false;
  }
  const rest = entry.replaceAll(
    new RegExp(marker.source, `${marker.flags}g`),
    " "
  );
  return !mentions(rest, person);
}

/** The entry uses this rule's form of `person` anywhere, even mixed with others. */
export function usesForm(
  rule: HouseRule,
  entry: string,
  person: Person
): boolean {
  return rule.marker(person).test(entry);
}

// ---- Sealing: which rule is in force, without saying so on disk.

export type Sealed = { readonly salt: string; readonly seal: string };

export function seal(ruleId: string, salt = randomBytes(8).toString("hex")) {
  return { salt, seal: sha256(`${salt}:${ruleId}`) } satisfies Sealed;
}

/** The rule a seal stands for. Throws when it matches none. */
export function unseal(sealed: Sealed): HouseRule {
  const rule = houseRules.find(
    (r) => sha256(`${sealed.salt}:${r.id}`) === sealed.seal
  );
  if (rule === undefined) {
    throw new Error(
      "The house rule in this exercise's state matches no known rule. Run setup to start over."
    );
  }
  return rule;
}
