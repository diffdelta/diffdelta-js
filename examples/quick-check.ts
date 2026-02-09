/**
 * quick-check.ts — See what's happening in 8 lines.
 *
 * Run: npx tsx examples/quick-check.ts
 */
import { DiffDelta } from "@diffdelta/client";

const dd = new DiffDelta({ cursorPath: "memory" });
const items = await dd.poll();

if (items.length === 0) {
  const head = await dd.head();
  console.log(
    head.allClear
      ? `✅ All clear — ${head.sourcesChecked} sources verified, confidence ${head.allClearConfidence}`
      : `No new items.`
  );
  process.exit(0);
}

console.log(`${items.length} items:\n`);

for (const item of items) {
  const action = item.suggestedAction;
  const sev = item.signals.severity;

  // Action-first: show what to DO, not just what happened
  const prefix = action
    ? `⚡ ${action}`
    : sev
      ? `🔒 ${sev.level.toUpperCase()}`
      : `📋`;

  console.log(`${prefix}  ${item.source}: ${item.headline}`);

  if (sev?.cvss) console.log(`   CVSS ${sev.cvss} | ${sev.exploited ? "🔴 EXPLOITED" : ""}`);
  if (sev?.provenance) console.log(`   Source: ${sev.provenance.authority}`);
  if (item.signals.release) console.log(`   Version: ${item.signals.release.version}`);
  if (item.signals.incident) console.log(`   Status: ${item.signals.incident.status}`);
  if (item.url) console.log(`   ${item.url}`);
  console.log();
}
