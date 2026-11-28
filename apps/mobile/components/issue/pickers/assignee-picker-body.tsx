/**
 * Pure picker body for issue assignee — polymorphic single-select over
 * members + agents + squads, plus an "Unassigned" option. See
 * status-picker-body.tsx for the split rationale.
 *
 * Mirrors web `packages/views/issues/components/pickers/assignee-picker.tsx`
 * (mobile skips frequency-sort; alphabetical instead).
 *
 * Header + search bar are owned by the iOS native nav header registered in
 * `app/(app)/[workspace]/_layout.tsx` (assignee Stack.Screen sets
 * `headerShown: true` + `title`); the route file wires
 * `headerSearchBarOptions.onChangeText` to a local `query` state and passes
 * it in as the `query` prop. This body is just a FlatList — no chrome.
 */
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import type {
  Agent,
  IssueAssigneeType,
  MemberWithUser,
  Squad,
} from "@multica/core/types";
import { canAssignAgentToIssue } from "@multica/core/permissions/rules";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { memberListOptions } from "@/data/queries/members";
import { agentListOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { getIssueCreators } from "@/lib/issue-creators";
import { useScrollToTopOnChange } from "@/lib/use-scroll-to-top-on-change";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { useT } from "@/lib/i18n";

const AVATAR_SIZE = 36;

export type AssigneeValue = {
  type: IssueAssigneeType;
  id: string;
} | null;

interface Props {
  value: AssigneeValue;
  query: string;
  onChange: (next: AssigneeValue) => void;
  /** Quick create excludes people/unassigned and requires an available runtime. */
  mode?: "assign" | "quick-create";
}

type Row =
  | { kind: "section"; group: "agents" | "squads" }
  | { kind: "unassigned" }
  | { kind: "member"; member: MemberWithUser }
  | { kind: "agent"; agent: Agent }
  | { kind: "squad"; squad: Squad };

function isRowSelected(value: AssigneeValue, row: Row): boolean {
  if (row.kind === "section") return false;
  if (row.kind === "unassigned") return value === null;
  if (value === null) return false;
  if (row.kind === "member")
    return value.type === "member" && value.id === row.member.user_id;
  if (row.kind === "agent")
    return value.type === "agent" && value.id === row.agent.id;
  return value.type === "squad" && value.id === row.squad.id;
}

export function AssigneePickerBody({
  value,
  query,
  onChange,
  mode = "assign",
}: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { t } = useT("issues");
  const membersQuery = useQuery(memberListOptions(wsId));
  const agentsQuery = useQuery(agentListOptions(wsId));
  const squadsQuery = useQuery(squadListOptions(wsId));
  const { data: members = [] } = membersQuery;
  const { data: agents = [] } = agentsQuery;
  const { data: squads = [] } = squadsQuery;
  const role =
    members.find((member) => member.user_id === userId)?.role ?? null;
  const quickCreate = mode === "quick-create";
  const loadFailed =
    membersQuery.isError || agentsQuery.isError || squadsQuery.isError;
  const loading = !membersQuery.data || !agentsQuery.data || !squadsQuery.data;
  const runnableAgentIds = useMemo(
    () =>
      new Set(
        agents
          .filter((agent) => !agent.archived_at && isAgentRuntimeBound(agent))
          .map((agent) => agent.id),
      ),
    [agents],
  );
  const listRef = useScrollToTopOnChange(query);
  const { colorScheme } = useColorScheme();
  // Tint color for the checkmark accessory. Project uses a monochrome
  // shadcn palette where `primary` is the canonical tint (near-black light /
  // near-white dark); matches Apple HIG's "tintColor" semantics for
  // selection accessories.
  const checkColor =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matchName = (name: string) => !q || name.toLowerCase().includes(q);

    const memberRows: Row[] = [...members]
      .filter((m) => matchName(m.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ kind: "member" as const, member: m }));
    const available = getIssueCreators(agents, squads, { userId, role });
    const agentRows: Row[] = [...(quickCreate ? available.agents : agents)]
      .filter((a) => !a.archived_at && matchName(a.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ kind: "agent" as const, agent: a }));
    const squadRows: Row[] = [...(quickCreate ? available.squads : squads)]
      .filter((s) => !s.archived_at && matchName(s.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ kind: "squad" as const, squad: s }));

    if (loadFailed || loading) return [];
    if (quickCreate) {
      return [
        ...(squadRows.length
          ? [
              { kind: "section" as const, group: "squads" as const },
              ...squadRows,
            ]
          : []),
        ...(agentRows.length
          ? [
              { kind: "section" as const, group: "agents" as const },
              ...agentRows,
            ]
          : []),
      ];
    }
    if (q) return [...memberRows, ...agentRows, ...squadRows];

    // Pin the currently-selected actor right below Unassigned and remove it
    // from its own section so it doesn't render twice. Apple HIG doesn't
    // require this — it's a product UX choice that speeds up the common
    // "see who's assigned + reassign nearby" path. Skipped when query is
    // active because search-result order should reflect matches, not state.
    const all = [...memberRows, ...agentRows, ...squadRows];
    const selectedRow = all.find((r) => isRowSelected(value, r));
    return [
      { kind: "unassigned" },
      ...(selectedRow ? [selectedRow] : []),
      ...memberRows.filter((r) => !isRowSelected(value, r)),
      ...agentRows.filter((r) => !isRowSelected(value, r)),
      ...squadRows.filter((r) => !isRowSelected(value, r)),
    ];
  }, [
    members,
    agents,
    squads,
    query,
    value,
    quickCreate,
    userId,
    role,
    loadFailed,
    loading,
  ]);

  const isSelected = (row: Row) => isRowSelected(value, row);

  const select = (row: Row) => {
    if (row.kind === "section") return;
    if (row.kind === "unassigned") onChange(null);
    else if (row.kind === "member")
      onChange({ type: "member", id: row.member.user_id });
    else if (row.kind === "agent")
      onChange({ type: "agent", id: row.agent.id });
    else onChange({ type: "squad", id: row.squad.id });
  };

  // FlatList is returned as the route's direct child so RNSScreenContentWrapper
  // can find it as a direct subview and apply the iOS formSheet header offset.
  // See react-native-screens#3634 — wrapping in a parent <View> hides the list
  // from the native search and the rows render at y=0, overlapping the header.
  return (
    <FlatList
      ref={listRef}
      data={rows}
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      keyExtractor={(row) => {
        if (row.kind === "section") return `section:${row.group}`;
        if (row.kind === "unassigned") return "unassigned";
        if (row.kind === "member") return `m:${row.member.user_id}`;
        if (row.kind === "agent") return `a:${row.agent.id}`;
        return `s:${row.squad.id}`;
      }}
      renderItem={({ item }) => {
        if (item.kind === "section") {
          return (
            <View className="px-4 pt-4 pb-2">
              <Text
                accessibilityRole="header"
                className="text-sm font-semibold text-muted-foreground"
              >
                {t(item.group === "squads" ? "picker.squads" : "picker.agents")}
              </Text>
            </View>
          );
        }
        const needsRuntime =
          (item.kind === "agent" && !isAgentRuntimeBound(item.agent)) ||
          (item.kind === "squad" &&
            !runnableAgentIds.has(item.squad.leader_id));
        const agent =
          item.kind === "agent"
            ? item.agent
            : item.kind === "squad"
              ? agents.find(
                  (candidate) => candidate.id === item.squad.leader_id,
                )
              : null;
        const noPermission = agent
          ? !canAssignAgentToIssue(agent, { userId, role }).allowed
          : item.kind === "squad";
        const disabled = needsRuntime || noPermission;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected(item), disabled }}
            disabled={disabled}
            onPress={() => select(item)}
            className={cn(
              "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
              disabled && "opacity-50",
            )}
          >
            {item.kind === "unassigned" ? (
              <View
                className="rounded-full border border-dashed border-muted-foreground/40 items-center justify-center"
                style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
              >
                <Text className="text-sm text-muted-foreground">∅</Text>
              </View>
            ) : item.kind === "member" ? (
              <ActorAvatar
                type="member"
                id={item.member.user_id}
                size={AVATAR_SIZE}
              />
            ) : item.kind === "agent" ? (
              <ActorAvatar type="agent" id={item.agent.id} size={AVATAR_SIZE} />
            ) : (
              <ActorAvatar type="squad" id={item.squad.id} size={AVATAR_SIZE} />
            )}
            <View className="flex-1">
              <Text className="text-base text-foreground" numberOfLines={2}>
                {item.kind === "unassigned"
                  ? t("picker.unassigned")
                  : item.kind === "member"
                    ? item.member.name
                    : item.kind === "agent"
                      ? item.agent.name
                      : item.squad.name}
              </Text>
              {quickCreate && item.kind === "squad" && agent ? (
                <Text
                  className="text-xs text-muted-foreground"
                  numberOfLines={2}
                >
                  {t("new.squad_leader", { name: agent.name })}
                  {item.squad.member_count != null
                    ? ` · ${t("new.squad_members", { count: item.squad.member_count })}`
                    : ""}
                </Text>
              ) : null}
            </View>
            {/* Right-aligned secondary label. Mirrors Apple's
              UITableViewCellStyleValue1 / UIListContentConfiguration.valueCell
              pattern used throughout iOS Settings — type tag in lighter font on
              the same row. Members carry no tag (they're the default actor). */}
            <View className="max-w-[40%] items-end gap-1">
              {item.kind === "agent" ? (
                <Text
                  className="text-sm text-muted-foreground"
                  numberOfLines={2}
                >
                  {noPermission
                    ? t("picker.no_access")
                    : isAgentRuntimeBound(item.agent)
                      ? t("picker.agent")
                      : t("picker.needs_runtime")}
                </Text>
              ) : item.kind === "squad" ? (
                <Text
                  className="text-sm text-muted-foreground"
                  numberOfLines={2}
                >
                  {noPermission
                    ? t("picker.no_access")
                    : needsRuntime
                      ? t("picker.leader_needs_runtime")
                      : t("picker.squad")}
                </Text>
              ) : null}
              {isSelected(item) ? (
                <Ionicons name="checkmark" size={20} color={checkColor} />
              ) : null}
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <View className="px-4 py-8 items-center gap-3">
          {loadFailed ? (
            <>
              <Text className="text-sm text-destructive">
                {t("new.creators_load_failed")}
              </Text>
              <Button
                variant="outline"
                onPress={() => {
                  void membersQuery.refetch();
                  void agentsQuery.refetch();
                  void squadsQuery.refetch();
                }}
              >
                <Text>{t("common:actions.retry")}</Text>
              </Button>
            </>
          ) : loading ? (
            <ActivityIndicator />
          ) : (
            <Text className="text-sm text-muted-foreground">
              {t(
                quickCreate && !query.trim()
                  ? "new.no_creators"
                  : "picker.no_matches",
              )}
            </Text>
          )}
        </View>
      }
    />
  );
}
