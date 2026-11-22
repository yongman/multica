import { useQueryClient } from "@tanstack/react-query";
import type { TaskMessagePayload } from "@multica/core/types";
import { chatKeys } from "@/data/queries/chat";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import { appendTaskMessages, refreshTaskMessages } from "./chat-ws-updaters";
import { refreshIssueTasks } from "./issue-ws-updaters";

/** Own the selected run's stream for the lifetime of its detail screen. */
export function useRunTranscriptRealtime(issueId: string, taskId: string | undefined) {
  const qc = useQueryClient();

  useWSSubscriptions((ws, wsId) => {
    if (!issueId || !taskId) return;

    const isMine = (payload: { issue_id?: string; task_id: string }) =>
      payload.issue_id === issueId && payload.task_id === taskId;
    let pending: TaskMessagePayload[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      // A session change or GC may have removed this observer's cache.
      if (qc.getQueryState(chatKeys.taskMessages(taskId))) appendTaskMessages(qc, taskId, pending);
      pending = [];
    };
    const refreshMetadata = () => {
      void refreshIssueTasks(qc, wsId, issueId);
    };
    const refresh = () => {
      flush();
      void refreshTaskMessages(qc, taskId);
      refreshMetadata();
    };
    const onState = (payload: { issue_id?: string; task_id: string }) => {
      if (isMine(payload)) refreshMetadata();
    };
    const onTerminal = (payload: { issue_id?: string; task_id: string }) => {
      if (isMine(payload)) refresh();
    };

    return [
      ws.on("task:message", (payload) => {
        if (!isMine(payload)) return;
        pending.push(payload);
        // First frame is immediate; subsequent frames share a 100ms flush
        // window, matching the web transcript's batching.
        if (!timer) {
          flush();
          timer = setTimeout(flush, 100);
        }
      }),
      ws.on("task:queued", onState),
      ws.on("task:coalesced", onState),
      ws.on("task:dispatch", onState),
      ws.on("task:running", onState),
      ws.on("task:waiting_local_directory", onState),
      ws.on("task:completed", onTerminal),
      ws.on("task:failed", onTerminal),
      // Cancellation precedes the final flush. Continue accepting messages
      // afterward, and backfill again on the daemon's cancellation ack.
      ws.on("task:cancelled", onTerminal),
      ws.onReconnect(refresh),
      () => {
        // Cleanup can follow a session cache clear. Never seed the previous
        // session's data again; a future open backfills persisted frames.
        clearTimeout(timer);
        pending = [];
      },
    ];
  }, [issueId, taskId, qc]);
}
