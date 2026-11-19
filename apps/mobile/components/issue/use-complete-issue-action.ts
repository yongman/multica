import { Alert, Platform } from "react-native";
import type { IssueStatusCategory } from "@multica/core/types";
import { useUpdateIssue } from "@/data/mutations/issues";
import { currentSessionEpoch, sessionEpochChanged } from "@/data/session-epoch";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActionSheet } from "@/lib/use-action-sheet";
import { useT } from "@/lib/i18n";
import { isOpenIssueCategory } from "@/lib/issue-status";

export function useCompleteIssueAction(
  issueId: string | null,
  category: IssueStatusCategory | null,
): (() => void) | undefined {
  const { showActionSheetWithOptions } = useActionSheet();
  const { t } = useT("issues");
  const wsId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const update = useUpdateIssue(issueId ?? "", { requireOpen: true });

  if (
    Platform.OS !== "android" ||
    !wsId ||
    !issueId ||
    update.isPending ||
    !isOpenIssueCategory(category)
  ) {
    return undefined;
  }

  return () => {
    const epoch = currentSessionEpoch();
    const isCurrent = () =>
      !sessionEpochChanged(epoch) && useWorkspaceStore.getState().currentWorkspaceId === wsId;
    showActionSheetWithOptions(
      {
        options: [t("common:actions.done"), t("common:actions.cancel")],
        cancelButtonIndex: 1,
      },
      async (index) => {
        if (index !== 0 || !isCurrent()) return;
        try {
          await update.mutateAsync({ status: "done" });
        } catch (error) {
          if (!isCurrent()) return;
          Alert.alert(
            t("form.save_failed"),
            error instanceof Error ? error.message : t("common:states.error"),
          );
        }
      },
    );
  };
}
