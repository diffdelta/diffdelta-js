/**
 * DiffDelta TypeScript client — agent-ready intelligence feeds.
 *
 * @example
 * ```ts
 * import { DiffDelta } from "diffdelta";
 *
 * const dd = new DiffDelta();
 *
 * // Poll for new items across all sources
 * const items = await dd.poll();
 * items.forEach(i => console.log(`${i.source}: ${i.headline}`));
 *
 * // Poll only security sources
 * const sec = await dd.poll({ tags: ["security"] });
 *
 * // Continuous monitoring
 * dd.watch(item => console.log("🚨", item.headline), { tags: ["security"] });
 * ```
 */

import { CursorStore, MemoryCursorStore } from "./cursor.js";
import type { FeedItem, Feed, Head, SourceInfo } from "./models.js";
import { parseFeedItem, parseFeed, parseHead, parseSourceInfo } from "./models.js";

const VERSION = "0.1.0";
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
  /** Filter items to these source IDs (e.g. ["cisa_kev", "nist_nvd"]). */
  sources?: string[];
  /**
   * Which buckets to return.
   * Defaults to ["new", "updated"].
   * Use ["new", "updated", "removed"] to include removals.
   */
  buckets?: Array<"new" | "updated" | "removed">;
}

export interface WatchOptions extends PollOptions {
  /** Seconds between polls. Defaults to feed TTL (usually 900s). */
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
   * Checks head.json first (~400 bytes). Only fetches the full feed
   * if the cursor has changed. Automatically saves the new cursor.
   */
  async poll(options: PollOptions = {}): Promise<FeedItem[]> {
    const { tags, sources, buckets = ["new", "updated"] } = options;

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
    const { tags, buckets = ["new", "updated"] } = options;

    return this.pollFeed({
      headUrl: `${this.baseUrl}/diff/source/${sourceId}/head.json`,
      latestUrl: `${this.baseUrl}/diff/source/${sourceId}/latest.json`,
      cursorKey: `source:${sourceId}`,
      tags,
      sources: undefined,
      buckets,
    });
  }

  // ── Low-level fetch ──

  /**
   * Fetch a head.json pointer.
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
        interval = 900; // default 15 minutes
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
        } else {
          console.log(`[diffdelta] No changes.`);
        }
      } catch (err) {
        if (signal?.aborted) break;
        console.error(`[diffdelta] Error: ${err}. Retrying in ${interval}s...`);
      }

      // Sleep with abort support
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, interval! * 1000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
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

    // Step 1: Fetch head.json (~400 bytes)
    const head = await this.head(headUrl);

    // Step 2: Compare cursor
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
