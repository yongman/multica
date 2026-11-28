/**
 * New issue creation modal.
 *
 * One scrolling form above a bottom mode switch. Property chips stay in
 * the form. Mention suggestions sit above the switch in the same keyboard-
 * avoiding container, so neither surface can overlap the other.
 *
 * No markdown toolbar / upload buttons in v1: mobile users creating an
 * issue rarely format markdown, and attachment upload is deferred to a
 * later release (see plan-issue-majestic-rabin.md "skip uploads").
 *
 * Mention pipeline shares `useMentionInput` with `issue/[id]/new-comment.tsx`
 * — both surfaces produce canonical `[@name](mention://type/id)` markdown
 * recognised by util.ParseMentions on the server.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "@/components/ui/keyboard-avoiding-view";
import {
  Stack,
  router,
  useLocalSearchParams,
  useNavigation,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@multica/core/types";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { SubmitIssueButton } from "@/components/issue/submit-issue-button";
import {
  CreateFormAttributeRow,
  CreateFormProjectChip,
} from "@/components/issue/create-form-attribute-row";
import { MentionSuggestionBar } from "@/components/issue/mention-suggestion-bar";
import { DescriptionField } from "@/components/issue/description-field";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { ApiError } from "@/data/api";
import { useAuthStore } from "@/data/auth-store";
import { useCreateIssue, useQuickCreateIssue } from "@/data/mutations/issues";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { squadListOptions } from "@/data/queries/squads";
import { runtimeListOptions } from "@/data/queries/runtimes";
import {
  findProject,
  projectDetailOptions,
  projectListOptions,
} from "@/data/queries/projects";
import { currentSessionEpoch, sessionEpochChanged } from "@/data/session-epoch";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  buildQuickCreateRequest,
  getIssueCreators,
} from "@/lib/issue-creators";
import { useMentionInput } from "@/lib/use-mention-input";
import { newIssueMentionMaxHeight } from "@/lib/new-issue-layout";
import { useT } from "@/lib/i18n";

export default function NewIssueModal() {
  const { t } = useT("issues");
  const { workspace, projectId } = useLocalSearchParams<{
    workspace: string;
    projectId?: string;
  }>();
  const wsId = useWorkspaceStore((state) =>
    state.currentWorkspaceSlug === workspace ? state.currentWorkspaceId : null,
  );
  const [initialProject, setInitialProject] = useState<Project | null>(null);
  const sourceOptions = projectDetailOptions(wsId, projectId ?? "");
  const source = useQuery({
    ...sourceOptions,
    enabled: sourceOptions.enabled && !initialProject,
  });

  if (!projectId || initialProject) {
    return <NewIssueForm initialProject={initialProject} />;
  }

  if (source.data?.id && !source.data.archived_at) {
    setInitialProject(source.data);
    return null;
  }

  if (source.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-background px-4">
      <Text className="text-sm text-muted-foreground">
        {t("new.project_unavailable")}
      </Text>
      {source.isError && (
        <Button variant="outline" onPress={() => source.refetch()}>
          <Text>{t("common:actions.retry")}</Text>
        </Button>
      )}
    </View>
  );
}

function NewIssueForm({ initialProject }: { initialProject: Project | null }) {
  const { t } = useT("issues");
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const [agentMode, setAgentMode] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [contentHeight, setContentHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const submitting = useRef(false);
  const description = useMentionInput();
  // Attribute chips (status / priority / assignee / due date / project)
  // live in `useNewIssueDraftStore` so the new-issue-picker/* formSheet
  // routes can read and write the same values without a parent-child
  // React relationship. The store is reset on mount + on unmount so
  // re-opening the new-issue modal starts clean.
  const status = useNewIssueDraftStore((s) => s.status);
  const priority = useNewIssueDraftStore((s) => s.priority);
  const assignee = useNewIssueDraftStore((s) => s.assignee);
  const dueDate = useNewIssueDraftStore((s) => s.dueDate);
  const project = useNewIssueDraftStore((s) => s.project);
  const creator = useNewIssueDraftStore((s) => s.creator);
  const resetDraft = useNewIssueDraftStore((s) => s.reset);

  useEffect(() => {
    resetDraft(initialProject);
    return () => {
      resetDraft();
    };
  }, [initialProject, resetDraft]);

  const createIssue = useCreateIssue();
  const quickCreate = useQuickCreateIssue();
  const isSubmitting = createIssue.isPending || quickCreate.isPending;
  const wsId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((state) => state.currentWorkspaceSlug);
  const projectId = project?.id ?? null;
  const { data: projects } = useQuery({
    ...projectListOptions(wsId),
    enabled: !!wsId && !!projectId,
  });
  const selectedProject = projects ? findProject(projects, projectId) : project;
  const projectUnavailable =
    !!projectId && (!selectedProject || !!selectedProject.archived_at);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const agents = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId && agentMode,
  });
  const members = useQuery({
    ...memberListOptions(wsId),
    enabled: !!wsId && agentMode,
  });
  const squads = useQuery({
    ...squadListOptions(wsId),
    enabled: !!wsId && agentMode,
  });
  const runtimes = useQuery({
    ...runtimeListOptions(wsId),
    enabled: !!wsId && agentMode,
  });
  const role =
    members.data?.find((member) => member.user_id === userId)?.role ?? null;
  const available = getIssueCreators(
    agents.data ?? [],
    squads.data ?? [],
    { userId, role },
    runtimes.data ?? [],
  );
  const selectedCreator =
    creator?.type === "squad"
      ? available.squads.find((squad) => squad.id === creator.id)
      : available.agents.find((agent) => agent.id === creator?.id);
  const creatorListFailed =
    agents.isError || members.isError || squads.isError || runtimes.isError;
  const waitingForCreators =
    !agents.data || !members.data || !squads.data || !runtimes.data;
  const agentRequest =
    agentMode && !creatorListFailed && !waitingForCreators
      ? buildQuickCreateRequest(creator, prompt, available, projectId)
      : null;
  const canSubmit =
    !isSubmitting &&
    !projectUnavailable &&
    (agentMode ? !!agentRequest : !!title.trim());

  async function onSubmit() {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    const epoch = currentSessionEpoch();
    try {
      if (agentRequest) {
        await quickCreate.mutateAsync(agentRequest);
      } else {
        await createIssue.mutateAsync({
          title: title.trim(),
          description: description.serialize().trim() || undefined,
          status,
          priority,
          ...(assignee
            ? { assignee_type: assignee.type, assignee_id: assignee.id }
            : {}),
          ...(dueDate ? { due_date: dueDate } : {}),
          ...(projectId ? { project_id: projectId } : {}),
        });
      }
      if (!sessionEpochChanged(epoch) && navigation.isFocused()) {
        router.back();
        if (agentMode) Alert.alert(t("new.agent_sent"), t("new.agent_inbox"));
      }
    } catch (err) {
      submitting.current = false;
      if (sessionEpochChanged(epoch) || !navigation.isFocused()) return;
      let message =
        err instanceof Error ? err.message : t("common:states.error");
      if (
        agentMode &&
        err instanceof ApiError &&
        err.body &&
        typeof err.body === "object"
      ) {
        if (
          "code" in err.body &&
          err.body.code === "daemon_version_unsupported"
        ) {
          message = t("new.agent_upgrade");
        } else if (
          "reason" in err.body &&
          typeof err.body.reason === "string"
        ) {
          message = err.body.reason;
        } else if ("error" in err.body && typeof err.body.error === "string") {
          message = err.body.error;
        }
      }
      Alert.alert(
        agentMode ? t("new.creator_send_failed") : t("errors.create_failed"),
        message,
      );
    }
  }

  const headerRight = () => (
    <SubmitIssueButton
      disabled={!canSubmit}
      loading={isSubmitting}
      onPress={onSubmit}
      accessibilityLabel={
        agentMode
          ? t(creator?.type === "squad" ? "new.squad_send" : "new.agent_send")
          : undefined
      }
    />
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Measure the space after keyboard avoidance, not the full screen. */}
        <View
          className="flex-1 min-h-0"
          onLayout={(event) =>
            setContentHeight(event.nativeEvent.layout.height)
          }
        >
          <ScrollView
            className="flex-1 min-h-0"
            contentContainerClassName="px-4 pt-4 pb-6 gap-4"
            keyboardShouldPersistTaps="handled"
          >
            {agentMode ? (
              <>
                <TextInput
                  value={prompt}
                  onChangeText={setPrompt}
                  accessibilityLabel={t("new.agent_prompt")}
                  placeholder={t("new.agent_prompt")}
                  placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                  className="min-h-28 py-2 text-base text-foreground"
                  multiline
                  textAlignVertical="top"
                  editable={!isSubmitting}
                />
                {creatorListFailed ? (
                  <View className="gap-2">
                    <Text className="text-sm text-destructive">
                      {t("new.creators_load_failed")}
                    </Text>
                    <Button
                      variant="outline"
                      className="self-start"
                      onPress={() => {
                        void agents.refetch();
                        void members.refetch();
                        void squads.refetch();
                        void runtimes.refetch();
                      }}
                    >
                      <Text>{t("common:actions.retry")}</Text>
                    </Button>
                  </View>
                ) : waitingForCreators ? (
                  <ActivityIndicator />
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="self-start max-w-full"
                      disabled={isSubmitting || !wsSlug}
                      onPress={() => {
                        if (!wsSlug) return;
                        Keyboard.dismiss();
                        router.push({
                          pathname: "/[workspace]/new-issue-picker/creator",
                          params: { workspace: wsSlug },
                        });
                      }}
                    >
                      {selectedCreator && creator && (
                        <ActorAvatar
                          type={creator.type}
                          id={creator.id}
                          size={20}
                        />
                      )}
                      <Text className="shrink" numberOfLines={1}>
                        {selectedCreator
                          ? t(
                              creator?.type === "squad"
                                ? "new.selected_squad"
                                : "new.selected_agent",
                              {
                                name: selectedCreator.name,
                              },
                            )
                          : t("new.choose_creator")}
                      </Text>
                    </Button>
                    {creator && !selectedCreator ? (
                      <Text className="text-sm text-destructive">
                        {t("new.creator_unavailable")}
                      </Text>
                    ) : null}
                    {available.agents.length === 0 &&
                    available.squads.length === 0 ? (
                      <Text className="text-sm text-muted-foreground">
                        {t("new.no_creators")}
                      </Text>
                    ) : null}
                  </>
                )}
                <CreateFormProjectChip disabled={isSubmitting} />
              </>
            ) : (
              <>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder={t("new.title_placeholder")}
                  placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                  className="text-2xl font-semibold text-foreground py-2"
                  accessibilityLabel={t("new.title_placeholder")}
                  autoFocus
                  returnKeyType="next"
                  editable={!isSubmitting}
                />
                <DescriptionField
                  description={description}
                  disabled={isSubmitting}
                />
                <CreateFormAttributeRow />
              </>
            )}
            {projectUnavailable && (
              <Text className="text-sm text-destructive">
                {t("new.project_unavailable")}
              </Text>
            )}
          </ScrollView>

          {/* Normal layout keeps suggestions, modes and the keyboard separate. */}
          {!agentMode && (
            <MentionSuggestionBar
              {...description.suggestionBar}
              maxHeight={newIssueMentionMaxHeight(contentHeight, footerHeight)}
            />
          )}
          <View
            role="tablist"
            onLayout={(event) =>
              setFooterHeight(event.nativeEvent.layout.height)
            }
            className="shrink-0 flex-row gap-2 border-t border-border bg-background px-4 pt-3"
            style={{
              paddingBottom: keyboardVisible ? 12 : Math.max(insets.bottom, 12),
            }}
          >
            <Button
              role="tab"
              aria-selected={!agentMode}
              className="flex-1 h-auto min-h-11 py-3"
              variant={agentMode ? "outline" : "default"}
              disabled={isSubmitting}
              accessibilityState={{
                selected: !agentMode,
                disabled: isSubmitting,
              }}
              onPress={() => setAgentMode(false)}
            >
              <Text className="shrink text-center">{t("new.manual_mode")}</Text>
            </Button>
            <Button
              role="tab"
              aria-selected={agentMode}
              className="flex-1 h-auto min-h-11 py-3"
              variant={agentMode ? "default" : "outline"}
              disabled={isSubmitting}
              accessibilityState={{
                selected: agentMode,
                disabled: isSubmitting,
              }}
              onPress={() => setAgentMode(true)}
            >
              <Text className="shrink text-center">{t("new.agent_mode")}</Text>
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
