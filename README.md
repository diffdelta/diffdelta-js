# @diffdelta/client

TypeScript/JavaScript client for [DiffDelta](https://diffdelta.io) — agent-ready intelligence feeds for security advisories, changelogs, status pages, and more.

**One import. 46 sources. Structured signals. Zero scraping.**

## Install

```bash
npm install @diffdelta/client
```

## Quick Start

```ts
import { DiffDelta } from "@diffdelta/client";

const dd = new DiffDelta();
const items = await dd.poll();

if (items.length === 0) {
  const head = await dd.head();
  console.log(head.allClear
    ? `✅ All clear — ${head.sourcesChecked} sources verified`
    : `No new items.`);
} else {
  for (const item of items) {
    const action = item.suggestedAction;
    const sev = item.signals.severity;
    const prefix = action ? `⚡ ${action}` : sev ? `🔒 ${sev.level}` : `📋`;
    console.log(`${prefix}  ${item.source}: ${item.headline}`);
  }
}
```

> See [`examples/`](./examples/) for runnable scripts: `quick-check.ts`, `watch-security.ts`, `ci-gate.ts`, `discover-stack.ts`.

## Stack Discovery

Tell DiffDelta what you use, get back exactly which sources to watch:

```ts
const sources = await dd.discoverSources(["openai", "langchain", "pinecone"]);
// → ["openai_sdk_releases", "openai_api_changelog", "langchain_releases", "pinecone_status"]
```

## Health Check

Check if the DiffDelta pipeline is alive before trusting the data:

```ts
const health = await dd.checkHealth();
if (!health.ok) {
  console.warn(`Pipeline degraded: ${health.sourcesOk}/${health.sourcesChecked} sources healthy`);
}
```

## Verified Silence

When nothing changed, DiffDelta proves it checked:

```ts
const head = await dd.head();
if (!head.changed && head.allClear) {
  console.log(`All clear: ${head.sourcesChecked} sources verified, confidence ${head.allClearConfidence}`);
  // A non-DiffDelta bot can never make this claim.
}
```

## Continuous Monitoring

```ts
const ac = new AbortController();

dd.watch(
  (item) => {
    if (item.suggestedAction === "PATCH_IMMEDIATELY") {
      alertOncall(item);
    }
  },
  { tags: ["security"], signal: ac.signal }
);

// Stop after 1 hour
setTimeout(() => ac.abort(), 3_600_000);
```

## Per-Source Polling

More efficient if you only care about one source:

```ts
const items = await dd.pollSource("cisa_kev");
```

## Cursor Persistence

Cursors are saved to `~/.diffdelta/cursors.json` by default so your bot survives restarts. Disable with:

```ts
const dd = new DiffDelta({ cursorPath: "memory" }); // in-memory only
```

## Signal Types

Every item can carry structured signals — pre-extracted, no parsing needed:

| Signal | Fields | Example |
|--------|--------|---------|
| `severity` | level, cvss, cwes, packages, exploited | `{ level: "critical", cvss: 9.8 }` |
| `release` | version, prerelease, security_patch | `{ version: "4.2.1", security_patch: true }` |
| `incident` | status, impact | `{ status: "investigating", impact: "major" }` |
| `deprecation` | type, affects, confidence | `{ type: "breaking_change", affects: ["gpt-4-turbo"] }` |
| `suggested_action` | action code | `"PATCH_IMMEDIATELY"` |

## Action Codes

| Code | Meaning |
|------|---------|
| `PATCH_IMMEDIATELY` | Active exploitation or critical severity. Patch now. |
| `PATCH_SOON` | High severity. Schedule a patch. |
| `VERSION_PIN` | Breaking change coming. Pin your current version. |
| `REVIEW_CHANGELOG` | New release with notable changes. |
| `MONITOR_STATUS` | Incident in progress. Watch for updates. |
| `ACKNOWLEDGE` | Low-risk change. Log it. |
| `NO_ACTION` | Informational only. |

## Options

```ts
const dd = new DiffDelta({
  baseUrl: "https://diffdelta.io", // default
  apiKey: "dd_live_...",           // Pro tier (optional)
  cursorPath: null,                // null = in-memory, string = file path
  timeout: 15_000,                 // HTTP timeout in ms
});
```

## Examples

The [`examples/`](./examples/) directory has runnable scripts. Install [tsx](https://github.com/privatenumber/tsx) and run them directly:

```bash
npx tsx examples/quick-check.ts        # One-shot: what's happening right now?
npx tsx examples/watch-security.ts     # Continuous security monitoring
npx tsx examples/ci-gate.ts            # CI/CD gate: exit 1 if critical CVEs
npx tsx examples/discover-stack.ts openai langchain pinecone  # Stack-aware monitoring
```

### CI/CD Gate

Use `ci-gate.ts` in your deployment pipeline to block deploys when critical vulnerabilities exist:

```yaml
# .github/workflows/deploy.yml
- name: Security gate
  run: npx tsx node_modules/@diffdelta/client/examples/ci-gate.ts openai langchain
```

Exit code 0 = safe to deploy. Exit code 1 = `PATCH_IMMEDIATELY` items found.

## Protocol

DiffDelta uses a three-layer polling protocol (ddv1):

1. **head.json** (~200 bytes) — cursor + counts. Poll this first.
2. **digest.json** (~500 bytes) — narrative + alert count. Fetch if cursor changed.
3. **latest.json** (~5-40KB) — full items with signals. Fetch if alerts > 0.

The SDK handles this automatically. You never fetch more than you need.

## License

MIT
