import type { ProviderSkillsPort, ProviderSkillCatalog } from "../../../application/ports/provider-skills.js";
import type { ProviderCommandsPort, ProviderCommandCatalog, ProviderCommandResult } from "../../../application/ports/provider-commands.js";
import type { AssistantCommand } from "../../../domain/assistant.js";
import type { PiSessionContext } from "./session-context.js";
import type { PiEventRecordHandler } from "./session-types.js";
import { listPiSkills } from "./session-skills.js";
import { mapPiCommands } from "./session-command-mapper.js";
import { asObject } from "./session-json-values.js";
import type { PiTurnAdapter } from "./session-turns.js";

/** Implements Pi skill and slash command discovery and execution. */
export class PiCommandAdapter implements ProviderSkillsPort, ProviderCommandsPort {
  constructor(private readonly context: PiSessionContext, private readonly turns: PiTurnAdapter, private readonly onRecord: PiEventRecordHandler) {}

  async listSkills(target: string, threadId: string, _cwd?: string): Promise<ProviderSkillCatalog> {
    const session = await this.context.open(target, threadId, (record) => this.onRecord(target, () => threadId, record));
    return { skills: await listPiSkills(session.client), warnings: [] };
  }

  async listCommands(target: string, threadId: string, _cwd?: string): Promise<ProviderCommandCatalog> {
    const session = await this.context.open(target, threadId, (record) => this.onRecord(target, () => threadId, record));
    const response = await session.client.request({ type: "get_commands" });
    const commands: AssistantCommand[] = [
      ...mapPiCommands(response.commands)
      .filter((command) => command.source !== "skill")
      .map((command) => ({
        name: command.name,
        description: command.description,
        provider: "Pi",
        takesArguments: true,
      })),
      ...PI_RPC_COMMANDS.filter((command) => !mapPiCommands(response.commands).some((row) => row.name === command.name))
        .map(({ name, description }) => ({ name, description, provider: "Pi RPC", takesArguments: true })),
    ];
    return { commands, warnings: [] };
  }

  async runCommand(target: string, threadId: string, command: string, argumentsText: string): Promise<ProviderCommandResult> {
    const rpcCommand = PI_RPC_COMMANDS.find((candidate) => candidate.name === command);
    if (rpcCommand?.type === "follow_up") {
      const result = await this.turns.queueFollowUp(target, threadId, argumentsText);
      return { executed: true, message: "Pi 후속 메시지를 대기열에 추가했습니다.", ...(result.turnId ? { turnId: result.turnId } : {}) };
    }
    if (rpcCommand) return this.runRpcCommand(target, threadId, rpcCommand.type, argumentsText);
    const available = (await this.listCommands(target, threadId)).commands;
    if (!available.some((candidate) => candidate.name === command)) {
      throw new Error(`Pi 명령 /${command}을(를) 찾을 수 없습니다. / 메뉴를 다시 열어 목록을 새로고침하세요.`);
    }
    const result = await this.turns.sendPrompt(target, threadId, {
      text: `/${command}${argumentsText ? ` ${argumentsText}` : ""}`,
    });
    return { executed: true, ...(result.turnId ? { turnId: result.turnId } : {}) };
  }

