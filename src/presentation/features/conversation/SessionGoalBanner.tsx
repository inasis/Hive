import { useEffect, useState, type FormEvent } from "react";
import type { AssistantProvider, AssistantGoal } from "../../shared/bridge";
import { useDesktopUiRuntime } from "../../shared/desktop-ui-runtime";
import { Icon } from "../../shared/Icon";
import { subscribeToSessionGoalChanges } from "../../shared/session-goal-events";

type Props = {
  target: string;
  provider: AssistantProvider;
  threadId: string;
  cwd: string;
  opening: boolean;
  hidden: boolean;
};

type GoalState = {
  key: string;
  goal: AssistantGoal | null;
  minimized: boolean;
  expanded: boolean;
  error: string;
  updating: boolean;
};

export function SessionGoalBanner(props: Props) {
  const { bridge } = useDesktopUiRuntime();
  const key = `${props.target}\u0000${props.provider}\u0000${props.threadId}`;
  const [state, setState] = useState<GoalState | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const current = state?.key === key ? state : null;

  useEffect(() => {
    if (!props.threadId || props.opening) return;
    let active = true;
    void (async () => {
      try {
        const catalog = await bridge.bridgeRpc.request.listCommands({
          target: props.target,
          provider: props.provider,
          threadId: props.threadId,
          cwd: props.cwd,
        });
        if (!active) return;
        setState({
          key,
          goal: catalog.goal ?? null,
          minimized: false,
          expanded: false,
          error: "",
          updating: false,
        });
      } catch {
        if (active) setState({ key, goal: null, minimized: false, expanded: false, error: "", updating: false });
      }
    })();
    return () => { active = false; };
  }, [bridge, key, props.cwd, props.opening, props.provider, props.target, props.threadId]);

  useEffect(() => subscribeToSessionGoalChanges((change) => {
    if (change.target !== props.target || change.provider !== props.provider || change.threadId !== props.threadId) return;
    setState((previous) => {
      const existing = previous?.key === key ? previous : null;
      return {
        key,
        goal: change.goal,
        minimized: existing?.minimized ?? false,
        expanded: existing?.expanded ?? false,
        error: "",
        updating: existing?.updating ?? false,
      };
    });
  }), [key, props.provider, props.target, props.threadId]);

  // A completed goal remains attached to its session until cleared or replaced.
  // Use the goal payload itself as the visibility signal so terminal status is shown too.
  if (!current?.goal?.objective.trim()) return null;

  const setMinimized = (minimized: boolean) => {
    setState((previous) => previous?.key === key ? { ...previous, minimized } : previous);
  };
  const setExpanded = (expanded: boolean) => {
    setState((previous) => previous?.key === key ? { ...previous, expanded } : previous);
  };
  const changeGoal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const objective = draft.trim();
    if (!objective || current.updating) return;
    setState((previous) => previous?.key === key ? { ...previous, updating: true, error: "" } : previous);
    try {
      const result = await bridge.bridgeRpc.request.runCommand({
        target: props.target,
        provider: props.provider,
        threadId: props.threadId,
        command: "goal",
        arguments: `set ${objective}`,
      });
      setState((previous) => previous?.key === key ? {
        ...previous,
        goal: result.goal ?? { objective },
        updating: false,
      } : previous);
      setEditing(false);
    } catch (error) {
      setState((previous) => previous?.key === key ? { ...previous, updating: false, error: errorMessage(error) } : previous);
    }
  };
  const clearGoal = async () => {
    if (current.updating) return;
    setState((previous) => previous?.key === key ? { ...previous, updating: true, error: "" } : previous);
    try {
      await bridge.bridgeRpc.request.runCommand({
        target: props.target,
        provider: props.provider,
        threadId: props.threadId,
        command: "goal",
        arguments: "clear",
      });
      setState((previous) => previous?.key === key ? { ...previous, goal: null, updating: false } : previous);
      setEditing(false);
    } catch (error) {
      setState((previous) => previous?.key === key ? { ...previous, updating: false, error: errorMessage(error) } : previous);
    }
  };

  if (current.minimized) {
    return <div className="session-goal-collapsed" hidden={props.hidden}>
      <button type="button" aria-label="세션 목표 펼치기" title={current.goal.objective} onClick={() => setMinimized(false)}>
        <Icon name="info" />
      </button>
    </div>;
  }

  return <aside className={`session-goal-banner ${current.expanded ? "expanded" : "summary"}`} aria-label="세션 목표" hidden={props.hidden}>
    <div className="session-goal-header">
      <div className="session-goal-heading"><Icon name="sparkles" /><span>세션 목표</span>{current.goal.status && <small>{goalStatusLabel(current.goal.status)}</small>}</div>
      <button
        className="session-goal-expand"
        type="button"
        aria-label={current.expanded ? "목표 상세 접기" : "목표 상세 펼치기"}
        aria-expanded={current.expanded}
        title={current.expanded ? "목표 상세 접기" : "목표 상세 펼치기"}
        onClick={() => setExpanded(!current.expanded)}
      ><Icon name="chevron-down" /></button>
    </div>
    {current.expanded && (editing ? <form id="session-goal-edit-form" onSubmit={changeGoal}>
      <textarea
        autoFocus
        aria-label="세션 목표 내용"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        placeholder="이 세션의 목표를 입력하세요"
      />
    </form> : <p className="session-goal-objective">{current.goal.objective}</p>)}
    {current.expanded && current.error && <div className="session-goal-error" role="alert">{current.error}</div>}
    {current.expanded && <div className="session-goal-actions">
      {editing ? <>
        <button className="session-goal-primary" type="submit" form="session-goal-edit-form" disabled={!draft.trim() || current.updating}>{current.updating ? "저장 중…" : "목표 변경"}</button>
        <button type="button" disabled={current.updating} onClick={() => { setEditing(false); setDraft(current.goal!.objective); }}>변경 취소</button>
      </> : <button type="button" disabled={current.updating} onClick={() => { setDraft(current.goal!.objective); setEditing(true); }}>목표 변경</button>}
      <button type="button" disabled={current.updating} onClick={() => void clearGoal()}>{current.updating ? "처리 중…" : "목표 취소"}</button>
      <button type="button" disabled={current.updating} onClick={() => setMinimized(true)}>접어두기</button>
    </div>}
    {!current.expanded && <p className="session-goal-objective">{current.goal.objective}</p>}
  </aside>;
}

function goalStatusLabel(status: string): string {
  switch (status) {
    case "active": return "진행 중";
    case "paused": return "일시 중지";
    case "blocked": return "막힘";
    case "usageLimited": return "사용량 제한";
    case "budgetLimited": return "예산 한도";
    case "complete": return "완료";
    default: return status;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
