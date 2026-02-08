import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_CURSOR_DIR = join(homedir(), ".diffdelta");
const DEFAULT_CURSOR_FILE = "cursors.json";

/**
 * Persists cursors to a local JSON file so bots survive restarts.
 *
 * By default, cursors are saved to ~/.diffdelta/cursors.json.
 * Each feed key gets its own cursor entry.
 */
export class CursorStore {
  private path: string;
  private cursors: Record<string, string> = {};

  constructor(path?: string) {
    this.path =
      path ||
      process.env.DD_CURSOR_PATH ||
      join(DEFAULT_CURSOR_DIR, DEFAULT_CURSOR_FILE);
    this.load();
  }

  /** Get the stored cursor for a feed key. */
  get(key: string): string | undefined {
    return this.cursors[key];
  }

  /** Save a cursor and persist to disk. */
  set(key: string, cursor: string): void {
    this.cursors[key] = cursor;
    this.save();
  }

  /** Clear cursor(s). If key is undefined, clears all cursors. */
  clear(key?: string): void {
    if (key) {
      delete this.cursors[key];
    } else {
      this.cursors = {};
    }
    this.save();
  }

  private load(): void {
    try {
      if (existsSync(this.path)) {
        const raw = readFileSync(this.path, "utf-8");
        const data = JSON.parse(raw);
        if (typeof data === "object" && data !== null) {
          this.cursors = data;
        }
      }
    } catch {
      // Corrupted file — start fresh
      this.cursors = {};
    }
  }

  private save(): void {
    try {
      const dir = dirname(this.path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.path, JSON.stringify(this.cursors, null, 2));
    } catch {
      // Can't write — silently continue (in-memory only)
    }
  }
}

/**
 * In-memory-only cursor store (no file I/O).
 * Useful for serverless, browser, or Deno environments.
 */
export class MemoryCursorStore {
  private cursors: Record<string, string> = {};

  get(key: string): string | undefined {
    return this.cursors[key];
  }

  set(key: string, cursor: string): void {
    this.cursors[key] = cursor;
  }

  clear(key?: string): void {
    if (key) {
      delete this.cursors[key];
    } else {
      this.cursors = {};
    }
  }
}
