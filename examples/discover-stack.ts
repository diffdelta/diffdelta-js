/**
 * discover-stack.ts — Auto-configure monitoring from your dependencies.
 *
 * Tell DiffDelta what you use, get back exactly which sources matter.
 * Then poll only those sources.
 *
 * Run: npx tsx examples/discover-stack.ts openai langchain pinecone vercel
 */
import { DiffDelta } from "@diffdelta/client";

const dd = new DiffDelta({ cursorPath: "memory" });
const deps = process.argv.slice(2);

if (deps.length === 0) {
  console.log("Usage: npx tsx examples/discover-stack.ts <dep1> <dep2> ...");
  console.log("Example: npx tsx examples/discover-stack.ts openai langchain pinecone");
  process.exit(1);
}

console.log(`🔍 Stack: ${deps.join(", ")}\n`);

// Step 1: Discover relevant sources
const sources = await dd.discoverSources(deps);

if (sources.length === 0) {
  console.log("No matching sources found. Check available dependencies at https://diffdelta.io/diff/stacks.json");
  process.exit(0);
}

console.log(`📡 Monitoring ${sources.length} sources: ${sources.join(", ")}\n`);

// Step 2: Poll only those sources
const items = await dd.poll({ sources });

if (items.length === 0) {
  const head = await dd.head();
  console.log(
    head.allClear
      ? `✅ All clear for your stack — ${head.sourcesChecked} sources verified`
      : `No new items for your stack.`
  );
  process.exit(0);
}

console.log(`${items.length} items relevant to your stack:\n`);

for (const item of items) {
  const action = item.suggestedAction;
  const prefix = action ? `⚡ ${action}` : `📋`;
  console.log(`${prefix}  ${item.source}: ${item.headline}`);
  if (item.signals.severity) {
    console.log(`   Severity: ${item.signals.severity.level} (CVSS ${item.signals.severity.cvss})`);
  }
  if (item.signals.release) {
    console.log(`   Release: ${item.signals.release.version}${item.signals.release.security_patch ? " [SECURITY]" : ""}`);
  }
  if (item.signals.incident) {
    console.log(`   Incident: ${item.signals.incident.status}`);
  }
  console.log();
}
