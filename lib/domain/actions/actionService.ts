import type { Action, ActionStatus, ActionType } from "./actionTypes.ts";
import { canTransitionAction, invalidActionTransitionError } from "./actionTypes.ts";

export type ActionRepository = {
  get(projectId: string, id: string): Promise<Action | null> | Action | null;
  list(projectId: string): Promise<Action[]> | Action[];
  create(input: {
    projectId: string;
    findingId: string;
    recommendationId?: string;
    type: ActionType;
    title: string;
    target: Action["target"];
    parameters: Record<string, unknown>;
  }): Promise<Action> | Action;
  /** Applies only while the row still has `from`; a stale read throws a conflict. */
  transition(projectId: string, id: string, status: ActionStatus, result?: Record<string, unknown> | null, from?: ActionStatus): Promise<Action | null> | Action | null;
};

export async function getAction(repository: ActionRepository, projectId: string, id: string) {
  return repository.get(projectId, id);
}

export async function listActions(repository: ActionRepository, projectId: string) {
  return repository.list(projectId);
}

export async function createAction(repository: ActionRepository, input: Parameters<ActionRepository["create"]>[0]) {
  return repository.create(input);
}

export async function transitionAction(
  repository: ActionRepository,
  projectId: string,
  id: string,
  status: ActionStatus,
  result?: Record<string, unknown> | null,
) {
  const action = await repository.get(projectId, id);
  if (!action) return null;
  if (!canTransitionAction(action.status, status)) {
    throw invalidActionTransitionError(action.status, status);
  }
  return repository.transition(projectId, id, status, result, action.status);
}
