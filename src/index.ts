/**
 * DiffDelta — Agent-ready intelligence feeds.
 *
 * @example
 * ```ts
 * import { DiffDelta } from "diffdelta";
 *
 * const dd = new DiffDelta();
 * const items = await dd.poll({ tags: ["security"] });
 * items.forEach(i => console.log(`🚨 ${i.source}: ${i.headline}`));
 * ```
 *
 * @packageDocumentation
 */

export { DiffDelta } from "./client.js";
export type { DiffDeltaOptions, PollOptions, WatchOptions } from "./client.js";
export type {
  FeedItem,
  Feed,
  Head,
  SourceInfo,
} from "./models.js";
export { CursorStore, MemoryCursorStore } from "./cursor.js";
