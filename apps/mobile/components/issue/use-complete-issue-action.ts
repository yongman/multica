import { Alert, Platform } from "react-native";
import type { IssueStatusCategory } from "@multica/core/types";
import { useUpdateIssue } from "@/data/mutations/issues";
import { currentSessionEpoch, sessionEpochChanged } from "@/data/session-epoch";
import { useActionSheet } from "@/lib/use-action-sheet";
import { useT } from "@/lib/i18n";
import { CLOSED_CATEGORIES } from "@/lib/issue-status";

export function useCompleteIssueAction(
  issueId: string | null,
  category: IssueStatusCategory | null,
): (() => void) | undefined {
  const { showActionSheetWithOptions } = useActionSheet();
  const { t } = useT("issues");
  const update = useUpdateIssue(issueId ?? "");

  if (
    Platform.OS !== "android" ||
    !issueId ||
    update.isPending ||
    (category && CLOSED_CATEGORIES.includes(category))
  ) {
    return undefined;
  }

  return () => {
    const epoch = currentSessionEpoch();
    showActionSheetWithOptions(
      {
        options: [t("common:actions.done"), t("common:actions.cancel")],
        cancelButtonIndex: 1,
      },
      async (index) => {
        if (index !== 0 || sessionEpochChanged(epoch)) return;
        try {
          await update.mutateAsync({ status: "done" });
        } catch (error) {
          if (sessionEpochChanged(epoch)) return;
          Alert.alert(
            t("form.save_failed"),
            error instanceof Error ? error.message : t("common:states.error"),
          );
        }
      },
    );
  };
}
