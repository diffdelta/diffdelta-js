// ── Signal types ──

/** Severity signal extracted from security advisories. */
export interface SeveritySignal {
  level: "critical" | "high" | "medium" | "low" | string;
  source: string;
  cvss?: number;
  cwes?: string[];
  packages?: string[];
  exploited?: boolean;
  provenance?: SignalProvenance;
}

/** Release signal extracted from changelogs/GitHub releases. */
export interface ReleaseSignal {
  version: string;
  prerelease?: boolean;
  security_patch?: boolean;
  provenance?: SignalProvenance;
}

/** Incident signal extracted from status pages. */
export interface IncidentSignal {
  status: "investigating" | "identified" | "monitoring" | "resolved" | string;
  impact?: "minor" | "major" | "critical" | string;
  provenance?: SignalProvenance;
}

/** Deprecation signal extracted from changelogs/advisories. */
export interface DeprecationSignal {
  type: "breaking_change" | "end_of_life" | "removal" | "deprecated" | string;
  affects?: string[];
  confidence: "high" | "medium" | "low" | string;
  source: string;
  provenance?: SignalProvenance;
}

/** Provenance chain for a signal — traces it to an authoritative source. */
export interface SignalProvenance {
  method: string;
  authority: string;
  authority_url: string;
  evidence_url: string;
}

/** Action codes telling a bot exactly what to do. */
export type SuggestedAction =
  | "PATCH_IMMEDIATELY"
  | "PATCH_SOON"
  | "VERSION_PIN"
  | "REVIEW_CHANGELOG"
  | "MONITOR_STATUS"
  | "ACKNOWLEDGE"
  | "NO_ACTION";

/** All structured signals on an item. */
export interface Signals {
  severity?: SeveritySignal;
  release?: ReleaseSignal;
  incident?: IncidentSignal;
  deprecation?: DeprecationSignal;
  suggested_action?: SuggestedAction;
  [key: string]: unknown;
}

// ── Core types ──

/** A single item from a DiffDelta feed. */
export interface FeedItem {
  /** Source identifier (e.g. "cisa_kev", "github_advisories"). */
  source: string;
  /** Unique item ID within the source. */
  id: string;
  /** Human/agent-readable headline. */
  headline: string;
  /** Link to the original source. */
  url: string;
  /** Summary text extracted from the source. */
  excerpt: string;
  /** When the item was originally published. */
  publishedAt: string | null;
  /** When the item was last updated. */
  updatedAt: string | null;
  /** Which change bucket: "new", "updated", "removed", or "flagged". */
  bucket: "new" | "updated" | "removed" | "flagged";
  /** Structured signals: severity, release, incident, deprecation, suggested_action. */
  signals: Signals;
  /** Shortcut: the suggested_action code, if any. */
  suggestedAction: SuggestedAction | null;
  /** Risk score 0.0–1.0, or null if not scored. */
  riskScore: number | null;
  /** Item-level provenance (fetched_at, evidence_urls, content_hash). */
  provenance: Record<string, unknown>;
  /** The full raw item object from the feed. */
  raw: Record<string, unknown>;
}

/** The lightweight head pointer for change detection. */
export interface Head {
  /** Opaque cursor string for change detection. */
  cursor: string;
  /** Whether content has changed since last generation. */
  changed: boolean;
  /** When this head was generated. */
  generatedAt: string;
  /** Recommended polling interval in seconds. */
  ttlSec: number;
  /** URL to the full latest.json feed. */
  latestUrl: string;
  /** URL to the digest (global head only). */
  digestUrl: string | null;
  /** Item counts: new, updated, removed, flagged. */
  counts: { new: number; updated: number; removed: number; flagged: number };
  /** Number of sources checked this cycle (Verified Silence). */
  sourcesChecked: number;
  /** Number of sources healthy this cycle. */
  sourcesOk: number;
  /** True if nothing changed AND all sources are healthy. */
  allClear: boolean;
  /** 0.0–1.0 confidence that allClear is trustworthy. */
  allClearConfidence: number | null;
  /** Pipeline freshness: oldest data age, stale count. */
  freshness: {
    oldest_data_age_sec: number;
    mean_data_age_sec: number;
    stale_count: number;
    all_fresh: boolean;
  } | null;
  /** The full raw head.json object. */
  raw: Record<string, unknown>;
}

/** A full DiffDelta feed response. */
export interface Feed {
  /** The new cursor (save this for next poll). */
  cursor: string;
  /** The previous cursor. */
  prevCursor: string;
  /** Source ID (if per-source feed) or "global". */
  sourceId: string;
  /** When this feed was generated. */
  generatedAt: string;
  /** All items across all buckets. */
  items: FeedItem[];
  /** Items in the "new" bucket. */
  new: FeedItem[];
  /** Items in the "updated" bucket. */
  updated: FeedItem[];
  /** Items in the "removed" bucket. */
  removed: FeedItem[];
  /** Items in the "flagged" bucket. */
  flagged: FeedItem[];
  /** Human-readable summary of what changed. */
  narrative: string;
  /** The full raw feed object. */
  raw: Record<string, unknown>;
}

