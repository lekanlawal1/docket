import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRanges, chunks, describe } from "../js/ranges.js";

test("single pages and ranges", () => {
  assert.deepEqual(parseRanges("1-3, 5", 10), [[0, 1, 2], [4]]);
  assert.deepEqual(parseRanges("2 to 4", 10), [[1, 2, 3]]);
});

test("open-ended ranges run to the first or last page", () => {
  assert.deepEqual(parseRanges("8-", 10), [[7, 8, 9]]);
  assert.deepEqual(parseRanges("-2", 10), [[0, 1]]);
});

test("a backwards range comes out backwards", () => {
  assert.deepEqual(parseRanges("5-3", 10), [[4, 3, 2]]);
});

test("mistakes get plain-words errors", () => {
  assert.throws(() => parseRanges("", 5), /Type some pages/);
  assert.throws(() => parseRanges("7", 5), /only has 5 pages/);
  assert.throws(() => parseRanges("0", 5), /start at 1/);
  assert.throws(() => parseRanges("abc", 5), /isn't a page/);
});

test("chunks splits evenly with a short last piece", () => {
  assert.deepEqual(chunks(7, 3), [[0, 1, 2], [3, 4, 5], [6]]);
  assert.throws(() => chunks(5, 0));
});

test("describe turns pages back into the short form", () => {
  assert.equal(describe([0, 1, 2, 4, 7, 8]), "1-3, 5, 8-9");
  assert.equal(describe([]), "");
});
