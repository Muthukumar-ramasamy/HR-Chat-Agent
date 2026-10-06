// Shows how the policy documents were split into sections, and optionally what a search returns.
//   npm run policies                                  -> documents and sections
//   npm run policies -- --search "carry forward"      -> also run a search
import { config } from "../config";
import { getPolicyIndex, loadPolicyIndex } from "./policyIndex";

const docs = await loadPolicyIndex();
console.log(`Policy folder: ${config.policyDir}\n`);
for (const d of docs) {
  if (d.error) {
    console.log(`✗ ${d.file}: ${d.error}\n`);
    continue;
  }
  console.log(`${d.file} — "${d.sections[0]?.doc ?? "(no sections)"}", ${d.sections.length} section(s)`);
  for (const s of d.sections) console.log(`    §${s.section}  (${s.text.length} chars)`);
  console.log();
}

const i = process.argv.indexOf("--search");
if (i >= 0 && process.argv[i + 1]) {
  const query = process.argv[i + 1];
  const hits = getPolicyIndex().search(query);
  console.log(`Search "${query}": ${hits.length ? "" : "no matching section"}`);
  for (const h of hits) console.log(`    ${h.score.toFixed(2)}  ${h.doc} §${h.section}`);
}
