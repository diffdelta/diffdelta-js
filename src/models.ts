/** A single item from a DiffDelta feed. */
export interface FeedItem {
  /** Source identifier (e.g. "cisa_kev", "nist_nvd"). */
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
  /** Which change bucket: "new", "updated", or "removed". */
  bucket: "new" | "updated" | "removed";
  /** Risk score 0–10, or null if not scored. */
  riskScore: number | null;
  /** Raw provenance data (fetched_at, evidence_urls, content_hash). */
  provenance: Record<string, unknown>;
  /** The full raw item object from the feed. */
  raw: Record<string, unknown>;
}

/** The lightweight head pointer for change detection. */
export interface Head {
  /** Opaque cursor string for change detection. */
  cursor: string;
  /** Content hash of the latest feed. */
  hash: string;
  /** Whether content has changed since last generation. */
  changed: boolean;
  /** When this head was generated. */
  generatedAt: string;
  /** Recommended polling interval in seconds. */
  ttlSec: number;
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

// ── Parsing helpers ──

/** Parse a raw feed item into a typed FeedItem. */
export function parseFeedItem(
  data: Record<string, unknown>,
  bucket: "new" | "updated" | "removed" = "new"
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

  // Extract risk_score from top-level or nested summary
  let riskScore: number | null = (data.risk_score as number) ?? null;
  if (riskScore === null) {
    const summary = data.summary as Record<string, unknown> | undefined;
    if (typeof summary === "object" && summary !== null) {
      riskScore = (summary.risk_score as number) ?? null;
    }
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
    riskScore,
    provenance: (data.provenance as Record<string, unknown>) || {},
    raw: data,
  };
}

/** Parse a raw head.json response into a typed Head. */
export function parseHead(data: Record<string, unknown>): Head {
  return {
    cursor: (data.cursor as string) || "",
    hash: (data.hash as string) || "",
    changed: (data.changed as boolean) || false,
    generatedAt: (data.generated_at as string) || "",
    ttlSec: (data.ttl_sec as number) || 900,
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

  return {
    cursor: (data.cursor as string) || "",
    prevCursor: (data.prev_cursor as string) || "",
    sourceId: (data.source_id as string) || "",
    generatedAt: (data.generated_at as string) || "",
    items: [...newItems, ...updatedItems, ...removedItems],
    new: newItems,
    updated: updatedItems,
    removed: removedItems,
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
