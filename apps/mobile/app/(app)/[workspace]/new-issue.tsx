/**
 * New issue creation modal.
 *
 * Layout follows Apple Reminders / Linear iOS / Things 3: one vertical
 * scrolling form (title → description → property chips), no sticky bottom
 * toolbar. Property chips are part of the form, not pinned above keyboard.
 * MentionSuggestionBar floats above keyboard only when the user is mid-@.
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
import { Stack, router, useLocalSearchParams, useNavigation } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@multica/core/types";
import { canAssignAgentToIssue } from "@multica/core/permissions/rules";
import { AgentPickerSheet } from "@/components/chat/agent-picker-sheet";
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
import { projectDetailOptions } from "@/data/queries/projects";
import { currentSessionEpoch, sessionEpochChanged } from "@/data/session-epoch";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { useMentionInput } from "@/lib/use-mention-input";
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
  const project = useQuery(projectDetailOptions(wsId, projectId ?? ""));

  if (!projectId) return <NewIssueForm />;

  if (project.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!project.data?.id || project.data.archived_at) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-4">
        <Text className="text-sm text-muted-foreground">{t("new.project_unavailable")}</Text>
        {project.isError && (
          <Button variant="outline" onPress={() => project.refetch()}>
            <Text>{t("common:actions.retry")}</Text>
          </Button>
        )}
      </View>
    );
  }

  return <NewIssueForm key={projectId} initialProject={project.data} />;
}

function NewIssueForm({ initialProject = null }: { initialProject?: Project | null }) {
  const { t } = useT("issues");
  const navigation = useNavigation();
  const [agentMode, setAgentMode] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
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
  const resetDraft = useNewIssueDraftStore((s) => s.reset);
  const [defaultProject] = useState(initialProject);

  useEffect(() => {
    resetDraft(defaultProject);
    return () => {
      resetDraft();
    };
  }, [defaultProject, resetDraft]);

  const createIssue = useCreateIssue();
  const quickCreate = useQuickCreateIssue();
  const isSubmitting = createIssue.isPending || quickCreate.isPending;
  const wsId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const agents = useQuery({ ...agentListOptions(wsId), enabled: !!wsId && agentMode });
  const members = useQuery({ ...memberListOptions(wsId), enabled: !!wsId && agentMode });
  const role = members.data?.find((member) => member.user_id === userId)?.role ?? null;
  const availableAgents = (agents.data ?? []).filter(
    (agent) =>
      !agent.archived_at &&
      isAgentRuntimeBound(agent) &&
      agent.runtime_availability !== "offline" &&
      canAssignAgentToIssue(agent, { userId, role }).allowed,
  );
  const selectedAgent = availableAgents.find((agent) => agent.id === agentId);
  const agentListFailed = agents.isError || members.isError;
  const waitingForAgents = !agents.data || !members.data;
  const trimmedPrompt = prompt.trim();
  const agentRequest =
    agentMode && selectedAgent && trimmedPrompt && !agentListFailed && !waitingForAgents
      ? { prompt: trimmedPrompt, agent_id: selectedAgent.id, project_id: project?.id }
      : null;
  const canSubmit = !isSubmitting && (agentMode ? !!agentRequest : !!title.trim());

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
          ...(project ? { project_id: project.id } : {}),
        });
      }
      if (!sessionEpochChanged(epoch) && navigation.isFocused()) {
        router.back();
        if (agentMode) Alert.alert(t("new.agent_sent"), t("new.agent_inbox"));
      }
    } catch (err) {
      submitting.current = false;
      if (sessionEpochChanged(epoch) || !navigation.isFocused()) return;
      let message = err instanceof Error ? err.message : t("common:states.error");
      if (agentMode && err instanceof ApiError && err.body && typeof err.body === "object") {
        if ("code" in err.body && err.body.code === "daemon_version_unsupported") {
          message = t("new.agent_upgrade");
        } else if ("reason" in err.body && typeof err.body.reason === "string") {
          message = err.body.reason;
        } else if ("error" in err.body && typeof err.body.error === "string") {
          message = err.body.error;
        }
      }
      Alert.alert(
        agentMode ? t("new.agent_send_failed") : t("errors.create_failed"),
        message,
      );
    }
  }

  const headerRight = () => (
    <SubmitIssueButton
      disabled={!canSubmit}
      loading={isSubmitting}
      onPress={onSubmit}
      accessibilityLabel={agentMode ? t("new.agent_send") : undefined}
    />
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-6 gap-4"
          keyboardShouldPersistTaps="handled"
        >
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={isSubmitting}
            onPress={() => setAgentMode(!agentMode)}
          >
            <Text>{agentMode ? t("new.manual_mode") : t("new.agent_mode")}</Text>
          </Button>
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
              {agentListFailed ? (
                <View className="gap-2">
                  <Text className="text-sm text-destructive">{t("new.agents_load_failed")}</Text>
                  <Button
                    variant="outline"
                    className="self-start"
                    onPress={() => { void agents.refetch(); void members.refetch(); }}
                  >
                    <Text>{t("common:actions.retry")}</Text>
                  </Button>
                </View>
              ) : waitingForAgents ? (
                <ActivityIndicator />
              ) : availableAgents.length === 0 ? (
                <Text className="text-sm text-muted-foreground">{t("new.no_agents")}</Text>
              ) : (
                <Button
                  variant="outline"
                  className="self-start max-w-full"
                  disabled={isSubmitting}
                  onPress={() => {
                    Keyboard.dismiss();
                    setAgentPickerOpen(true);
                  }}
                >
                  <Text numberOfLines={1}>
                    {selectedAgent
                      ? t("new.selected_agent", { name: selectedAgent.name })
                      : t("chat:picker.title")}
                  </Text>
                </Button>
              )}
              <CreateFormProjectChip disabled={isSubmitting} />
              {agentPickerOpen && (
                <AgentPickerSheet
                  visible
                  agents={availableAgents}
                  currentAgentId={agentId}
                  onPick={(agent) => setAgentId(agent.id)}
                  onClose={() => setAgentPickerOpen(false)}
                />
              )}
            </>
          ) : (
            <>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t("new.title_placeholder")}
                placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
                className="text-2xl font-semibold text-foreground py-2"
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
        </ScrollView>

        {/* Mention suggestions float above the keyboard only when the user
            types `@`. Self-hides via `if (!visible) return null` so it
            doesn't take space at rest. */}
        {!agentMode && <MentionSuggestionBar {...description.suggestionBar} />}
      </KeyboardAvoidingView>
    </>
  );
}
