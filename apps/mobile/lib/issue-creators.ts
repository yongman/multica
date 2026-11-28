import type { Agent, RuntimeDevice, Squad } from "@multica/core/types";
import { canAssignAgentToIssue } from "@multica/core/permissions/rules";
import type { PermissionContext } from "@multica/core/permissions";
import type { QuickCreateIssueRequest } from "@/data/api";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";

export type IssueCreator = { type: "agent" | "squad"; id: string };

/** Quick create runs immediately; squad picks inherit the leader's readiness
 * and invocation grants. The server rechecks runtime/CLI readiness on submit. */
export function getIssueCreators(
  agents: Agent[],
  squads: Squad[],
  context: PermissionContext,
  runtimes: readonly RuntimeDevice[] = [],
) {
  const runtimesById = new Map(
    runtimes.map((runtime) => [runtime.id, runtime]),
  );
  const availableAgents = agents.filter((agent) => {
    const runtime = runtimesById.get(agent.runtime_id);
    // Visible rows are authoritative. An offline row can still have a
    // recently-lost presence dot, but cannot accept an immediate request.
    // Only hidden runtimes use the privacy-safe projection from the agent.
    const available = runtime
      ? runtime.status === "online"
      : agent.runtime_availability === "online" ||
        agent.runtime_availability === "unstable";
    return (
      !agent.archived_at &&
      isAgentRuntimeBound(agent) &&
      available &&
      canAssignAgentToIssue(agent, context).allowed
    );
  });
  const availableIds = new Set(availableAgents.map((agent) => agent.id));
  return {
    agents: availableAgents,
    squads: squads.filter(
      (squad) => !squad.archived_at && availableIds.has(squad.leader_id),
    ),
  };
}

/** Resolve against fresh lists on every submit so a stale pick cannot dispatch. */
export function buildQuickCreateRequest(
  creator: IssueCreator | null,
  prompt: string,
  available: ReturnType<typeof getIssueCreators>,
  projectId?: string | null,
): QuickCreateIssueRequest | null {
  const trimmedPrompt = prompt.trim();
  if (!creator || !trimmedPrompt) return null;
  const fields = {
    prompt: trimmedPrompt,
    ...(projectId ? { project_id: projectId } : {}),
  };
  if (creator.type === "squad") {
    return available.squads.some((squad) => squad.id === creator.id)
      ? { ...fields, squad_id: creator.id }
      : null;
  }
  return available.agents.some((agent) => agent.id === creator.id)
    ? { ...fields, agent_id: creator.id }
    : null;
}
