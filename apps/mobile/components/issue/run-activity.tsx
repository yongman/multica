import { memo, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { runTranscriptMessagesOptions } from "@/data/queries/chat";
import { useRunTranscriptRealtime } from "@/data/realtime/use-run-transcript-realtime";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import {
  buildRunTranscriptEntries,
  currentRunEntry,
  isCancellableRunStatus,
  runEntrySummary,
  runTranscriptRoute,
} from "@/lib/run-transcript";
import { useT } from "@/lib/i18n";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { TranscriptEntry } from "./run-transcript";

/** Keep stream updates inside this card instead of rebuilding the comment list. */
export const RunActivity = memo(function RunActivity({ task, showIdentity = true }: { task: AgentTask; showIdentity?: boolean }) {
  const { t } = useT("issues");
  const { getName } = useActorLookup();
  const workspace = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const [expanded, setExpanded] = useState(false);
  const options = runTranscriptMessagesOptions(task.id);
  const query = useQuery({
    ...options,
    enabled: options.enabled && (task.status === "running" || expanded),
  });
  useRunTranscriptRealtime(task.issue_id, task.id);
  const entries = useMemo(() => buildRunTranscriptEntries(query.data ?? []), [query.data]);
  const current = currentRunEntry(entries);
  const active = isCancellableRunStatus(task.status);
  const summary = task.status !== "running"
    ? t(`runs.status.${task.status}`)
    : (current && runEntrySummary(current))
      || t(query.isError ? "runs.transcript.load_error" : "runs.transcript.waiting_response");

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="gap-2 rounded-lg border border-border bg-card p-3">
      <CollapsibleTrigger
        accessibilityRole="button"
        accessibilityLabel={t("runs.transcript.view_steps", { name: getName("agent", task.agent_id) })}
        accessibilityState={{ expanded }}
        className="flex-row items-center gap-2"
      >
        {showIdentity ? <ActorAvatar type="agent" id={task.agent_id} size={24} /> : null}
        <View className="min-w-0 flex-1 gap-1">
          {showIdentity ? <Text numberOfLines={1} className="text-xs font-medium text-foreground">
            {getName("agent", task.agent_id)}
          </Text> : null}
          <Text numberOfLines={2} className="text-xs text-muted-foreground">{summary}</Text>
        </View>
        {task.status === "running" || task.status === "dispatched" ? <ActivityIndicator size="small" /> : active ? (
          <Ionicons name={task.status === "waiting_local_directory" ? "pause-circle-outline" : "time-outline"} size={16} color={THEME[colorScheme].mutedForeground} />
        ) : null}
        <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={THEME[colorScheme].mutedForeground} />
      </CollapsibleTrigger>
      <CollapsibleContent className="gap-2">
        <Text className="text-xs text-muted-foreground">
          {t("runs.transcript.steps", { count: entries.length })}
        </Text>
        {query.isPending && query.isFetching ? (
          <Text className="text-xs text-muted-foreground">{t("runs.transcript.loading")}</Text>
        ) : null}
        {query.isError ? (
          <Pressable accessibilityRole="button" onPress={() => void query.refetch()} className="py-2">
            <Text className="text-xs text-destructive">{t("runs.transcript.load_error")} {t("runs.transcript.retry")}</Text>
          </Pressable>
        ) : null}
        {!query.isPending && !query.isError && entries.length === 0 ? (
          <Text className="text-xs text-muted-foreground">
            {t(active ? "runs.transcript.waiting_response" : "runs.transcript.empty")}
          </Text>
        ) : null}
        {entries.length > 6 ? (
          <Text className="text-xs text-muted-foreground">{t("runs.transcript.recent_steps")}</Text>
        ) : null}
        {entries.slice(-6).map((entry) => (
          <TranscriptEntry key={`${entry.task_id}-${entry.seq}`} item={entry} status={task.status} />
        ))}
        {workspace ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(runTranscriptRoute(workspace, task.issue_id, task.id))}
            className="py-2"
          >
            <Text className="text-sm text-brand">{t("runs.transcript.full_log")}</Text>
          </Pressable>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
});
