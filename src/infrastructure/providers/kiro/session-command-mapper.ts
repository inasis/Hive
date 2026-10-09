import type { AssistantCommand } from "../../../domain/assistant.js";
import type { KiroRemoteSession } from "./session-types.js";
import type { JsonObject } from "./session-utils.js";

export function listKiroCommands(session: KiroRemoteSession, threadId: string): AssistantCommand[] {
  const known = session.commandsByThread.get(threadId) ?? [];
  const commands = new Map<string, AssistantCommand>();
  for (const command of known) commands.set(command.name, command);
  const documented: AssistantCommand[] = [
    { name: "agent", description: "Kiro 에이전트를 바꿉니다.", provider: "Kiro", takesArguments: true },
    { name: "chat", description: "Kiro 채팅 세션을 관리합니다.", provider: "Kiro", takesArguments: true },
    { name: "clear", description: "대화 표시를 지웁니다.", provider: "Kiro", takesArguments: false },
    { name: "compact", description: "대화 맥락을 압축합니다.", provider: "Kiro", takesArguments: false },
    { name: "context", description: "프로젝트 맥락 파일을 관리합니다.", provider: "Kiro", takesArguments: true },
    { name: "effort", description: "모델의 Thinking 수준을 바꿉니다.", provider: "Kiro", takesArguments: true },
    { name: "help", description: "Kiro CLI 도움말을 엽니다.", provider: "Kiro", takesArguments: false },
    { name: "mcp", description: "MCP 서버 상태를 확인합니다.", provider: "Kiro", takesArguments: true },
    { name: "model", description: "현재 세션의 모델을 바꿉니다.", provider: "Kiro", takesArguments: true },
    { name: "rewind", description: "이전 대화 시점에서 새 세션을 만듭니다.", provider: "Kiro", takesArguments: true },
    { name: "tools", description: "도구 권한을 확인하고 관리합니다.", provider: "Kiro", takesArguments: true },
    { name: "plan", description: "Kiro Plan 에이전트로 전환합니다.", provider: "Kiro", takesArguments: true },
  ];
  for (const command of documented) if (!commands.has(command.name)) commands.set(command.name, command);
  for (const skill of session.skillsByThread.get(threadId) ?? []) {
    if (!commands.has(skill.name)) commands.set(skill.name, { name: skill.name, description: skill.description, provider: "Kiro skill", takesArguments: true });
  }
  return [...commands.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function kiroCommandArguments(command: string, rawArguments: string): JsonObject {
  const value = rawArguments.trim();
  if (!value) return {};
  if (command === "rewind") {
    if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error("Kiro /rewind expects a positive turn index.");
    return { index: Number(value) };
  }
  return { value };
}
