/**
 * Single row inside the agent-runs formSheet route
 * (`app/(app)/[workspace]/issue/[id]/runs.tsx`). Same component for active
 * and past tasks —
 * the trailing Cancel button is available for every cancellable status,
 * and the status badge / colour swaps based on the AgentTask.status enum.
 *
 * Every run opens its execution record. Cancel remains a separate button.
 */
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { router } from "expo-router";
import type { AgentTask } from "@multica/core/types";
import { redactSecrets } from "@multica/core/security/redact-secrets";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { RunCancelButton } from "./run-cancel-button";
import { RunActivity } from "./run-activity";
import { useActorLookup } from "@/data/use-actor-name";
import { runFailureBadgeLabel } from "@/lib/run-failure-badge";
import { timeAgo } from "@/lib/time-ago";
import { useT } from "@/lib/i18n";
import { isCancellableRunStatus, runTranscriptRoute } from "@/lib/run-transcript";
import { useWorkspaceStore } from "@/data/workspace-store";
import { THEME } from "@/lib/theme";

interface Props {
  task: AgentTask;
  issueId: string;
}

export function RunRow({ task, issueId }: Props) {
  const { getName } = useActorLookup();
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === "dark" ? "dark" : "light"];
  const workspace = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const isActive = isCancellableRunStatus(task.status);
  const summary = redactSecrets(task.trigger_summary?.trim() || fallbackSummary(task, t));
  // Past tasks use completed_at when present (server fills it for terminal
  // statuses); active tasks fall back to created_at so the user sees how
  // long it's been waiting.
  const timestamp = task.completed_at || task.created_at;

  const content = (
    <>
      <ActorAvatar type="agent" id={task.agent_id} size={28} showPresence />
      <View className="flex-1 gap-1">
        <Text
          className="text-sm text-foreground"
          numberOfLines={2}
        >
          <Text className="font-medium">{getName("agent", task.agent_id)}</Text>
          <Text className="text-muted-foreground"> · {summary}</Text>
        </Text>
        <View className="flex-row items-center gap-2">
          <StatusBadge task={task} />
          <Text className="text-xs text-muted-foreground">
            {timestamp ? timeAgo(timestamp) : ""}
          </Text>
        </View>
      </View>
      {workspace ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.mutedForeground}
        />
      ) : null}
    </>
  );

  return (
    <View className="gap-2 py-2">
      <View className="flex-row items-start gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("runs.open_transcript", { summary })}
          disabled={!workspace}
          onPress={() => { if (workspace) router.push(runTranscriptRoute(workspace, issueId, task.id)); }}
          className="min-w-0 flex-1 flex-row items-start gap-3 active:opacity-60"
        >
          {content}
        </Pressable>
        {isActive ? <RunCancelButton taskId={task.id} issueId={issueId} /> : null}
      </View>
      {isActive ? <RunActivity task={task} showIdentity={false} /> : null}
    </View>
  );
}

function StatusBadge({ task }: { task: AgentTask }) {
  const { t } = useT("issues");
  const label = t(`runs.status.${task.status}`);
  const cls = STATUS_CLASS[task.status] ?? "text-muted-foreground";
  // For failed tasks, surface the failure_reason inline so users don't have
  // to drill in. Missing / empty / unrecognised stays as just "Failed".
  if (task.status === "failed") {
    const reasonLabel = runFailureBadgeLabel(task.failure_reason);
    if (reasonLabel) {
      return (
        <Text className={`text-xs ${cls}`}>
          {label} · {reasonLabel}
        </Text>
      );
    }
  }
  return <Text className={`text-xs ${cls}`}>{label}</Text>;
}

function fallbackSummary(
  task: AgentTask,
  t: (key: string) => string,
): string {
  switch (task.kind) {
    case "comment":
      return t("summary.comment");
    case "autopilot":
      return t("summary.autopilot");
    case "chat":
      return t("summary.chat");
    case "quick_create":
      return t("summary.quick_create");
    case "direct":
    default:
      return t("summary.direct");
  }
}

const STATUS_CLASS: Record<AgentTask["status"], string> = {
  queued: "text-muted-foreground",
  deferred: "text-muted-foreground",
  dispatched: "text-brand",
  waiting_local_directory: "text-muted-foreground",
  running: "text-brand",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};
