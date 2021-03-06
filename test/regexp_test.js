/**
 * @author Louis-Dominique Dubeau
 * @license MPL 2.0
 * @copyright Mangalam Research Center for Buddhist Languages
 */
/* global it, describe */

"use strict";

const { assert } = require("chai");
const XRegExp = require("xregexp");
const regexp = require("../build/dist/lib/salve/datatypes/regexp");

const conversionTests = [
  "", "^$", RegExp,
  "abc", "^abc$", RegExp,
  "abc|def", "^abc|def$", RegExp,
  "abc+", "^abc+$", RegExp,
  "abc?", "^abc?$", RegExp,
  "abc*", "^abc*$", RegExp,
  "ab{1}", "^ab{1}$", RegExp,
  "ab{1,2}", "^ab{1,2}$", RegExp,
  "ab{1,}", "^ab{1,}$", RegExp,
  "ab(123)cd", "^ab(?:123)cd$", RegExp,
  "ab.", "^ab.$", RegExp,
  "ab\\scd", "^ab[ \\t\\n\\r]cd$", RegExp,
  "abcd\\p{Lm}ef", "^abcd\\p{Lm}ef$", XRegExp,
  "ab[A-Z]cd", "^ab[A-Z]cd$", RegExp,
  // Multiple char escape with other characters in char class.
  // Positive multi-char escape in positive character class.
  "ab[a\\sq]cd", "^ab[a \\t\\n\\rq]cd$", RegExp,
  // Negative multi-char escape in positive character class.
  "ab[a\\S\\Dq]cd", "^ab(?:[^ \\t\\n\\r]|[^\\p{Nd}]|[aq])cd$", XRegExp,
  // Positive multi-char escape in negative character class.
  "ab[^a\\s\\dq]cd", "^ab[^a \\t\\n\\r\\p{Nd}q]cd$", XRegExp,
  // Negative multi-char escape in negative character class.
  "ab[^a\\Sq]cd", "^ab(?:(?=[ \\t\\n\\r])[^aq])cd$", RegExp,
  "ab[^a\\S\\Dq]cd", "^ab(?:(?=[ \\t\\n\\r\\p{Nd}])[^aq])cd$", XRegExp,
  // Subtractions,
  "ab[abcd-[bc]]cd", "^ab(?:(?![bc])[abcd])cd$", RegExp,
  "ab[abcd-[bc-[c]]]cd", "^ab(?:(?!(?:(?![c])[bc]))[abcd])cd$", RegExp,
  "(\\p{L}|\\p{N}|\\p{P}|\\p{S})+", "^(?:\\p{L}|\\p{N}|\\p{P}|\\p{S})+$",
  XRegExp,
  "ab[a-d-[bc-[c]]]cd", "^ab(?:(?!(?:(?![c])[bc]))[a-d])cd$", RegExp,
];

const matchingTests = [
  true, "ab[abcd-[bc]]cd", "abdcd",
  false, "ab[abcd-[bc]]cd", "abbcd",
  false, "ab[abcd-[bc]]cd", "ab1cd",
  true, "ab[abcd-[bc-[c]]]cd", "abacd",
  false, "ab[abcd-[bc-[c]]]cd", "ab1cd",
  true, "ab[a\\sq]cd", "abacd",
  true, "ab[a\\sq]cd", "ab cd",
  false, "ab[a\\sq]cd", "ab1cd",
  true, "ab[a\\Sq]cd", "abwcd",
  false, "ab[a\\Sq]cd", "ab cd",
  true, "ab[a\\S\\Dq]cd", "abwcd",
  true, "ab[a\\S\\Dq]cd", "ab1cd", // 1 is fine because it matches \\S
  false, "ab[^a\\S\\dq]cd", "ab1cd",
  true, "[\\i]", "a",
  true, "[\\c]", "a",
];

describe("XML Schema regexp", () => {
  for (let i = 0; i < conversionTests.length; i += 3) {
    const re = conversionTests[i];
    const expected = conversionTests[i + 1];
    const constructor = conversionTests[i + 2];
    it(`'${re}' becomes '${expected}'`, () => {
      assert.equal(regexp.parse(re, "string"), expected);
      assert.instanceOf(regexp.parse(re), constructor);
    });
  }

  for (let i = 0; i < matchingTests.length; i += 3) {
    const matches = matchingTests[i];
    const re = matchingTests[i + 1];
    const text = matchingTests[i + 2];
    if (matches) {
      it(`'${re}' matches '${text}'`, () => {
        assert.isTrue(new RegExp(regexp.parse(re)).test(text));
      });
    }
    else {
      it(`'${re}' does not match '${text}'`, () => {
        assert.isFalse(new RegExp(regexp.parse(re)).test(text));
      });
    }
  }
});
