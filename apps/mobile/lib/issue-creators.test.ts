import type { Agent, Squad } from "@multica/core/types";
import { describe, expect, it } from "vitest";
import { buildQuickCreateRequest, getIssueCreators } from "./issue-creators";

const context = { userId: "user-1", role: "member" as const };
const leader = {
  id: "leader-1",
  runtime_id: "runtime-1",
  runtime_bound: true,
  runtime_availability: "online",
  permission_mode: "public_to",
  invocation_targets: [{ target_type: "workspace", target_id: null }],
  owner_id: "other-user",
  archived_at: null,
} as Agent;
const squad = {
  id: "squad-1",
  leader_id: leader.id,
  archived_at: null,
} as Squad;

describe("quick-create actors", () => {
  it("keeps usable agents and squads whose leaders are usable", () => {
    expect(getIssueCreators([leader], [squad], context)).toEqual({
      agents: [leader],
      squads: [squad],
    });
  });

  it.each<Partial<Agent>>([
    { archived_at: "2026-11-01" },
    { runtime_bound: false },
    { runtime_id: "" },
    { runtime_id: "  " },
    { runtime_availability: "offline" },
    { permission_mode: "private" },
    { invocation_targets: [] },
    { invocation_targets: [{ target_type: "team", target_id: "team-1" }] },
  ])("excludes an unavailable leader and its squads: %j", (patch) => {
    expect(
      getIssueCreators([{ ...leader, ...patch }], [squad], context),
    ).toEqual({
      agents: [],
      squads: [],
    });
  });

  it("excludes archived squads and squads with missing leaders", () => {
    expect(
      getIssueCreators(
        [leader],
        [
          { ...squad, archived_at: "2026-11-01" },
          { ...squad, id: "missing", leader_id: "deleted-leader" },
        ],
        context,
      ).squads,
    ).toEqual([]);
  });

  it("does not let an admin bypass a private leader's permissions", () => {
    expect(
      getIssueCreators([{ ...leader, permission_mode: "private" }], [squad], {
        ...context,
        role: "admin",
      }).squads,
    ).toEqual([]);
  });

  it("allows the leader's owner and explicit member grants", () => {
    for (const agent of [
      {
        ...leader,
        owner_id: context.userId,
        permission_mode: "private" as const,
      },
      {
        ...leader,
        invocation_targets: [
          { target_type: "member" as const, target_id: context.userId },
        ],
      },
    ]) {
      expect(getIssueCreators([agent], [squad], context).squads).toEqual([
        squad,
      ]);
    }
  });

  it("supports legacy agents without runtime_bound or coarse availability", () => {
    expect(
      getIssueCreators(
        [
          {
            ...leader,
            runtime_bound: undefined,
            runtime_availability: undefined,
          },
        ],
        [squad],
        context,
      ).squads,
    ).toEqual([squad]);
  });

  it("does not infer offline from a hidden runtime or a busy/unstable agent", () => {
    expect(
      getIssueCreators(
        [
          {
            ...leader,
            status: "working",
            runtime_availability: "unstable",
          },
        ],
        [squad],
        context,
      ).squads,
    ).toEqual([squad]);
  });

  it("fails closed without a signed-in invoker or a workspace grant", () => {
    expect(
      getIssueCreators([leader], [squad], { userId: null, role: null }).squads,
    ).toEqual([]);
    expect(
      getIssueCreators([leader], [squad], { ...context, role: null }).squads,
    ).toEqual([]);
  });
});

describe("quick-create request", () => {
  const available = getIssueCreators([leader], [squad], context);

  it("sends only squad_id for a squad, with the trimmed prompt and project", () => {
    expect(
      buildQuickCreateRequest(
        { type: "squad", id: squad.id },
        "  Ship it\n ",
        available,
        "project-1",
      ),
    ).toEqual({
      squad_id: squad.id,
      prompt: "Ship it",
      project_id: "project-1",
    });
  });

  it("keeps the existing single-agent contract and omits an empty project", () => {
    expect(
      buildQuickCreateRequest(
        { type: "agent", id: leader.id },
        "Ship it",
        available,
        null,
      ),
    ).toEqual({ agent_id: leader.id, prompt: "Ship it" });
  });

  it("rejects empty prompts, missing picks and picks of the wrong type", () => {
    expect(buildQuickCreateRequest(null, "Ship it", available)).toBeNull();
    expect(
      buildQuickCreateRequest(
        { type: "squad", id: squad.id },
        " \n ",
        available,
      ),
    ).toBeNull();
    expect(
      buildQuickCreateRequest(
        { type: "agent", id: squad.id },
        "Ship it",
        available,
      ),
    ).toBeNull();
  });

  it("blocks a previously chosen squad after runtime, permission or archival changes", () => {
    for (const next of [
      getIssueCreators(
        [{ ...leader, runtime_availability: "offline" }],
        [squad],
        context,
      ),
      getIssueCreators(
        [{ ...leader, permission_mode: "private" }],
        [squad],
        context,
      ),
      getIssueCreators(
        [leader],
        [{ ...squad, archived_at: "2026-11-01" }],
        context,
      ),
      getIssueCreators([], [], context),
    ]) {
      expect(
        buildQuickCreateRequest(
          { type: "squad", id: squad.id },
          "Ship it",
          next,
        ),
      ).toBeNull();
    }
  });
});
