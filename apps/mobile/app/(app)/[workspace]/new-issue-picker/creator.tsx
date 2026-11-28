import { router } from "expo-router";
import { AssigneePickerBody } from "@/components/issue/pickers/assignee-picker-body";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";
import { useT } from "@/lib/i18n";

export default function NewIssueCreatorPickerRoute() {
  const { t } = useT("issues");
  const creator = useNewIssueDraftStore((state) => state.creator);
  const setCreator = useNewIssueDraftStore((state) => state.setCreator);
  const query = useNativeSearchBar(t("new.search_creators"));

  return (
    <AssigneePickerBody
      mode="quick-create"
      value={creator}
      query={query}
      onChange={(next) => {
        if (!next || next.type === "member") return;
        setCreator({ type: next.type, id: next.id });
        router.back();
      }}
    />
  );
}
