// Turns policy files into searchable sections: Markdown (.md), plain text (.txt), PDF (.pdf)
// and Word (.docx). Each section carries its document title and heading so answers can cite
// "Document §Section".
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { PolicySection } from "./policyIndex";

export const SUPPORTED_EXTENSIONS = [".md", ".txt", ".pdf", ".docx"];

// Retrieved text is sent to the model, so long sections are split into parts.
const MAX_SECTION_CHARS = 1000;

const titleFromFile = (file: string) =>
  basename(file, extname(file))
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// "# Title" + "## Section" markdown (the format of the bundled sample policies).
export function parseMarkdown(markdown: string, fallbackTitle = "Policy"): PolicySection[] {
  const sections: PolicySection[] = [];
  let doc = fallbackTitle;
  let current: PolicySection | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("# ")) doc = line.slice(2).trim();
    else if (line.startsWith("## ") || line.startsWith("### ")) {
      current = { doc, section: line.replace(/^#+\s*/, "").trim(), text: "" };
      sections.push(current);
    } else if (current && line.trim()) {
      current.text += (current.text ? " " : "") + line.trim();
    }
  }
  return sections;
}

// A line counts as a heading in PDF/plain text when it is short, doesn't end like a sentence,
// and looks numbered ("4. Earned Leave", "4.2 Notice", "Section 3: Travel") or is in capitals.
export function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 90 || /[.,;:]$/.test(t)) return false;
  if (/^(\d+(\.\d+)*)[.)]?\s+\S/.test(t)) return true;
  if (/^(section|chapter|part|article)\s+\w+[:.\s-]/i.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 8;
}

// Plain text (from .txt or a PDF): first short line is the title; heading lines start sections.
// Text before any heading becomes an "Overview" section, so nothing is dropped.
export function parsePlainText(text: string, fallbackTitle: string): PolicySection[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let doc = fallbackTitle;
  if (lines[0] && lines[0].length <= 80 && !/[.,;:]$/.test(lines[0]) && !/^\d/.test(lines[0])) doc = lines.shift()!;

  const sections: PolicySection[] = [];
  let current: PolicySection | undefined;
  for (const line of lines) {
    if (isHeading(line)) {
      current = { doc, section: line, text: "" };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { doc, section: "Overview", text: "" };
      sections.push(current);
    }
    current.text += (current.text ? " " : "") + line;
  }
  return sections.filter((s) => s.text);
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

// Word files: mammoth maps heading styles to <h1>-<h6>; the first <h1> is the title,
// other headings start sections, paragraphs and list items are the text.
export function parseWordHtml(html: string, fallbackTitle: string): PolicySection[] {
  let doc = fallbackTitle;
  let titleTaken = false;
  const sections: PolicySection[] = [];
  let current: PolicySection | undefined;
  for (const m of html.matchAll(/<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const tag = m[1];
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (tag === "h1" && !titleTaken) {
      doc = text;
      titleTaken = true;
    } else if (tag.startsWith("h")) {
      current = { doc, section: text, text: "" };
      sections.push(current);
    } else {
      if (!current) {
        current = { doc, section: "Overview", text: "" };
        sections.push(current);
      }
      current.text += (current.text ? " " : "") + text;
    }
  }
  return sections.filter((s) => s.text);
}

// Splits sections longer than MAX_SECTION_CHARS at sentence boundaries: "Hotels (part 2)".
export function splitLongSections(sections: PolicySection[], max = MAX_SECTION_CHARS): PolicySection[] {
  return sections.flatMap((s) => {
    if (s.text.length <= max) return [s];
    const parts: string[] = [];
    let part = "";
    for (const sentence of s.text.match(/[^.!?]+[.!?]*\s*/g) ?? [s.text]) {
      if (part && part.length + sentence.length > max) {
        parts.push(part.trim());
        part = "";
      }
      part += sentence;
    }
    if (part.trim()) parts.push(part.trim());
    return parts.map((text, i) => ({ doc: s.doc, section: `${s.section} (part ${i + 1})`, text }));
  });
}

export interface LoadedDocument {
  file: string;
  sections: PolicySection[];
  error?: string;
}

const listFiles = (dir: string, exts: string[]) =>
  readdirSync(dir)
    .filter((f) => exts.includes(extname(f).toLowerCase()))
    .sort();

// Synchronous: Markdown and plain text only (PDF/Word parsing is asynchronous).
export function loadTextDocuments(dir: string): LoadedDocument[] {
  return listFiles(dir, [".md", ".txt"]).map((file) => {
    const content = readFileSync(join(dir, file), "utf8");
    const sections = extname(file).toLowerCase() === ".md" ? parseMarkdown(content, titleFromFile(file)) : parsePlainText(content, titleFromFile(file));
    return { file, sections: splitLongSections(sections) };
  });
}

// All supported formats. A file that can't be read is reported, not fatal.
export async function loadAllDocuments(dir: string): Promise<LoadedDocument[]> {
  const docs: LoadedDocument[] = [];
  for (const file of listFiles(dir, SUPPORTED_EXTENSIONS)) {
    const path = join(dir, file);
    const ext = extname(file).toLowerCase();
    try {
      let sections: PolicySection[];
      if (ext === ".md") sections = parseMarkdown(readFileSync(path, "utf8"), titleFromFile(file));
      else if (ext === ".txt") sections = parsePlainText(readFileSync(path, "utf8"), titleFromFile(file));
      else if (ext === ".pdf") {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)));
        const { text } = await extractText(pdf, { mergePages: false });
        sections = parsePlainText((text as string[]).join("\n"), titleFromFile(file));
      } else {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.convertToHtml({ path });
        sections = parseWordHtml(value, titleFromFile(file));
      }
      docs.push({ file, sections: splitLongSections(sections) });
    } catch (err) {
      docs.push({ file, sections: [], error: (err as Error).message });
    }
  }
  return docs;
}
