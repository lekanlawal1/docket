import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, diff, report } from "../js/diff.js";

const lease = [
  "This lease is between the landlord and the tenant for the unit at 14 Harbour Road.\nThe tenant agrees to pay rent of $1,450 on the first day of every month.",
  "Late rent will be charged a fee of $50 after the fifth day of the month.\nPets are not allowed in the unit.",
];

test("identical documents have no changes", () => {
  const { changes, stats } = compare(lease, lease);
  assert.equal(changes.length, 0);
  assert.equal(stats.same, 1);
});

test("re-wrapping lines or moving text to another page isn't a change", () => {
  const rewrapped = [lease.join("\n").replace(/\n/g, " ").replace("Late rent", "Late\nrent")];
  assert.equal(compare(lease, rewrapped).changes.length, 0);
});

test("a changed amount is one change, flagged as a number", () => {
  const next = [lease[0].replace("$1,450", "$1,550"), lease[1]];
  const { changes } = compare(lease, next);
  assert.equal(changes.length, 1);
  assert.deepEqual([changes[0].kind, changes[0].removed, changes[0].added, changes[0].numbers], ["changed", "$1,450", "$1,550", true]);
  assert.match(changes[0].before, /pay rent of$/);
  assert.match(changes[0].after, /^on the first day/);
});

test("added and removed sentences are labelled and placed on the right page", () => {
  const next = [lease[0], "Late rent will be charged a fee of $50 after the fifth day of the month.\nSmall pets are allowed with written permission.\nThe tenant must carry insurance."];
  const { changes } = compare(lease, next);
  const kinds = changes.map((c) => c.kind);
  assert.ok(kinds.includes("changed") || kinds.includes("added"));
  const insurance = changes.find((c) => c.added.includes("insurance"));
  assert.equal(insurance.newPage, 2);
  assert.ok(changes.every((c) => c.oldPage === 2));
});

test("edits a word apart become one readable change", () => {
  const next = [lease[0].replace("first day of every month", "fifth day of each month"), lease[1]];
  const { changes } = compare(lease, next);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].removed, "first day of every");
  assert.equal(changes[0].added, "fifth day of each");
});

test("loose mode ignores capitals and punctuation; strict mode doesn't", () => {
  const next = [lease[0].replace("This lease", "THIS LEASE").replace("Road.", "Road"), lease[1]];
  assert.equal(compare(lease, next, { loose: true }).changes.length, 0);
  assert.ok(compare(lease, next).changes.length >= 1);
});

test("curly quotes and dashes match their plain versions", () => {
  const a = ["The tenant's deposit - if any - is held."], b = ["The tenant’s deposit – if any – is held."];
  assert.equal(compare(a, b).changes.length, 0);
});

test("a long document with a few edits is compared quickly and exactly", () => {
  const para = (k) => `Clause ${k}. The parties agree to term number ${k} of this agreement, which applies to every unit and every month of the lease.`;
  const old = Array.from({ length: 40 }, (_, p) => Array.from({ length: 30 }, (_, k) => para(p * 30 + k)).join("\n"));
  const next = old.map((t, p) => (p === 7 ? t.replace("Clause 215.", "Clause 215 (amended).") : p === 30 ? t.replace(para(905), "") : t));
  const t0 = Date.now();
  const { changes, stats } = compare(old, next);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms for ${stats.oldWords} words`);
  assert.equal(changes.length, 2);
  assert.deepEqual([changes[0].removed, changes[0].added], ["215.", "215 (amended)."]);
  assert.equal(changes[1].kind, "removed");
  assert.equal(changes[1].oldPage, 31);
});

test("the raw diff is a valid edit script", () => {
  const a = "a b c d e f".split(" "), b = "a x c d y f g".split(" ");
  const ops = diff(a, b);
  const rebuilt = ops.filter(([o]) => o !== "-").map(([o, i, j]) => (o === "=" ? a[i] : b[j]));
  assert.deepEqual(rebuilt, b);
  assert.deepEqual(ops.filter(([o]) => o !== "+").map(([, i]) => a[i]), a);
});

test("the text report lists every change", () => {
  const next = [lease[0].replace("$1,450", "$1,550"), lease[1].replace("Pets are not allowed in the unit.", "")];
  const text = report(compare(lease, next), { oldName: "lease-v1.pdf", newName: "lease-v2.pdf" });
  assert.match(text, /2 changes/);
  assert.match(text, /Removed: \$1,450\n\s+Added:\s+\$1,550/);
  assert.match(text, /Removed: Pets are not allowed in the unit\./);
});
