import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import type { AgentTask, TaskMessagePayload } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Markdown } from "@/lib/markdown";
import { useT } from "@/lib/i18n";
import { buildRunTranscriptEntries, getRunDiagnostics, runToolContext, runToolStatus } from "@/lib/run-transcript";
import type { RunTranscriptEntry } from "@/lib/run-transcript";
import { THEME } from "@/lib/theme";

const DISPLAY_CLIP_CHARS = 8_000;

export function RunTranscript({
  items,
  task,
  header,
}: {
  items: readonly TaskMessagePayload[];
  task: AgentTask;
  header: React.ReactElement;
}) {
  const { t } = useT("issues");
  const timeline = useMemo(() => buildRunTranscriptEntries(items), [items]);
  const diagnostics = getRunDiagnostics(task);

  return (
    <FlatList
      className="flex-1"
      contentContainerClassName="px-4 py-4"
      data={timeline}
      keyExtractor={(item) => `${item.task_id}-${item.seq}`}
      renderItem={({ item }) => <TranscriptEntry item={item} status={task.status} />}
      ItemSeparatorComponent={EntrySeparator}
      ListHeaderComponent={
        <View className="mb-4 gap-4">
          {header}
          {diagnostics ? (
            <View className={`gap-2 rounded-lg border px-3 py-3 ${
              task.status === "failed" ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"
            }`}>
              {diagnostics.reasonKey ? (
                <Text className="text-sm font-medium text-destructive">
                  {t(`chat:${diagnostics.reasonKey}`)}
                </Text>
              ) : null}
              {diagnostics.error ? (
                <View className="gap-1">
                  <Text className="text-xs font-medium text-muted-foreground">
                    {t("runs.transcript.diagnostics")}
                  </Text>
                  <ClippedContent content={diagnostics.error} />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        diagnostics ? null : (
          <View className="items-center rounded-lg border border-dashed border-border px-4 py-8">
            <Text className="text-sm text-muted-foreground">
              {t("runs.transcript.empty")}
            </Text>
          </View>
        )
      }
    />
  );
}

function EntrySeparator() {
  return <View className="h-2" />;
}

/** Entries come from buildRunTranscriptEntries, which sanitizes before formatting. */
export function TranscriptEntry({ item: entry, status }: { item: RunTranscriptEntry; status: AgentTask["status"] }) {
  if (entry.kind === "tool") return <ToolEntry entry={entry} status={status} />;
  const item = entry.message;
  switch (item.type) {
    case "thinking":
      return (
        <EntryCard icon="bulb-outline" labelKey="thinking" collapsible>
          <ClippedContent content={item.content || "—"} />
        </EntryCard>
      );
    case "error":
      return (
        <EntryCard icon="alert-circle-outline" labelKey="error" destructive>
          <ClippedContent content={item.content || "—"} />
        </EntryCard>
      );
    case "text":
    default:
      return (
        <EntryCard icon="chatbubble-ellipses-outline" labelKey="output">
          {item.content ? (
            <ClippedContent content={item.content} markdown />
          ) : (
            <Text className="text-sm text-muted-foreground">—</Text>
          )}
        </EntryCard>
      );
  }
}

function ToolEntry({ entry, status }: { entry: Extract<RunTranscriptEntry, { kind: "tool" }>; status: AgentTask["status"] }) {
  const { t } = useT("issues");
  const { call, result } = entry;
  const state = runToolStatus(entry, status);
  const input =
    call?.input && Object.keys(call.input).length > 0
      ? JSON.stringify(call.input, null, 2)
      : "—";
  const detail = [call?.tool || result?.tool || t("runs.transcript.unknown_tool"), runToolContext(call)]
    .filter(Boolean).join(" · ");

  return (
    <EntryCard
      icon={state === "completed" ? "checkmark-circle-outline" : "terminal-outline"}
      labelKey={call ? "tool_call" : "tool_output"}
      detail={detail}
      stateLabel={t(`runs.transcript.step_status.${state}`)}
      destructive={state === "failed"}
      collapsible
    >
      <View className="gap-2">
        {call ? (
          <View className="rounded-md bg-muted px-3 py-2">
            <ClippedContent content={input} />
          </View>
        ) : null}
        {result ? <ToolResultContent item={result} /> : null}
        {!result ? (
          <Text className="text-xs text-muted-foreground">
            {t(state === "running" ? "runs.transcript.waiting_result" : "runs.transcript.no_result")}
          </Text>
        ) : null}
      </View>
    </EntryCard>
  );
}

function ToolResultContent({ item }: { item: TaskMessagePayload }) {
  const { t } = useT("issues");
  return (
    <View className="gap-2">
      <Text className="text-xs font-medium text-muted-foreground">
        {t("runs.transcript.tool_output")}
      </Text>
      <View className="rounded-md bg-muted px-3 py-2">
        <ClippedContent content={item.output || "—"} />
      </View>
      {item.output_truncated === true ? (
        <Text className="mt-2 text-xs text-muted-foreground">
          {t("runs.transcript.truncated")}
        </Text>
      ) : null}
    </View>
  );
}

function ClippedContent({ content, markdown = false }: { content: string; markdown?: boolean }) {
  const { t } = useT("issues");
  const [showFullOutput, setShowFullOutput] = useState(false);
  const clipped = content.length > DISPLAY_CLIP_CHARS;
  const shown = clipped && !showFullOutput
    ? `${content.slice(0, DISPLAY_CLIP_CHARS)}...`
    : content;

  return (
    <View className="gap-2">
      {markdown ? <Markdown content={shown} /> : (
        <Text selectable className="font-mono text-xs text-muted-foreground">
          {shown || "—"}
        </Text>
      )}
      {clipped ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowFullOutput(!showFullOutput)}
          className="mt-2 py-1"
        >
          <Text className="text-sm text-brand">
            {t(showFullOutput ? "runs.transcript.show_less" : "runs.transcript.show_more")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EntryCard({
  icon,
  labelKey,
  detail,
  stateLabel,
  destructive = false,
  collapsible = false,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  labelKey: "thinking" | "error" | "output" | "tool_call" | "tool_output";
  detail?: string;
  stateLabel?: string;
  destructive?: boolean;
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useT("issues");
  const [open, setOpen] = useState(false);
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === "dark" ? "dark" : "light"];
  const className = `rounded-lg border px-3 py-3 ${
    destructive ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"
  }`;
  const heading = (
    <>
      <Ionicons name={icon} size={14} color={destructive ? theme.destructive : theme.mutedForeground} />
      <View className="min-w-0 flex-1 gap-1">
        <Text numberOfLines={2} className={`text-xs font-medium ${destructive ? "text-destructive" : "text-muted-foreground"}`}>
          {t(`runs.transcript.${labelKey}`)}{detail ? ` · ${detail.slice(0, 320)}` : ""}
        </Text>
        {stateLabel ? <Text className="text-xs text-muted-foreground">{stateLabel}</Text> : null}
      </View>
    </>
  );

  if (collapsible) {
    return (
      <Collapsible open={open} onOpenChange={setOpen} className={className}>
        <CollapsibleTrigger className="flex-row items-center gap-2">
          {heading}
          <Ionicons
            name={open ? "chevron-down" : "chevron-forward"}
            size={14}
            color={theme.mutedForeground}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <View className={className}>
      <View className="mb-2 flex-row items-center gap-2">{heading}</View>
      {children}
    </View>
  );
}
