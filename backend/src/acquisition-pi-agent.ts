import {
  Agent,
  type AgentMessage,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Tool
} from "@earendil-works/pi-ai";
import type {
  ModelProviderId
} from "./model-providers/types.js";
import {
  DEFAULT_ACQUISITION_PI_SYSTEM_PROMPT
} from "./acquisition-model-content.js";
import {
  createAcquisitionAgentTools,
  type AcquisitionAgentIdentity,
  type AcquisitionAgentToolExecutor,
  type AcquisitionToolAuditLedger
} from "./acquisition-pi-tools.js";

export interface AcquisitionPiModelSnapshot {
  jobId: string;
  connectionId: string;
  credentialVersion: number;
  provider: ModelProviderId;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  promptHash: string;
  schemaHash: string;
  capabilitySnapshotHash: string;
  baseUrlFingerprint: string;
}

export interface AcquisitionPiUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface AcquisitionPiTextTurn {
  type: "text";
  text: string;
  usage: AcquisitionPiUsage;
  providerRequestId: string | null;
}

export interface AcquisitionPiToolTurn {
  type: "tool_calls";
  calls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: AcquisitionPiUsage;
  providerRequestId: string | null;
}

export type AcquisitionPiTurnResult =
  | AcquisitionPiTextTurn
  | AcquisitionPiToolTurn;

export interface AcquisitionPiTurnInput {
  snapshot: AcquisitionPiModelSnapshot;
  systemPrompt: string;
  messages: Message[];
  tools: Tool[];
  signal?: AbortSignal;
}

export interface AcquisitionPiTurnRuntime {
  run(input: AcquisitionPiTurnInput): Promise<AcquisitionPiTurnResult>;
}

export interface CreateAcquisitionPiAgentOptions {
  identity: AcquisitionAgentIdentity;
  snapshot: AcquisitionPiModelSnapshot;
  runtime: AcquisitionPiTurnRuntime;
  toolExecutor: AcquisitionAgentToolExecutor;
  toolAudit: AcquisitionToolAuditLedger;
  toolAuditSecret: string;
  initialMessages?: AgentMessage[];
  systemPrompt?: string;
  now?: () => number;
}

const ZERO_PI_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
});

function piUsage(usage: AcquisitionPiUsage) {
  return {
    ...ZERO_PI_USAGE,
    input: Math.max(0, Math.trunc(usage.inputTokens)),
    output: Math.max(0, Math.trunc(usage.outputTokens)),
    reasoning: Math.max(0, Math.trunc(usage.reasoningTokens)),
    totalTokens:
      Math.max(0, Math.trunc(usage.inputTokens))
      + Math.max(0, Math.trunc(usage.outputTokens))
  };
}

function safeRuntimeError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "MODEL_STREAM_ABORTED",
      reason: "aborted" as const
    };
  }
  const raw = error instanceof Error ? error.message : "";
  return {
    code: raw.match(/^[A-Z][A-Z0-9_]{2,63}/)?.[0]
      ?? "MODEL_PROVIDER_UNAVAILABLE",
    reason: "error" as const
  };
}

function cloneMessage(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    content: message.content.map((content) => ({ ...content })),
    usage: {
      ...message.usage,
      cost: { ...message.usage.cost }
    }
  };
}

function initialAssistantMessage(
  snapshot: AcquisitionPiModelSnapshot,
  now: number
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "goodjob-gateway",
    provider: snapshot.provider,
    model: snapshot.model,
    usage: { ...ZERO_PI_USAGE, cost: { ...ZERO_PI_USAGE.cost } },
    stopReason: "stop",
    timestamp: now
  };
}

function createGatewayModel(
  snapshot: AcquisitionPiModelSnapshot
): Model<Api> {
  const model: Model<Api> = {
    id: snapshot.model,
    name: snapshot.model,
    api: "goodjob-gateway",
    provider: snapshot.provider,
    baseUrl: "goodjob://active-model-gateway",
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: 200_000,
    maxTokens: 16_384
  };
  return Object.freeze(model);
}

