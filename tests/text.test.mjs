import { test } from "node:test";
import assert from "node:assert/strict";
import { sentences, summarize, findItems } from "../js/text.js";

test("abbreviations don't end a sentence", () => {
  assert.deepEqual(sentences("See e.g. the lease. Rent is due on Jan. 5 each month. Call Dr. Lee."),
    ["See e.g. the lease.", "Rent is due on Jan. 5 each month.", "Call Dr. Lee."]);
});

test("the summary only uses sentences from the text, in their original order", () => {
  const text = [
    "The tenant agrees to pay rent of $1,450 on the first day of every month.",
    "The weather in the area is usually mild in the spring and autumn months.",
    "Late rent will be charged a fee of $50 after the fifth day of the month.",
    "The landlord will repair the heating within three days of being told about a problem.",
    "Rent increases need sixty days written notice from the landlord to the tenant.",
    "There is a small park two streets away that has a playground and benches.",
    "The tenant must give the landlord sixty days notice before moving out of the unit.",
  ].join(" ");
  const { picked, total } = summarize(text, 3);
  assert.equal(total, 7);
  assert.equal(picked.length, 3);
  for (const s of picked) assert.ok(text.includes(s));
  const order = picked.map((s) => text.indexOf(s));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(picked.some((s) => /rent/i.test(s)));
});

test("short texts come back whole", () => {
  const { picked, total } = summarize("This is a short note about one thing only. It has just two sentences in it.", 5);
  assert.equal(total, 2);
  assert.equal(picked.length, 2);
});

test("finds dates, amounts, percentages, emails, links and phone numbers", () => {
  const found = findItems(`Signed on March 3, 2026 and again 2026-04-01. Pay $1,200.50 plus 3.5% interest.
    Write to jo@example.com or see https://example.com/terms. Call (705) 555-0142. Pay $1,200.50 by 04/15/2026.`);
  const values = (k) => found[k].map((x) => x.value);
  assert.deepEqual(values("Dates"), ["March 3, 2026", "2026-04-01", "04/15/2026"]);
  assert.deepEqual(found.Amounts, [{ value: "$1,200.50", count: 2 }]);
  assert.deepEqual(values("Percentages"), ["3.5%"]);
  assert.deepEqual(values("Emails"), ["jo@example.com"]);
  assert.deepEqual(values("Links"), ["https://example.com/terms"]);
  assert.deepEqual(values("Phone numbers"), ["(705) 555-0142"]);
});
