// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { refreshQuery } from "./query-refresh";

const queryKey = ["task-messages", "task-1"] as const;

describe("scoped query refresh", () => {
  it("does not invalidate a replacement session's query", async () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKey, ["previous session"]);
    const refresh = refreshQuery(qc, queryKey);
    qc.clear();
    qc.setQueryData(queryKey, ["new session"]);
    await refresh;
    expect(qc.getQueryData(queryKey)).toEqual(["new session"]);
    expect(qc.getQueryState(queryKey)?.isInvalidated).toBe(false);
    qc.clear();
  });

  it("keeps clients with the same key independent", async () => {
    const first = new QueryClient();
    const second = new QueryClient();
    first.setQueryData(queryKey, ["first"]);
    second.setQueryData(queryKey, ["second"]);
    await Promise.all([refreshQuery(first, queryKey), refreshQuery(second, queryKey)]);
    expect(first.getQueryState(queryKey)?.isInvalidated).toBe(true);
    expect(second.getQueryState(queryKey)?.isInvalidated).toBe(true);
    expect(first.getQueryData(queryKey)).toEqual(["first"]);
    expect(second.getQueryData(queryKey)).toEqual(["second"]);
    first.clear();
    second.clear();
  });
});
