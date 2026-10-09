import type { AssistantGoal, AssistantProvider } from "./bridge";

export type SessionGoalChange = {
  target: string;
  provider: AssistantProvider;
  threadId: string;
  goal: AssistantGoal | null;
};

type Listener = (change: SessionGoalChange) => void;
const listeners = new Set<Listener>();

export function publishSessionGoalChange(change: SessionGoalChange): void {
  for (const listener of listeners) listener(change);
}

export function subscribeToSessionGoalChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
