// Keyword search (BM25) over HR policy sections. Runs locally: no embeddings API, no tokens.
//
// RAG = Retrieval-Augmented Generation: find the few relevant policy sections for a question
// and give only those to the model, so it answers from the documents (with citations)
// instead of from memory.
import { config } from "../config";
import { loadAllDocuments, loadTextDocuments, parseMarkdown, type LoadedDocument } from "./documents";

export interface PolicySection {
  doc: string; // "Leave Policy"
  section: string; // "4. Earned Leave (EL)"
  text: string;
}

export interface PolicyHit extends PolicySection {
  score: number;
}

// Split a policy markdown file into "## " sections. The "# " line is the document title.
export const parsePolicy = (markdown: string): PolicySection[] => parseMarkdown(markdown);

const STOPWORDS = new Set(
  ("a an and are as at be by can do does for from how i if in is it its me my of on or our policy " +
    "rule rules should so that the their this to what when where which who will with you your acme").split(" "),
);

// Small query expansion so everyday words find the policy's terms.
const SYNONYMS: Record<string, string[]> = {
  vacation: ["earned"],
  annual: ["earned"],
  privilege: ["earned"],
  pl: ["earned"],
  el: ["earned"],
  cl: ["casual"],
  sl: ["sick"],
  ill: ["sick"],
  illness: ["sick"],
  sickness: ["sick"],
  medical: ["sick"],
  doctor: ["sick", "medical", "certificate"],
  note: ["certificate"],
  wfh: ["work", "home"],
  remote: ["work", "home"],
  cash: ["encash"],
  unpaid: ["loss", "pay"],
  lop: ["loss", "pay"],
  rollover: ["carry", "forward"],
  joiner: ["new", "joining"],
  probation: ["service", "month"],
  baby: ["maternity", "paternity"],
  pregnancy: ["maternity"],
};

// Crude stemming, applied the same way to documents and queries:
// "leaves" -> "leave", "policies" -> "policy", "encashment"/"encashed"/"encashable" -> "encash".
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) t = t.slice(0, -3) + "y";
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.length > 6) t = t.replace(/(ment|able|ed|ing)$/, "");
  return t;
}

// Lowercase, drop punctuation and stopwords, then stem.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

const K1 = 1.2;
const B = 0.75;

export class PolicyIndex {
  private readonly docs: { section: PolicySection; tf: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(readonly sections: PolicySection[]) {
    this.docs = sections.map((section) => {
      // Heading words count twice: they say what the section is about.
      const tokens = [...tokenize(`${section.doc} ${section.section}`), ...tokenize(section.section), ...tokenize(section.text)];
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { section, tf, length: tokens.length };
    });
    this.avgLength = this.docs.reduce((sum, d) => sum + d.length, 0) / Math.max(this.docs.length, 1);
  }

  // Top matches. To save tokens and avoid misleading context, a section must match at least one
  // distinctive word (in <= 1/3 of sections, so not just "leave"), and weak matches
  // (< 50% of the best score) are dropped.
  search(query: string, limit = 3): PolicyHit[] {
    // Words the user typed count fully; synonym expansions count half (they are guesses).
    const weights = new Map<string, number>();
    for (const t of tokenize(query)) {
      weights.set(t, 1);
      for (const syn of SYNONYMS[t] ?? []) if (!weights.has(syn)) weights.set(syn, 0.5);
    }
    const n = this.docs.length;

    const scored = this.docs
      .map(({ section, tf, length }) => {
        let score = 0;
        let distinctive = false;
        for (const [term, weight] of weights) {
          const freq = tf.get(term);
          if (!freq) continue;
          const df = this.df.get(term)!;
          if (df <= n / 3) distinctive = true;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          score += weight * idf * ((freq * (K1 + 1)) / (freq + K1 * (1 - B + (B * length) / this.avgLength)));
        }
        return { ...section, score: distinctive ? score : 0 };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0]?.score ?? 0;
    return scored.filter((h) => h.score >= best * 0.5).slice(0, limit);
  }
}

let index: PolicyIndex | undefined;

// Markdown/text only, built on first use. Entry points call loadPolicyIndex() at startup so
// PDF and Word files are included too.
export function getPolicyIndex(): PolicyIndex {
  if (!index) index = new PolicyIndex(loadTextDocuments(config.policyDir).flatMap((d) => d.sections));
  return index;
}

// Loads every supported file (.md, .txt, .pdf, .docx) from the policy folder and replaces the
// index. Returns per-file results so callers can report unreadable files.
export async function loadPolicyIndex(): Promise<LoadedDocument[]> {
  const docs = await loadAllDocuments(config.policyDir);
  index = new PolicyIndex(docs.flatMap((d) => d.sections));
  return docs;
}
