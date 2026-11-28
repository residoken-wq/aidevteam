import { beforeEach, describe, expect, it } from "vitest";
import {
  clearScrollPosition,
  getScrollStorageKey,
  loadScrollPosition,
  saveScrollPosition,
} from "./scroll-storage";

describe("scroll-storage", () => {
  const mockStorage: Record<string, string> = {};

  beforeEach(() => {
    for (const k of Object.keys(mockStorage)) {
      delete mockStorage[k];
    }
    // Setup global window mock for vitest node environment
    (globalThis as unknown as { window?: { sessionStorage: Storage } }).window = {
      sessionStorage: {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = v;
        },
        removeItem: (k: string) => {
          delete mockStorage[k];
        },
        clear: () => {
          for (const k of Object.keys(mockStorage)) delete mockStorage[k];
        },
        key: () => null,
        length: 0,
      },
    };
  });

  it("normalizes storage key by stripping ?task parameter", () => {
    const k1 = getScrollStorageKey("kanban-e2e", "?priority=high&task=5");
    const k2 = getScrollStorageKey("kanban-e2e", "?task=5&priority=high");
    const k3 = getScrollStorageKey("kanban-e2e", "?priority=high");
    expect(k1).toBe("kanban_scroll:kanban-e2e?priority=high");
    expect(k2).toBe("kanban_scroll:kanban-e2e?priority=high");
    expect(k3).toBe("kanban_scroll:kanban-e2e?priority=high");
  });

  it("saves and loads scroll position", () => {
    const pos = { scrollY: 350, scrollX: 0, boardScrollLeft: 120 };
    const saved = saveScrollPosition("proj-1", "?priority=high", pos);
    expect(saved).toBe(true);

    const loaded = loadScrollPosition("proj-1", "?priority=high");
    expect(loaded).toEqual(pos);
  });

  it("returns null when nothing saved or corrupted data", () => {
    expect(loadScrollPosition("proj-1", "?none=1")).toBeNull();

    mockStorage["kanban_scroll:proj-1?corrupt=1"] = "not-json";
    expect(loadScrollPosition("proj-1", "?corrupt=1")).toBeNull();

    mockStorage["kanban_scroll:proj-1?partial=1"] = JSON.stringify({ scrollY: 100 });
    expect(loadScrollPosition("proj-1", "?partial=1")).toBeNull();
  });

  it("clears saved scroll position", () => {
    saveScrollPosition("proj-1", "", { scrollY: 100, scrollX: 0, boardScrollLeft: 0 });
    expect(loadScrollPosition("proj-1", "")).not.toBeNull();

    clearScrollPosition("proj-1", "");
    expect(loadScrollPosition("proj-1", "")).toBeNull();
  });
});
