/**
 * DiffDelta TypeScript client — agent-ready intelligence feeds.
 *
 * @example
 * ```ts
 * import { DiffDelta } from "diffdelta";
 *
 * const dd = new DiffDelta();
 *
 * // Quick health check — is the pipeline alive?
 * const health = await dd.checkHealth();
 * console.log(`Pipeline: ${health.ok ? "healthy" : "degraded"}, last run: ${health.time}`);
 *
 * // Poll for new items across all sources
 * const items = await dd.poll();
 * items.forEach(i => console.log(`${i.source}: ${i.headline}`));
 *
 * // Poll only security sources
 * const sec = await dd.poll({ tags: ["security"] });
 *
 * // Check what's relevant to your stack
 * const sources = await dd.discoverSources(["openai", "langchain", "pinecone"]);
 * console.log("Watch these:", sources);
 *
 * // Continuous monitoring
 * dd.watch(item => console.log("🚨", item.headline), { tags: ["security"] });
 * ```
 */

import { CursorStore, MemoryCursorStore } from "./cursor.js";
import type { FeedItem, Feed, Head, SourceInfo, HealthCheck } from "./models.js";
import { parseFeedItem, parseFeed, parseHead, parseSourceInfo, parseHealthCheck } from "./models.js";

const VERSION = "0.1.2";
const DEFAULT_BASE_URL = "https://diffdelta.io";
const DEFAULT_TIMEOUT = 15_000; // ms

export interface DiffDeltaOptions {
  /** DiffDelta API base URL. Defaults to https://diffdelta.io. */
  baseUrl?: string;
  /** Pro/Enterprise API key (dd_live_...). */
  apiKey?: string;
  /**
   * Path to cursor file. Defaults to ~/.diffdelta/cursors.json.
   * Set to `null` to disable file persistence (in-memory only).
   * Set to `"memory"` for explicit in-memory mode (serverless, edge).
   */
  cursorPath?: string | null;
  /** HTTP timeout in milliseconds. Defaults to 15000. */
  timeout?: number;
}

export interface PollOptions {
  /** Filter items to these tags (e.g. ["security"]). */
  tags?: string[];
  /** Filter items to these source IDs (e.g. ["cisa_kev", "github_advisories"]). */
  sources?: string[];
  /**
   * Which buckets to return.
   * Defaults to ["new", "updated", "flagged"].
   * Use ["new", "updated", "removed", "flagged"] to include removals.
   */
  buckets?: Array<"new" | "updated" | "removed" | "flagged">;
}

export interface WatchOptions extends PollOptions {
  /** Seconds between polls. Defaults to feed TTL (usually 60s). */
  interval?: number;
  /** If provided, an AbortSignal to stop watching. */
  signal?: AbortSignal;
}

interface CursorStoreInterface {
  get(key: string): string | undefined;
  set(key: string, cursor: string): void;
  clear(key?: string): void;
}

export class DiffDelta {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeout: number;

  private cursors: CursorStoreInterface;
  private sourceTagsCache: Record<string, string[]> | null = null;

  constructor(options: DiffDeltaOptions = {}) {
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;

    // Cursor persistence
    if (options.cursorPath === null || options.cursorPath === "memory") {
      this.cursors = new MemoryCursorStore();
    } else {
      try {
        this.cursors = new CursorStore(options.cursorPath || undefined);
      } catch {
        // Fallback to memory if file system not available
        this.cursors = new MemoryCursorStore();
      }
    }
  }

  // ── Core polling ──

  /**
   * Poll the global feed for new items since last poll.
   *
   * Checks head.json first (~200 bytes). Only fetches the full feed
   * if the cursor has changed. Automatically saves the new cursor.
   */
  async poll(options: PollOptions = {}): Promise<FeedItem[]> {
    const { tags, sources, buckets = ["new", "updated", "flagged"] } = options;

    return this.pollFeed({
      headUrl: `${this.baseUrl}/diff/head.json`,
      latestUrl: `${this.baseUrl}/diff/latest.json`,
      cursorKey: "global",
      tags,
      sources,
      buckets,
    });
  }

