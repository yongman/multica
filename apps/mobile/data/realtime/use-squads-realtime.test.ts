// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { useSquadsRealtime } from "./use-squads-realtime";

const state = vi.hoisted(() => ({
  invalidate: vi.fn(),
  setup: undefined as unknown as (ws: unknown, wsId: string) => unknown,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
  queryOptions: (options: unknown) => options,
}));
vi.mock("@/data/api", () => ({ api: {} }));
vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: typeof state.setup) => { state.setup = setup; },
}));
beforeEach(() => state.invalidate.mockClear());

it.each(["squad:created", "squad:updated", "squad:deleted", "reconnect"])(
  "refreshes only the subscribed workspace directory on %s",
  (event) => {
    useSquadsRealtime();
    const handlers = new Map<string, () => void>();
    state.setup({
      on: (name: string, callback: () => void) => {
        handlers.set(name, callback);
        return () => {};
      },
      onReconnect: (callback: () => void) => {
        handlers.set("reconnect", callback);
        return () => {};
      },
    }, "origin-workspace");
    handlers.get(event)!();
    expect(state.invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: ["squads", "origin-workspace"],
    });
  },
);
