import { test } from "node:test";
import assert from "node:assert/strict";
import { getPolicyIndex, parsePolicy, tokenize } from "./policyIndex";

const top = (query: string) => getPolicyIndex().search(query)[0];
const label = (query: string) => {
  const hit = top(query);
  return hit ? `${hit.doc} | ${hit.section}` : "none";
};

test("parsePolicy splits '## ' sections under the '# ' title", () => {
  const sections = parsePolicy("# Leave Policy\nintro\n## 1. A\nline one\nline two\n## 2. B\nx");
  assert.deepEqual(sections, [
    { doc: "Leave Policy", section: "1. A", text: "line one line two" },
    { doc: "Leave Policy", section: "2. B", text: "x" },
  ]);
});

test("tokenize drops stopwords and plurals", () => {
  assert.deepEqual(tokenize("What are the holidays for leaves?"), ["holiday", "leave"]);
});

test("all policy files are indexed", () => {
  assert.equal(getPolicyIndex().sections.length, 18);
});

test("questions find the right section", () => {
  assert.equal(label("How many earned leave days can I carry forward?"), "Leave Policy | 4. Earned Leave (EL)");
  assert.equal(label("Do I need a doctor's note for sick leave?"), "Leave Policy | 3. Sick Leave (SL)");
  assert.equal(label("max consecutive days of casual leave"), "Leave Policy | 2. Casual Leave (CL)");
  assert.equal(label("what happens if I work on a public holiday"), "Holiday Policy | 3. Working on a holiday");
  assert.equal(label("how many WFH days per week"), "Attendance and Work From Home Policy | 2. Work from home (WFH)");
  assert.equal(label("paternity leave"), "Leave Policy | 10. Maternity and paternity leave");
});

test("mixed questions include every relevant section in the results", () => {
  const sections = getPolicyIndex().search("Can I encash my vacation days?").map((h) => h.section);
  assert.ok(sections.includes("5. Leave encashment"));
  assert.ok(sections.includes("4. Earned Leave (EL)"));
});

test("unrelated questions return nothing", () => {
  assert.equal(getPolicyIndex().search("pet insurance reimbursement").length, 0);
  // Only the common word "leave" matches: not enough.
  assert.equal(getPolicyIndex().search("bereavement leave").length, 0);
});

test("results are capped and weak matches dropped", () => {
  const hits = getPolicyIndex().search("leave");
  assert.ok(hits.length <= 3);
  assert.ok(hits.every((h) => h.score >= hits[0].score * 0.5));
});