  /**
   * Poll a specific source for new items since last poll.
   *
   * More efficient than `poll({ sources: [...] })` if you only
   * care about one source — fetches a smaller payload.
   */
  async pollSource(
    sourceId: string,
    options: Omit<PollOptions, "sources"> = {}
  ): Promise<FeedItem[]> {
    const { tags, buckets = ["new", "updated", "flagged"] } = options;

    return this.pollFeed({
      headUrl: `${this.baseUrl}/diff/${sourceId}/head.json`,
      latestUrl: `${this.baseUrl}/diff/${sourceId}/latest.json`,
      cursorKey: `source:${sourceId}`,
      tags,
      sources: undefined,
      buckets,
    });
  }

  // ── Low-level fetch ──

  /**
   * Fetch a head.json pointer. Cheapest call (~200 bytes).
   * @param url Full URL to head.json. Defaults to global head.
   */
  async head(url?: string): Promise<Head> {
    const data = await this.fetchJson(url || `${this.baseUrl}/diff/head.json`);
    return parseHead(data);
  }

  /**
   * Fetch a full latest.json feed.
   * @param url Full URL to latest.json. Defaults to global latest.
   */
  async fetchFeed(url?: string): Promise<Feed> {
    const data = await this.fetchJson(
      url || `${this.baseUrl}/diff/latest.json`
    );
    return parseFeed(data);
  }

  /** List all available DiffDelta sources. */
  async sources(): Promise<SourceInfo[]> {
    const data = await this.fetchJson(`${this.baseUrl}/diff/sources.json`);
    const raw = (data.sources || []) as Record<string, unknown>[];
    return raw.map(parseSourceInfo);
  }

  // ── Discovery & Health ──

  /**
   * Check pipeline health. Returns when the engine last ran and whether
   * all sources are healthy. A stale timestamp means the pipeline is down.
   */
  async checkHealth(): Promise<HealthCheck> {
    const data = await this.fetchJson(`${this.baseUrl}/healthz.json`);
    return parseHealthCheck(data);
  }

  /**
   * Given a list of dependency names your bot uses, returns the source IDs
   * you should monitor. Uses the static stacks.json mapping — no API call,
   * pure local lookup after one fetch.
   *
   * @example
   * ```ts
   * const sources = await dd.discoverSources(["openai", "langchain", "pinecone"]);
   * // → ["openai_sdk_releases", "openai_api_changelog", "langchain_releases", "pinecone_status"]
   * ```
   */
  async discoverSources(dependencies: string[]): Promise<string[]> {
    const data = await this.fetchJson(`${this.baseUrl}/diff/stacks.json`);
    // Support both formats: { dependencies: { x: { sources: [...] } } }
    // and legacy { dependency_map: { x: [...] } }
    const depsObj = (data.dependencies || data.dependency_map || {}) as Record<
      string,
      { sources?: string[] } | string[]
    >;
    const sourceIds = new Set<string>();
    for (const dep of dependencies) {
      const entry = depsObj[dep.toLowerCase()];
      if (!entry) continue;
      const sources = Array.isArray(entry) ? entry : entry.sources;
      if (Array.isArray(sources)) {
        for (const s of sources) {
          sourceIds.add(s);
        }
      }
    }
    return [...sourceIds];
  }

  // ── Continuous monitoring ──

