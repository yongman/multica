import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { redactSecrets } from "@multica/core/security/redact-secrets";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { RunTranscript } from "@/components/issue/run-transcript";
import { RunCancelButton } from "@/components/issue/run-cancel-button";
import { issueTasksOptions } from "@/data/queries/issues";
import { runTranscriptMessagesOptions } from "@/data/queries/chat";
import { useRunTranscriptRealtime } from "@/data/realtime/use-run-transcript-realtime";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";
import { isCancellableRunStatus, isRunTranscriptTaskId } from "@/lib/run-transcript";

export default function RunTranscriptRoute() {
  const params = useLocalSearchParams<{ id?: string; taskId?: string }>();
  const issueId = typeof params.id === "string" ? params.id : "";
  const taskId = isRunTranscriptTaskId(params.taskId) ? params.taskId : null;
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { getName } = useActorLookup();
  const { t } = useT("issues");

  const tasksQuery = useQuery(issueTasksOptions(wsId, issueId));
  const task = taskId
    ? tasksQuery.data?.find((candidate) => candidate.id === taskId)
    : undefined;
  const transcriptQuery = useQuery(runTranscriptMessagesOptions(task?.id));
  useRunTranscriptRealtime(issueId, task?.id);

  const retry = () => {
    void tasksQuery.refetch();
    if (task) void transcriptQuery.refetch();
  };

  if (tasksQuery.isLoading || (task && transcriptQuery.isLoading)) {
    return (
      <View className="flex-1 items-center justify-center gap-3">
        <ActivityIndicator />
        <Text className="text-sm text-muted-foreground">
          {t("runs.transcript.loading")}
        </Text>
      </View>
    );
  }

  if (
    (tasksQuery.error && !tasksQuery.data) ||
    (transcriptQuery.error && !transcriptQuery.data)
  ) {
    return (
      <StateMessage text={t("runs.transcript.load_error")}>
        <Button variant="outline" onPress={retry}>
          <Text>{t("runs.transcript.retry")}</Text>
        </Button>
      </StateMessage>
    );
  }

  if (!taskId || !task) {
    return <StateMessage text={t("runs.transcript.missing")} />;
  }

  const summary = redactSecrets(task.trigger_summary?.trim() || t("summary.direct"));

  return (
    <RunTranscript
      task={task}
      items={transcriptQuery.data ?? []}
      header={
        <View className="gap-3">
          {transcriptQuery.isError ? (
            <Button variant="outline" onPress={retry}>
              <Text>{t("runs.transcript.load_error")} {t("runs.transcript.retry")}</Text>
            </Button>
          ) : null}
          <View className="flex-row items-start gap-3 rounded-lg bg-muted/40 px-3 py-3">
            <ActorAvatar type="agent" id={task.agent_id} size={32} showPresence />
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-sm font-semibold text-foreground">
                {getName("agent", task.agent_id)}
              </Text>
              <Text className="text-sm text-muted-foreground">{summary}</Text>
              <Text className={statusClass(task.status)}>
                {t(`runs.status.${task.status}`)}
              </Text>
            </View>
            {isCancellableRunStatus(task.status) ? <RunCancelButton taskId={task.id} issueId={issueId} /> : null}
          </View>
        </View>
      }
    />
  );
}

function StateMessage({
  text,
  children,
}: {
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8">
      <Text className="text-center text-sm text-muted-foreground">{text}</Text>
      {children}
    </View>
  );
}

function statusClass(status: string): string {
  if (status === "failed") return "text-xs text-destructive";
  return "text-xs text-muted-foreground";
}