/** Metadata about an available DiffDelta source. */
export interface SourceInfo {
  /** Unique source identifier (e.g. "cisa_kev"). */
  sourceId: string;
  /** Human-readable display name. */
  name: string;
  /** List of tags (e.g. ["security"]). */
  tags: string[];
  /** Brief description of the source. */
  description: string;
  /** URL of the source's homepage. */
  homepage: string;
  /** Whether the source is currently active. */
  enabled: boolean;
  /** Health status ("ok", "degraded", "error"). */
  status: string;
  /** Path to the source's head.json. */
  headUrl: string;
  /** Path to the source's latest.json. */
  latestUrl: string;
}

/** Health check response from /healthz.json. */
export interface HealthCheck {
  ok: boolean;
  service: string;
  time: string;
  sourcesChecked: number;
  sourcesOk: number;
  engineVersion: string;
}

// ── Parsing helpers ──

/** Parse a raw feed item into a typed FeedItem. */
export function parseFeedItem(
  data: Record<string, unknown>,
  bucket: "new" | "updated" | "removed" | "flagged" = "new"
): FeedItem {
  const content = data.content as Record<string, unknown> | string | undefined;
  let excerpt = "";
  if (typeof content === "object" && content !== null) {
    excerpt =
      (content.excerpt_text as string) ||
      (content.summary as string) ||
      "";
  } else if (typeof content === "string") {
    excerpt = content;
  }

  // Extract signals
  const signals = (data.signals as Signals) || {};
  const suggestedAction = (signals.suggested_action as SuggestedAction) || null;

  // Extract risk score from risk.score or legacy risk_score
  let riskScore: number | null = null;
  const risk = data.risk as Record<string, unknown> | undefined;
  if (typeof risk === "object" && risk !== null) {
    riskScore = (risk.score as number) ?? null;
  }
  if (riskScore === null) {
    riskScore = (data.risk_score as number) ?? null;
  }

  return {
    source: (data.source as string) || "",
    id: (data.id as string) || "",
    headline: (data.headline as string) || "",
    url: (data.url as string) || "",
    excerpt,
    publishedAt: (data.published_at as string) || null,
    updatedAt: (data.updated_at as string) || null,
    bucket,
    signals,
    suggestedAction,
    riskScore,
    provenance: (data.provenance as Record<string, unknown>) || {},
    raw: data,
  };
}

/** Parse a raw head.json response into a typed Head. */
export function parseHead(data: Record<string, unknown>): Head {
  const counts = (data.counts as Record<string, number>) || {};
  const freshness = data.freshness as Head["freshness"] | undefined;

  return {
    cursor: (data.cursor as string) || "",
    changed: (data.changed as boolean) || false,
    generatedAt: (data.generated_at as string) || "",
    ttlSec: (data.ttl_sec as number) || 60,
    latestUrl: (data.latest_url as string) || "",
    digestUrl: (data.digest_url as string) || null,
    counts: {
      new: counts.new || 0,
      updated: counts.updated || 0,
      removed: counts.removed || 0,
      flagged: counts.flagged || 0,
    },
    sourcesChecked: (data.sources_checked as number) || 0,
    sourcesOk: (data.sources_ok as number) || 0,
    allClear: (data.all_clear as boolean) || false,
    allClearConfidence:
      (data.all_clear_confidence as number) ??
      (data.confidence as number) ??
      null,
    freshness: freshness || null,
    raw: data,
  };
}

/** Parse a raw latest.json response into a typed Feed. */
export function parseFeed(data: Record<string, unknown>): Feed {
  const buckets = (data.buckets as Record<string, unknown[]>) || {};
  const newItems = (buckets.new || []).map((i) =>
    parseFeedItem(i as Record<string, unknown>, "new")
  );
  const updatedItems = (buckets.updated || []).map((i) =>
    parseFeedItem(i as Record<string, unknown>, "updated")
  );
  const removedItems = (buckets.removed || []).map((i) =>
    parseFeedItem(i as Record<string, unknown>, "removed")
  );
  const flaggedItems = (buckets.flagged || []).map((i) =>
    parseFeedItem(i as Record<string, unknown>, "flagged")
  );

  return {
    cursor: (data.cursor as string) || "",
    prevCursor: (data.prev_cursor as string) || "",
    sourceId: (data.source_id as string) || "",
    generatedAt: (data.generated_at as string) || "",
    items: [...newItems, ...updatedItems, ...removedItems, ...flaggedItems],
    new: newItems,
    updated: updatedItems,
    removed: removedItems,
    flagged: flaggedItems,
    narrative: (data.batch_narrative as string) || "",
    raw: data,
  };
}

/** Parse a raw source object into a typed SourceInfo. */
export function parseSourceInfo(data: Record<string, unknown>): SourceInfo {
  return {
    sourceId: (data.source_id as string) || "",
    name: (data.name as string) || "",
    tags: (data.tags as string[]) || [],
    description: (data.description as string) || "",
    homepage: (data.homepage as string) || "",
    enabled: (data.enabled as boolean) ?? true,
    status: (data.status as string) || "ok",
    headUrl: (data.head_url as string) || "",
    latestUrl: (data.latest_url as string) || "",
  };
}

/** Parse a raw healthz.json response into a typed HealthCheck. */
export function parseHealthCheck(data: Record<string, unknown>): HealthCheck {
  return {
    ok: (data.ok as boolean) || false,
    service: (data.service as string) || "",
    time: (data.time as string) || "",
    sourcesChecked: (data.sources_checked as number) || 0,
    sourcesOk: (data.sources_ok as number) || 0,
    engineVersion: (data.engine_version as string) || "",
  };
}