function createGatewayStreamFn(input: {
  snapshot: AcquisitionPiModelSnapshot;
  runtime: AcquisitionPiTurnRuntime;
  now: () => number;
}): StreamFn {
  return (_model, context: Context, options) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const initial = initialAssistantMessage(input.snapshot, input.now());
      stream.push({
        type: "start",
        partial: cloneMessage(initial)
      });
      try {
        const result = await input.runtime.run({
          snapshot: { ...input.snapshot },
          systemPrompt: context.systemPrompt ?? "",
          messages: context.messages.map((message) => structuredClone(message)),
          tools: (context.tools ?? []).map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: structuredClone(tool.parameters)
          })),
          signal: options?.signal
        });
        const usage = piUsage(result.usage);
        if (result.type === "text") {
          const text = result.text.trim();
          if (!text) throw new Error("MODEL_EMPTY_RESPONSE");
          const partial: AssistantMessage = {
            ...initial,
            responseId: result.providerRequestId ?? undefined,
            content: [{ type: "text", text: "" }],
            usage,
            stopReason: "stop"
          };
          stream.push({
            type: "text_start",
            contentIndex: 0,
            partial: cloneMessage(partial)
          });
          partial.content = [{ type: "text", text }];
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: text,
            partial: cloneMessage(partial)
          });
          stream.push({
            type: "text_end",
            contentIndex: 0,
            content: text,
            partial: cloneMessage(partial)
          });
          stream.push({
            type: "done",
            reason: "stop",
            message: cloneMessage(partial)
          });
          return;
        }

        if (!result.calls.length) {
          throw new Error("MODEL_EMPTY_RESPONSE");
        }
        const allowedTools = new Set(
          (context.tools ?? []).map((tool) => tool.name)
        );
        const partial: AssistantMessage = {
          ...initial,
          responseId: result.providerRequestId ?? undefined,
          usage,
          stopReason: "toolUse"
        };
        for (const call of result.calls) {
          if (!allowedTools.has(call.name)) {
            throw new Error("MODEL_RESPONSE_INVALID");
          }
          const contentIndex = partial.content.length;
          stream.push({
            type: "toolcall_start",
            contentIndex,
            partial: cloneMessage(partial)
          });
          const toolCall = {
            type: "toolCall" as const,
            id: call.id,
            name: call.name,
            arguments: structuredClone(call.arguments)
          };
          partial.content = [...partial.content, toolCall];
          stream.push({
            type: "toolcall_end",
            contentIndex,
            toolCall: { ...toolCall },
            partial: cloneMessage(partial)
          });
        }
        stream.push({
          type: "done",
          reason: "toolUse",
          message: cloneMessage(partial)
        });
      } catch (error) {
        const safe = safeRuntimeError(error);
        const failed: AssistantMessage = {
          ...initial,
          content: [],
          stopReason: safe.reason,
          errorMessage: safe.code
        };
        stream.push({
          type: "error",
          reason: safe.reason,
          error: failed
        });
      }
    })();
    return stream;
  };
}

function validatedSnapshot(
  snapshot: AcquisitionPiModelSnapshot
): AcquisitionPiModelSnapshot {
  for (const [name, value] of Object.entries(snapshot)) {
    if (name === "credentialVersion") continue;
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`snapshot.${name} is required`);
    }
  }
  if (
    !Number.isInteger(snapshot.credentialVersion)
    || snapshot.credentialVersion < 1
  ) {
    throw new TypeError("snapshot.credentialVersion must be a positive integer");
  }
  for (const name of ["promptHash", "schemaHash"] as const) {
    if (!snapshot[name].startsWith("sha256:")) {
      throw new TypeError(`snapshot.${name} must use a sha256: content identity`);
    }
  }
  return Object.freeze({ ...snapshot });
}

export function createAcquisitionPiAgent(
  options: CreateAcquisitionPiAgentOptions
) {
  const snapshot = validatedSnapshot(options.snapshot);
  const now = options.now ?? Date.now;
  const initialMessages = (options.initialMessages ?? [])
    .filter((message) =>
      message.role === "user"
      || message.role === "assistant"
      || message.role === "toolResult"
    )
    .map((message) => structuredClone(message));
  const tools = createAcquisitionAgentTools({
    identity: options.identity,
    executor: options.toolExecutor,
    audit: options.toolAudit,
    auditSecret: options.toolAuditSecret,
    now
  });
  return new Agent({
    initialState: {
      systemPrompt:
        options.systemPrompt?.trim() || DEFAULT_ACQUISITION_PI_SYSTEM_PROMPT,
      model: createGatewayModel(snapshot),
      thinkingLevel: "off",
      tools,
      messages: initialMessages
    },
    streamFn: createGatewayStreamFn({
      snapshot,
      runtime: options.runtime,
      now
    }),
    sessionId: options.identity.sessionId,
    toolExecution: "parallel",
    convertToLlm: (messages) =>
      messages.filter((message): message is Message =>
        message.role === "user"
        || message.role === "assistant"
        || message.role === "toolResult"
      )
  });
}