  private async runRpcCommand(target: string, threadId: string, type: string, argumentsText: string): Promise<ProviderCommandResult> {
    const session = await this.context.open(target, threadId, (record) => this.onRecord(target, () => threadId, record));
    if (type === "compact") {
      const result = await session.client.request({ type, ...(argumentsText.trim() ? { customInstructions: argumentsText.trim() } : {}) }, 180_000);
      return { executed: true, message: optionalString(result.summary) ? "Pi가 대화 기록을 압축했습니다." : "Pi 압축 명령을 실행했습니다." };
    }
    if (type === "get_session_stats") {
      const stats = await session.client.request({ type });
      return { executed: true, message: formatStats(stats) };
    }
    if (type === "export_html") {
      const exported = await session.client.request({ type, ...(argumentsText.trim() ? { outputPath: argumentsText.trim() } : {}) });
      const path = optionalString(exported.path);
      return { executed: true, message: path ? `Pi 대화를 HTML로 저장했습니다: ${path}` : "Pi 대화를 HTML로 내보냈습니다." };
    }
    if (type === "bash") {
      if (!argumentsText.trim()) throw new Error("/bash 뒤에 실행할 명령을 입력하세요.");
      const result = await session.client.request({ type, command: argumentsText }, 5 * 60_000);
      const output = optionalString(result.output)?.slice(0, 1200);
      const exitCode = typeof result.exitCode === "number" ? result.exitCode : undefined;
      return { executed: true, message: `${exitCode === undefined ? "완료" : `exit ${exitCode}`}${output ? ` · ${output}` : ""}` };
    }
    if (type === "clear_queue") {
      const cleared = await session.client.request({ type });
      const steering = stringArray(cleared.steering);
      const followUp = stringArray(cleared.followUp);
      const count = steering.length + followUp.length;
      return { executed: true, message: count ? `대기 중인 메시지 ${count}개를 지웠습니다.` : "대기 중인 메시지가 없습니다." };
    }
    if (type === "set_steering_mode" || type === "set_follow_up_mode") {
      const mode = argumentsText.trim();
      if (mode !== "all" && mode !== "one-at-a-time") throw new Error("값으로 all 또는 one-at-a-time을 입력하세요.");
      await session.client.request({ type, mode });
      return { executed: true, message: `${type === "set_steering_mode" ? "Pi steer" : "Pi 후속 메시지"} 모드를 ${mode}(으)로 변경했습니다.` };
    }
    if (type === "set_auto_compaction" || type === "set_auto_retry") {
      const value = argumentsText.trim().toLowerCase();
      if (!["on", "off", "true", "false"].includes(value)) throw new Error("값으로 on 또는 off를 입력하세요.");
      const enabled = value === "on" || value === "true";
      await session.client.request({ type, enabled });
      return { executed: true, message: `${type === "set_auto_compaction" ? "Pi 자동 압축" : "Pi 자동 재시도"}을 ${enabled ? "켰습니다" : "껐습니다"}.` };
    }
    await session.client.request({ type });
    return { executed: true, message: type === "abort_retry" ? "Pi 재시도를 중단했습니다." : "Pi bash 작업을 중단했습니다." };
  }
}

const PI_RPC_COMMANDS = [
  { name: "compact", type: "compact", description: "Pi 세션 기록을 압축합니다. 뒤에 요약 지침을 입력할 수 있습니다." },
  { name: "stats", type: "get_session_stats", description: "Pi 세션의 토큰 및 컨텍스트 사용량을 표시합니다." },
  { name: "export", type: "export_html", description: "Pi 대화를 HTML 파일로 내보냅니다. 선택적으로 출력 경로를 지정합니다." },
  { name: "bash", type: "bash", description: "Pi RPC를 통해 작업공간에서 셸 명령을 직접 실행합니다." },
  { name: "clear_queue", type: "clear_queue", description: "Pi에 대기 중인 steer 및 후속 메시지를 지웁니다." },
  { name: "follow_up", type: "follow_up", description: "현재 작업이 끝난 뒤 처리할 Pi 메시지를 대기열에 넣습니다." },
  { name: "steering_mode", type: "set_steering_mode", description: "Pi 메시지 전달 모드를 설정합니다: all 또는 one-at-a-time." },
  { name: "follow_up_mode", type: "set_follow_up_mode", description: "Pi 후속 메시지 처리 모드를 설정합니다: all 또는 one-at-a-time." },
  { name: "auto_compaction", type: "set_auto_compaction", description: "Pi 자동 컨텍스트 압축을 켜거나 끕니다: on 또는 off." },
  { name: "auto_retry", type: "set_auto_retry", description: "Pi 일시 오류 자동 재시도를 켜거나 끕니다: on 또는 off." },
  { name: "abort_retry", type: "abort_retry", description: "Pi의 진행 중인 자동 재시도를 중단합니다." },
  { name: "abort_bash", type: "abort_bash", description: "Pi RPC가 실행 중인 bash 명령을 중단합니다." },
] as const;

function formatStats(value: Record<string, unknown>): string {
  const tokens = asObject(value.tokens) ?? {};
  const context = asObject(value.contextUsage) ?? {};
  const tokenCount = typeof tokens.total === "number" ? tokens.total.toLocaleString() : "알 수 없음";
  const contextTokens = typeof context.tokens === "number" ? context.tokens.toLocaleString() : "알 수 없음";
  const contextWindow = typeof context.contextWindow === "number" ? context.contextWindow.toLocaleString() : "알 수 없음";
  const cost = typeof value.cost === "number" ? ` · 비용 ${value.cost.toFixed(4)}` : "";
  return `Pi 토큰 ${tokenCount} · 컨텍스트 ${contextTokens}/${contextWindow}${cost}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
