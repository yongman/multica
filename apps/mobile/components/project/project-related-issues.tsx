/** Project issues use concrete status sections, like the other issue lists. */
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IssueSectionHeader } from "@/components/issue/issue-section-header";
import { IssueRow } from "@/components/issue/issue-row";
import { IssuesLoading } from "@/components/issue/issues-loading";
import { projectIssuesOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useIssueSections } from "@/lib/use-issue-sections";
import { useIssueStatuses } from "@/lib/use-issue-statuses";
import { useT } from "@/lib/i18n";

interface Props {
  projectId: string;
  onCreateIssue?: () => void;
}

export function ProjectRelatedIssues({ projectId, onCreateIssue }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { t } = useT("issues");
  const { data, isLoading, error, refetch } = useQuery(
    projectIssuesOptions(wsId, projectId),
  );

  const catalog = useIssueStatuses();
  const { sections, toggleSection } = useIssueSections(
    data ?? [], catalog.statuses, `${wsId}:${projectId}`,
  );

  const navigateToIssue = (id: string) => {
    if (wsSlug) router.push(`/${wsSlug}/issue/${id}`);
  };

  if (isLoading) return <IssuesLoading />;

  if (error) {
    return (
      <View className="px-4 py-6 gap-3">
        <Text className="text-sm text-destructive">
          {t("errors.load_failed", {
            message: error instanceof Error ? error.message : "unknown",
          })}
        </Text>
        <Button variant="outline" onPress={() => refetch()}>
          <Text>{t("common:actions.retry")}</Text>
        </Button>
      </View>
    );
  }

  return (
    <View>
      <View className="flex-row items-center justify-between gap-3 px-4 py-3">
        <Text className="shrink text-sm font-medium">
          {t("projects:detail.related_issues")}
        </Text>
        {onCreateIssue && (
          <Button variant="outline" size="sm" onPress={onCreateIssue}>
            <Text>{t("navigation:routes.new_issue")}</Text>
          </Button>
        )}
      </View>
      {!data?.length && (
        <View className="px-4 py-3">
          <Text className="text-sm text-muted-foreground">{t("list.empty")}</Text>
        </View>
      )}
      {sections.map(({ status, count, expanded, data: issues }) => {
        return (
          <View key={status}>
            <IssueSectionHeader
              status={status}
              count={count}
              expanded={expanded}
              onPress={() => toggleSection(status)}
            />
            {issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                onPress={() => navigateToIssue(issue.id)}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}
