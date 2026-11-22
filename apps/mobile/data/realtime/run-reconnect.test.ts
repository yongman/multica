// @vitest-environment node
import { hashKey, QueryClient, QueryObserver, type QueryKey } from "@tanstack/react-query";
import type { TaskMessagePayload } from "@multica/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/data/api";
import { chatKeys, taskMessagesOptions } from "@/data/queries/chat";
import { issueKeys } from "@/data/queries/issue-keys";
import type { WSSubscriptionSetup } from "@/lib/use-ws-subscriptions";
import { useIssueRealtime } from "./use-issue-realtime";
import { useRunTranscriptRealtime } from "./use-run-transcript-realtime";
import type { WSClient } from "./ws-client";

const state = vi.hoisted(() => ({
  qc: undefined as unknown as QueryClient,
  setups: [] as WSSubscriptionSetup[],
}));
vi.mock("@/data/api", () => ({ api: { listTaskMessages: vi.fn() } }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => state.qc,
}));
vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: WSSubscriptionSetup) => { state.setups.push(setup); },
}));

const workspace = "workspace";
const issue = "issue";
const task = "123e4567-e89b-12d3-a456-426614174000";
const otherTask = "123e4567-e89b-12d3-a456-426614174001";
const metadataKeys = [
  issueKeys.detail(workspace, issue), issueKeys.timeline(workspace, issue),
  issueKeys.attachments(workspace, issue), issueKeys.children(workspace, issue),
  issueKeys.activeTasks(workspace, issue), issueKeys.tasks(workspace, issue),
];
const allKeys = [...metadataKeys, chatKeys.taskMessages(task), chatKeys.taskMessages(otherTask)];
const stops: (() => void)[] = [];
type Request = { signal: AbortSignal; resolve: (value: unknown) => void };
const requests = new Map<string, Request[]>();
const calls = (key: QueryKey) => requests.get(hashKey(key)) ?? [];

function request<T>(key: QueryKey, signal: AbortSignal): Promise<T> {
  return new Promise((resolve) => {
    const list = calls(key);
    list.push({ signal, resolve: (value) => resolve(value as T) });
    requests.set(hashKey(key), list);
  });
}
function row(seq: number, taskId = task): TaskMessagePayload {
  return { task_id: taskId, issue_id: issue, seq, type: "text", content: `${seq}` };
}

function observe(warm: boolean) {
  for (const queryKey of metadataKeys) {
    if (warm) state.qc.setQueryData(queryKey, [{ snapshot: "cached" }]);
    const observer = new QueryObserver(state.qc, {
      queryKey, staleTime: Infinity, queryFn: ({ signal }) => request(queryKey, signal),
    });
    stops.push(observer.subscribe(() => {}));
  }
  for (const taskId of [task, otherTask]) {
    if (warm) state.qc.setQueryData(chatKeys.taskMessages(taskId), [row(1, taskId)]);
    const observer = new QueryObserver(state.qc, taskMessagesOptions(taskId));
    stops.push(observer.subscribe(() => {}));
  }
}

function mountStack() {
  // Issue screen + runs sheet, two cards for one run + its detail screen,
  // and a different agent's card, all sharing the workspace's WS client.
  useIssueRealtime(issue);
  useIssueRealtime(issue);
  useRunTranscriptRealtime(issue, task);
  useRunTranscriptRealtime(issue, task);
  useRunTranscriptRealtime(issue, task);
  useRunTranscriptRealtime(issue, otherTask);
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const reconnects = new Set<() => void>();
  const ws = {
    on(event: string, callback: (payload: unknown) => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(callback);
      handlers.set(event, set);
      return () => { set.delete(callback); };
    },
    onReconnect(callback: () => void) {
      reconnects.add(callback);
      return () => { reconnects.delete(callback); };
    },
  };
  for (const setup of state.setups) stops.push(...(setup(ws as unknown as WSClient, workspace) ?? []));
  return {
    reconnect: () => { for (const callback of reconnects) callback(); },
    emit: (event: string, payload: unknown) => { for (const callback of handlers.get(event) ?? []) callback(payload); },
  };
}

function finishLatest() {
  for (const key of metadataKeys) calls(key).at(-1)?.resolve([{ snapshot: "fresh" }]);
  for (const taskId of [task, otherTask]) {
    calls(chatKeys.taskMessages(taskId)).at(-1)?.resolve([row(1, taskId), row(2, taskId)]);
  }
}

describe("stacked run observers", () => {
  beforeEach(() => {
    state.qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    state.setups = [];
    requests.clear();
    vi.mocked(api.listTaskMessages).mockReset().mockImplementation((taskId, options) =>
      request(chatKeys.taskMessages(taskId), options!.signal!),
    );
  });
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    state.qc.clear();
  });

  it("backfills every key once per reconnect and preserves racing live frames", async () => {
    observe(true);
    const ws = mountStack();
    ws.reconnect();
    await vi.waitFor(() => {
      for (const key of allKeys) expect(calls(key), hashKey(key)).toHaveLength(1);
    });
    for (const key of allKeys) expect(calls(key)[0].signal.aborted, hashKey(key)).toBe(false);
    ws.emit("task:message", row(3));
    finishLatest();
    await vi.waitFor(() => {
      expect(state.qc.getQueryData<TaskMessagePayload[]>(chatKeys.taskMessages(task))?.map((message) => message.seq))
        .toEqual([1, 2, 3]);
      for (const key of allKeys) expect(state.qc.getQueryState(key)?.fetchStatus).toBe("idle");
    });
    ws.reconnect();
    await vi.waitFor(() => {
      for (const key of allKeys) expect(calls(key), hashKey(key)).toHaveLength(2);
    });
    finishLatest();
  });

  it("replaces each stale first load once without aborting the replacement", async () => {
    observe(false);
    const ws = mountStack();
    ws.reconnect();
    await vi.waitFor(() => {
      for (const key of allKeys) expect(calls(key), hashKey(key)).toHaveLength(2);
    });
    for (const key of allKeys) {
      expect(calls(key)[0].signal.aborted, hashKey(key)).toBe(true);
      expect(calls(key)[1].signal.aborted, hashKey(key)).toBe(false);
      calls(key)[0].resolve([]);
    }
    finishLatest();
    await vi.waitFor(() => {
      for (const key of metadataKeys) expect(state.qc.getQueryData(key)).toEqual([{ snapshot: "fresh" }]);
      expect(state.qc.getQueryData(chatKeys.taskMessages(task))).toEqual([row(1), row(2)]);
    });
  });

  it("lets a later terminal event replace an unfinished reconnect snapshot once", async () => {
    observe(true);
    const ws = mountStack();
    ws.reconnect();
    await vi.waitFor(() => expect(calls(chatKeys.taskMessages(task))).toHaveLength(1));
    ws.emit("task:completed", { task_id: task, issue_id: issue });
    const refreshedKeys = [
      metadataKeys[0], metadataKeys[1], metadataKeys[4], metadataKeys[5], chatKeys.taskMessages(task),
    ];
    await vi.waitFor(() => {
      for (const key of refreshedKeys) expect(calls(key), hashKey(key)).toHaveLength(2);
    });
    for (const key of refreshedKeys) {
      expect(calls(key)[0].signal.aborted, hashKey(key)).toBe(true);
      expect(calls(key)[1].signal.aborted, hashKey(key)).toBe(false);
    }
    expect(calls(chatKeys.taskMessages(otherTask))).toHaveLength(1);
    finishLatest();
  });
});
