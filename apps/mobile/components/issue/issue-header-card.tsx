/**
 * Slim header for the issue detail screen.
 *
 * Linear iOS-inspired layout:
 *   - identifier (MUL-NN) above as a small muted label
 *   - title in a large bold treatment
 *   - attribute chip row below (status / priority / assignee / labels /
 *     project / due date) — tappable, opens picker sheets
 *
 * The native iOS Stack header still renders `issue.identifier` as the
 * navigation title; the body re-renders it more prominently per the
 * reference screenshot.
 */
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { issueDetailOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";
import { AttributeRow } from "./attribute-row";
import { AgentActivityRow } from "./agent-activity-row";

export function IssueHeaderCard({ issue }: { issue: Issue }) {
  const { t } = useT("issues");
  const { workspace } = useLocalSearchParams<{ workspace: string }>();
  const wsId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const parentId = issue.parent_issue_id ?? "";
  const parent = useQuery(issueDetailOptions(wsId, parentId));

  return (
    <View className="px-4 pt-4 pb-3 gap-3">
      {workspace && parentId && !parent.isError && parent.data?.id === parentId ? (
        <Pressable
          accessibilityRole="link"
          className="self-start max-w-full active:opacity-60"
          onPress={() => router.push({
            pathname: "/[workspace]/issue/[id]",
            params: { workspace, id: parentId },
          })}
        >
          <Text className="text-sm text-primary" numberOfLines={1}>
            {t("detail.parent_issue", { identifier: parent.data.identifier, title: parent.data.title })}
          </Text>
        </Pressable>
      ) : parentId && (parent.isError || parent.isSuccess) ? (
        <Text className="text-sm text-muted-foreground">{t("detail.parent_unavailable")}</Text>
      ) : null}
      <Text className="text-xs text-muted-foreground">{issue.identifier}</Text>
      <Text className="text-2xl font-bold text-foreground">
        {issue.title}
      </Text>
      {/* Activity row sits between title and attributes — it represents
       *  "who's doing this issue right now / who has done it" (dynamic),
       *  which is higher-IA than the static property chips below.
       *  Conditionally renders null when there are no tasks at all. */}
      <AgentActivityRow issueId={issue.id} />
      <AttributeRow issue={issue} />
    </View>
  );
}
