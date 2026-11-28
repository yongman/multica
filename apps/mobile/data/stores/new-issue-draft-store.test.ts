import { beforeEach, expect, it } from "vitest";
import type { Project } from "@multica/core/types";
import { useNewIssueDraftStore } from "./new-issue-draft-store";

beforeEach(() => useNewIssueDraftStore.getState().reset());

it("keeps the quick-create actor separate from manual assignee and shared project", () => {
  const draft = useNewIssueDraftStore.getState();
  draft.setAssignee({ type: "member", id: "person-1" });
  draft.setCreator({ type: "squad", id: "squad-1" });
  draft.setProject({ id: "project-1" } as Project);
  expect(useNewIssueDraftStore.getState()).toMatchObject({
    assignee: { type: "member", id: "person-1" },
    creator: { type: "squad", id: "squad-1" },
    project: { id: "project-1" },
  });
});

it("clears the creator on reset while preserving only the explicitly seeded project", () => {
  const draft = useNewIssueDraftStore.getState();
  draft.setCreator({ type: "squad", id: "squad-1" });
  draft.reset({ id: "project-2" } as Project);
  expect(useNewIssueDraftStore.getState()).toMatchObject({
    creator: null, assignee: null, project: { id: "project-2" },
  });
  draft.reset();
  expect(useNewIssueDraftStore.getState()).toMatchObject({ creator: null, project: null });
});