  /**
   * Continuously poll and call a function for each new item.
   *
   * @param callback - Async or sync function called for each new FeedItem.
   * @param options - Watch options (tags, sources, interval, signal).
   *
   * @example
   * ```ts
   * dd.watch(item => {
   *   console.log(`🚨 ${item.source}: ${item.headline}`);
   *   if (item.suggestedAction === "PATCH_IMMEDIATELY") {
   *     triggerAlert(item);
   *   }
   * }, { tags: ["security"] });
   * ```
   *
   * @example
   * ```ts
   * // Stop with AbortController
   * const ac = new AbortController();
   * dd.watch(handler, { signal: ac.signal });
   * setTimeout(() => ac.abort(), 60_000); // stop after 1 minute
   * ```
   */
  async watch(
    callback: (item: FeedItem) => void | Promise<void>,
    options: WatchOptions = {}
  ): Promise<void> {
    const { tags, sources, buckets, signal } = options;
    let interval = options.interval;

    // Determine interval from feed TTL if not specified
    if (!interval) {
      try {
        const h = await this.head();
        interval = Math.max(h.ttlSec, 60);
      } catch {
        interval = 60; // default 1 minute
      }
    }

    console.log(`[diffdelta] Watching for changes every ${interval}s...`);

    while (!signal?.aborted) {
      try {
        const items = await this.poll({ tags, sources, buckets });
        if (items.length > 0) {
          console.log(`[diffdelta] ${items.length} new item(s) found.`);
          for (const item of items) {
            await callback(item);
          }
        }
      } catch (err) {
        if (signal?.aborted) break;
        console.error(`[diffdelta] Error: ${err}. Retrying in ${interval}s...`);
      }

      // Sleep with abort support
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, interval! * 1000);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
    }

    console.log("[diffdelta] Stopped.");
  }

  // ── Cursor management ──

  /** Reset stored cursors so the next poll returns all current items. */
  resetCursors(sourceId?: string): void {
    if (sourceId) {
      this.cursors.clear(`source:${sourceId}`);
    } else {
      this.cursors.clear();
    }
  }

  // ── Internal ──

  private async pollFeed(params: {
    headUrl: string;
    latestUrl: string;
    cursorKey: string;
    tags?: string[];
    sources?: string[];
    buckets: string[];
  }): Promise<FeedItem[]> {
    const { headUrl, latestUrl, cursorKey, tags, sources, buckets } = params;

    // Step 1: Fetch head.json (~200 bytes)
    const head = await this.head(headUrl);

    // Step 2: Compare cursor — if unchanged, nothing to do
    const storedCursor = this.cursors.get(cursorKey);
    if (storedCursor && storedCursor === head.cursor) {
      return []; // Nothing changed
    }

    // Step 3: Fetch full feed
    const feed = await this.fetchFeed(latestUrl);

    // Step 4: Save new cursor
    if (feed.cursor) {
      this.cursors.set(cursorKey, feed.cursor);
    }

    // Step 5: Filter and return
    let items = feed.items;

    // Filter by bucket
    items = items.filter((i) => buckets.includes(i.bucket));

    // Filter by source
    if (sources?.length) {
      items = items.filter((i) => sources.includes(i.source));
    }

    // Filter by tags
    if (tags?.length) {
      const tagMap = await this.getSourceTags();
      items = items.filter((i) => {
        const itemTags = tagMap[i.source] || [];
        return tags.some((t) => itemTags.includes(t));
      });
    }

    return items;
  }

  private async getSourceTags(): Promise<Record<string, string[]>> {
    if (this.sourceTagsCache) return this.sourceTagsCache;
    try {
      const allSources = await this.sources();
      this.sourceTagsCache = Object.fromEntries(
        allSources.map((s) => [s.sourceId, s.tags])
      );
    } catch {
      this.sourceTagsCache = {};
    }
    return this.sourceTagsCache;
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        "User-Agent": `diffdelta-js/${VERSION}`,
        Accept: "application/json",
      };
      if (this.apiKey) {
        headers["X-DiffDelta-Key"] = this.apiKey;
      }

      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText} (${url})`);
      }
      return (await res.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  toString(): string {
    const tier = this.apiKey ? "pro" : "free";
    return `DiffDelta(baseUrl=${this.baseUrl}, tier=${tier})`;
  }
}
