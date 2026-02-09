/**
 * ci-gate.ts — Fail a CI build if critical vulnerabilities exist.
 *
 * Exit code 0 = safe to deploy.
 * Exit code 1 = PATCH_IMMEDIATELY items found, block deploy.
 *
 * Usage in CI:
 *   npx tsx examples/ci-gate.ts
 *   # or with specific sources:
 *   npx tsx examples/ci-gate.ts openai langchain pinecone
 *
 * Usage in GitHub Actions:
 *   - run: npx @diffdelta/client/examples/ci-gate.ts ${{ steps.deps.outputs.names }}
 */
import { DiffDelta } from "@diffdelta/client";

const dd = new DiffDelta({ cursorPath: "memory" });

// If CLI args provided, use them as dependency names for stack discovery
const deps = process.argv.slice(2);
let sourceFilter: string[] | undefined;

if (deps.length > 0) {
  console.log(`🔍 Discovering sources for: ${deps.join(", ")}`);
  sourceFilter = await dd.discoverSources(deps);
  console.log(`   Monitoring: ${sourceFilter.join(", ")}\n`);
}

// Check pipeline health first
try {
  const health = await dd.checkHealth();
  if (!health.ok) {
    console.log(`⚠️  Pipeline degraded: ${health.sourcesOk}/${health.sourcesChecked} sources healthy`);
    console.log(`   Data may be stale. Proceeding with caution.\n`);
  }
} catch {
  console.log(`⚠️  Could not reach healthz endpoint. Proceeding anyway.\n`);
}

// Check head first — cheapest call
const head = await dd.head();

if (head.allClear && head.allClearConfidence && head.allClearConfidence >= 0.9) {
  console.log(`✅ PASS — All ${head.sourcesChecked} sources clear (confidence: ${head.allClearConfidence})`);
  console.log(`   Verified at: ${head.generatedAt}`);
  console.log(`   Cursor: ${head.cursor.slice(0, 16)}...`);
  process.exit(0);
}

// Something changed — fetch items
const items = await dd.poll({
  sources: sourceFilter,
  buckets: ["flagged", "new", "updated"],
});

// Find blockers
const blockers = items.filter(
  (i) =>
    i.suggestedAction === "PATCH_IMMEDIATELY" ||
    (i.signals.severity?.exploited === true)
);

const warnings = items.filter(
  (i) =>
    i.suggestedAction === "PATCH_SOON" ||
    i.suggestedAction === "VERSION_PIN"
);

// Report
if (blockers.length > 0) {
  console.log(`\n❌ FAIL — ${blockers.length} critical issue(s) block deployment:\n`);
  for (const b of blockers) {
    const sev = b.signals.severity;
    console.log(`  🔴 ${b.suggestedAction} — ${b.source}: ${b.headline}`);
    if (sev) console.log(`     Severity: ${sev.level} | CVSS: ${sev.cvss}${sev.exploited ? " | EXPLOITED" : ""}`);
    if (sev?.provenance) console.log(`     Evidence: ${sev.provenance.evidence_url}`);
    console.log(`     URL: ${b.url}`);
    console.log();
  }
  console.log(`Cursor: ${head.cursor.slice(0, 16)}...`);
  console.log(`Checked: ${head.generatedAt}`);
  process.exit(1);
}

if (warnings.length > 0) {
  console.log(`\n⚠️  PASS (with warnings) — ${warnings.length} non-critical issue(s):\n`);
  for (const w of warnings) {
    console.log(`  📌 ${w.suggestedAction} — ${w.source}: ${w.headline}`);
  }
  console.log();
}

console.log(`✅ PASS — No critical issues. ${items.length} items reviewed.`);
console.log(`   Cursor: ${head.cursor.slice(0, 16)}...`);
process.exit(0);
