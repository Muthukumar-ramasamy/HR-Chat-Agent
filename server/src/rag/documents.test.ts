import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isHeading, loadAllDocuments, parsePlainText, parseWordHtml, splitLongSections } from "./documents";
import { PolicyIndex } from "./policyIndex";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url)); // fictional Travel Policy as .pdf and .docx

test("heading detection for PDF/plain text lines", () => {
  for (const h of ["4. Earned Leave", "4.2 Notice period", "Section 3: Travel", "HOTEL LIMITS"]) assert.ok(isHeading(h), h);
  for (const t of ["Hotel stays are reimbursed up to 4000 rupees.", "Applies to all staff,", "x", "A"]) assert.ok(!isHeading(t), t);
});

test("plain text: title, numbered sections, text before the first heading kept as Overview", () => {
  const sections = parsePlainText("Travel Policy\nIntro line.\n1. Scope\nAll staff.\n2. Hotels\nUp to 4000 per night.", "fallback");
  assert.deepEqual(sections, [
    { doc: "Travel Policy", section: "Overview", text: "Intro line." },
    { doc: "Travel Policy", section: "1. Scope", text: "All staff." },
    { doc: "Travel Policy", section: "2. Hotels", text: "Up to 4000 per night." },
  ]);
});

test("Word HTML: first h1 is the title, headings start sections, entities decoded", () => {
  const html = "<h1>Travel Policy</h1><h2>1. Hotels</h2><p>Up to 4000 &amp; no minibar.</p><ul><li>Metro only</li></ul>";
  assert.deepEqual(parseWordHtml(html, "fallback"), [
    { doc: "Travel Policy", section: "1. Hotels", text: "Up to 4000 & no minibar. Metro only" },
  ]);
});

test("long sections are split into parts at sentence boundaries", () => {
  const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} about travel rules.`).join(" ");
  const parts = splitLongSections([{ doc: "D", section: "Rules", text }], 300);
  assert.ok(parts.length > 1);
  assert.equal(parts[0].section, "Rules (part 1)");
  assert.ok(parts.every((p) => p.text.length <= 300));
  assert.equal(parts.map((p) => p.text).join(" "), text);
});

test("PDF and Word files are loaded and searchable", async () => {
  const docs = await loadAllDocuments(FIXTURES);
  assert.deepEqual(docs.map((d) => d.file), ["travel-policy.docx", "travel-policy.pdf"]);
  for (const d of docs) {
    assert.equal(d.error, undefined);
    assert.deepEqual(d.sections.map((s) => s.section), ["1. Scope", "2. Hotel limits", "3. Per diem"]);
    assert.ok(d.sections.every((s) => s.doc === "Travel Policy"));
  }
  const hit = new PolicyIndex(docs.flatMap((d) => d.sections)).search("hotel limit per night")[0];
  assert.equal(hit.section, "2. Hotel limits");
  assert.match(hit.text, /4000 rupees per night/);
});

test("an unreadable file is reported, not fatal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hr-policies-"));
  try {
    writeFileSync(join(dir, "broken.pdf"), "not really a pdf");
    writeFileSync(join(dir, "ok.md"), "# OK Policy\n## 1. Rule\nText.");
    writeFileSync(join(dir, "notes.xlsx"), "ignored");
    const docs = await loadAllDocuments(dir);
    assert.deepEqual(docs.map((d) => d.file), ["broken.pdf", "ok.md"]);
    assert.ok(docs[0].error);
    assert.equal(docs[1].sections[0].doc, "OK Policy");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
