/**
 * watch-security.ts — Continuous security monitoring.
 *
 * Polls DiffDelta every 60 seconds for security items.
 * When a critical/exploited CVE appears, prints an alert.
 * Stop with Ctrl+C.
 *
 * Run: npx tsx examples/watch-security.ts
 */
import { DiffDelta } from "@diffdelta/client";

const dd = new DiffDelta(); // cursors persist to ~/.diffdelta/cursors.json
const ac = new AbortController();

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  ac.abort();
});

console.log("🔍 Watching DiffDelta for security events...\n");

await dd.watch(
  async (item) => {
    const action = item.suggestedAction;
    const sev = item.signals.severity;

    // Only alert on actionable items
    if (action === "PATCH_IMMEDIATELY" || action === "PATCH_SOON") {
      console.log(`\n🚨 ${action} — ${item.source}`);
      console.log(`   ${item.headline}`);
      if (sev) console.log(`   Severity: ${sev.level} (CVSS ${sev.cvss})`);
      if (sev?.exploited) console.log(`   ⚠️  Active exploitation confirmed`);
      if (sev?.provenance) console.log(`   Verified by: ${sev.provenance.authority}`);
      console.log(`   ${item.url}`);

      // 👉 This is where you'd send to Slack, PagerDuty, etc:
      // await sendSlackAlert({ text: `${action}: ${item.headline}`, url: item.url });

    } else if (action === "VERSION_PIN") {
      console.log(`\n📌 VERSION_PIN — ${item.source}: ${item.headline}`);

    } else if (item.signals.incident) {
      console.log(`\n☁️  INCIDENT ${item.signals.incident.status} — ${item.source}: ${item.headline}`);

    } else {
      // Low-priority: just log it
      console.log(`   📋 ${item.source}: ${item.headline}`);
    }
  },
  {
    tags: ["security"],
    interval: 60, // seconds
    signal: ac.signal,
  }
);
