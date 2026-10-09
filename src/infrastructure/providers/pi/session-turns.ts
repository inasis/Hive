import type { ProviderTurnsPort, ProviderPromptInput, ProviderPromptResult, ProviderSteerInput, ProviderSteerResult, ProviderInterruptResult } from "../../../application/ports/provider-turns.js";
import { appendA2ACommunicationSummary, hasA2ACommunicationSummary } from "../a2a-prompt-context.js";
import { appendAgentContext } from "../agent-prompt-context.js";
import { PiSessionContext } from "./session-context.js";
import { buildPiSkillPrompt } from "./session-skills.js";
import { PiTurnEventTracker } from "./turn-event-tracker.js";

/** Implements Pi prompt, steering, cancellation, and turn lifecycle orchestration. */
export class PiTurnAdapter implements ProviderTurnsPort {
  constructor(
    private readonly context: PiSessionContext,
    private readonly turnEvents: PiTurnEventTracker,
  ) {}

  async assertPromptReady(target: string, threadId: string): Promise<void> {
    const session = await this.context.open(target, threadId, (record) => this.turnEvents.handleRecord(target, () => threadId, record));
    if (!session.model) throw new Error("Pi 세션에서 사용할 모델을 확인할 수 없습니다.");
  }

  async sendPrompt(target: string, threadId: string, input: ProviderPromptInput): Promise<ProviderPromptResult> {
    if (!input.text.trim() && !input.images?.length && !hasA2ACommunicationSummary(input.a2aCommunications)) throw new Error("Message cannot be empty");
    const session = await this.context.open(target, threadId, (record) => this.turnEvents.handleRecord(target, () => threadId, record));
    const images = input.images?.length ? toPiImages(this.context, target, session.model, input.images) : undefined;
    const active = this.turnEvents.start(target, threadId);
    try {
      let prompt = input.text;
      if (input.skillId) prompt = await buildPiSkillPrompt(session.client, input.skillId, prompt);
      prompt = appendA2ACommunicationSummary(prompt, input.a2aCommunications);
      prompt = appendAgentContext(prompt, input.agentContext);
      const response = await session.client.request({ type: "prompt", message: prompt, ...(images ? { images } : {}) });
      if (response.disposition === "handled") this.turnEvents.finish(target, threadId, "completed");
      return { accepted: true, turnId: active.turnId };
    } catch (error) {
      const message = errorMessage(error);
      this.turnEvents.finish(target, threadId, "failed", message);
      throw error;
    }
  }

  async steerTurn(target: string, threadId: string, _turnId: string, input: ProviderSteerInput): Promise<ProviderSteerResult> {
    const session = await this.context.open(target, threadId, (record) => this.turnEvents.handleRecord(target, () => threadId, record));
    if (!this.turnEvents.hasActiveTurn(target, threadId)) throw new Error("Pi is not generating a response in this session.");
    let message = input.skillId ? await buildPiSkillPrompt(session.client, input.skillId, input.text) : input.text;
    message = appendAgentContext(message, input.agentContext);
    await session.client.request({ type: "steer", message });
    const current = this.turnEvents.getActiveTurn(target, threadId);
    return { steered: true, ...(current ? { turnId: current.turnId } : {}) };
  }

  async queueFollowUp(target: string, threadId: string, message: string): Promise<ProviderPromptResult> {
    if (!message.trim()) throw new Error("후속 메시지를 입력하세요.");
    const session = await this.context.open(target, threadId, (record) => this.turnEvents.handleRecord(target, () => threadId, record));
    const active = this.turnEvents.ensureStarted(target, threadId);
    try {
      const response = await session.client.request({ type: "follow_up", message });
      if (response.disposition === "handled") this.turnEvents.finish(target, threadId, "completed");
      return { accepted: true, turnId: active.turnId };
    } catch (error) {
      this.turnEvents.finish(target, threadId, "failed", errorMessage(error));
      throw error;
    }
  }

  async interruptTurn(target: string, threadId: string, _turnId: string): Promise<ProviderInterruptResult> {
    const session = await this.context.open(target, threadId, (record) => this.turnEvents.handleRecord(target, () => threadId, record));
    const current = this.turnEvents.getActiveTurn(target, threadId);
    await session.client.request({ type: "abort" });
    if (current) {
      this.turnEvents.markInterrupted(current);
      this.turnEvents.finish(target, threadId, "interrupted");
    }
    return { interrupted: true };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toPiImages(context: PiSessionContext, target: string, modelId: string | undefined, images: NonNullable<ProviderPromptInput["images"]>) {
  const model = modelId ? context.require(target).piModels.get(modelId) : undefined;
  if (!model?.input.includes("image")) throw new Error("선택한 Pi 모델은 이미지 입력을 지원하지 않습니다.");
  return images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
}
