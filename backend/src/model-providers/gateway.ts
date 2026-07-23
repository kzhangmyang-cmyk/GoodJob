import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  getModelProviderCatalogEntry
} from "./catalog.js";
import type { ModelDescriptor } from "./catalog.js";
import {
  hashModelCallValue
} from "./call-ledger.js";
import type {
  ModelCallLedger,
  ModelCallRecord,
  NewModelCallRecord
} from "./call-ledger.js";
import {
  OpenAiCompatibleAdapter,
  OpenAiCompatibleRequestError,
  OpenAiCompatibleResponseError
} from "./adapters/openai-compatible.js";
import type {
  OpenAiCompatibleResult,
  OpenAiCompatibleUsage
} from "./adapters/openai-compatible.js";
import type {
  AiJobModelSnapshot,
  ModelCapabilitySnapshot
} from "./types.js";

export type ModelGatewayErrorCode =
  | "MODEL_AUTH_FAILED"
  | "MODEL_NOT_FOUND"
  | "MODEL_RATE_LIMITED"
  | "MODEL_PROVIDER_UNAVAILABLE"
  | "MODEL_TIMEOUT"
  | "MODEL_EMPTY_RESPONSE"
  | "MODEL_CONTENT_FILTERED"
  | "MODEL_RESPONSE_INVALID"
  | "MODEL_CREDENTIAL_UNAVAILABLE"
  | "MODEL_CAPABILITY_UNSUPPORTED"
  | "MODEL_SCHEMA_INVALID";

const ERROR_MESSAGES: Record<ModelGatewayErrorCode, string> = {
  MODEL_AUTH_FAILED: "Model provider authentication failed",
  MODEL_NOT_FOUND: "Model or provider endpoint was not found",
  MODEL_RATE_LIMITED: "Model provider rate limit exceeded",
  MODEL_PROVIDER_UNAVAILABLE: "Model provider is temporarily unavailable",
  MODEL_TIMEOUT: "Model provider request timed out",
  MODEL_EMPTY_RESPONSE: "Model provider returned an empty response",
  MODEL_CONTENT_FILTERED: "Model provider filtered the response",
  MODEL_RESPONSE_INVALID: "Model provider returned an invalid response",
  MODEL_CREDENTIAL_UNAVAILABLE: "The snapshotted credential is unavailable",
  MODEL_CAPABILITY_UNSUPPORTED: "The snapshotted model lacks a required capability",
  MODEL_SCHEMA_INVALID: "Model output did not match the requested schema"
};

export class ModelGatewayError extends Error {
  constructor(
    public readonly code: ModelGatewayErrorCode,
    public readonly retryable: boolean,
    public readonly status: number | null = null,
    public readonly retryAfterMs: number | null = null
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = "ModelGatewayError";
  }
}

class AttemptResponseFailure extends ModelGatewayError {
  readonly #resultForHash: unknown;

  constructor(
    code: "MODEL_RESPONSE_INVALID" | "MODEL_SCHEMA_INVALID",
    resultForHash: unknown,
    public readonly usage: OpenAiCompatibleUsage,
    public readonly providerRequestId: string | null
  ) {
    super(code, false);
    this.name = "AttemptResponseFailure";
    this.#resultForHash = resultForHash;
  }

  resultForHash() {
    return this.#resultForHash;
  }
}

class SchemaValidationFailure extends AttemptResponseFailure {
  readonly #invalidOutput: string;
  readonly #validationErrors: string;

  constructor(
    invalidOutput: string,
    validationErrors: string,
    usage: OpenAiCompatibleUsage,
    providerRequestId: string | null
  ) {
    super(
      "MODEL_SCHEMA_INVALID",
      invalidOutput,
      usage,
      providerRequestId
    );
    this.name = "SchemaValidationFailure";
    this.#invalidOutput = invalidOutput;
    this.#validationErrors = validationErrors;
  }

  repairInput() {
    return this.#invalidOutput;
  }

  repairErrors() {
    return this.#validationErrors;
  }
}

export interface GatewayIdentity {
  ownerId: string;
  teamId: string;
  jobId: string;
}

export interface ActiveModelGatewayOptions {
  snapshot: AiJobModelSnapshot;
  identity: GatewayIdentity;
  capabilitySnapshotHash: string;
  baseUrl: string;
  baseUrlFingerprint: string;
  credentialResolver(
    connectionId: string,
    credentialVersion: number
  ): Promise<string>;
  fetch: typeof fetch;
  ledger: ModelCallLedger;
  attemptIdFactory?: () => string;
  requestIdFactory?: () => string;
  now?: () => number;
  timeoutMs?: number;
}

export interface ModelHealthResult {
  ok: boolean;
  provider: AiJobModelSnapshot["provider"];
  model: string;
  providerRequestId: string | null;
}

export interface StructuredGenerationRequest<T> {
  prompt: string;
  schema: z.ZodType<T>;
}

export interface StructuredGenerationResult<T> {
  value: T;
  repaired: boolean;
  usage: OpenAiCompatibleUsage;
  providerRequestId: string | null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallingRequest {
  prompt: string;
  tools: ToolDefinition[];
  parallelToolCalls?: boolean;
}

export interface ToolCallingResult {
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: OpenAiCompatibleUsage;
  providerRequestId: string | null;
}

export interface TextGenerationRequest {
  prompt: string;
}

export type ModelStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "done" };

interface AttemptValue<T> {
  value: T;
  usage: OpenAiCompatibleUsage;
  providerRequestId: string | null;
  resultForHash: unknown;
}

interface AttemptContext {
  attemptId: string;
  requestId: string;
  startedAt: number;
  parameterHash: string;
}

const ZERO_USAGE: OpenAiCompatibleUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0
});

function frozenSnapshot(snapshot: AiJobModelSnapshot): AiJobModelSnapshot {
  return Object.freeze({
    ...snapshot,
    capabilitySnapshot: Object.freeze({
      ...snapshot.capabilitySnapshot
    })
  });
}

function responseErrorCode(reason: OpenAiCompatibleResponseError["reason"]) {
  if (reason === "empty_response") return "MODEL_EMPTY_RESPONSE";
  if (reason === "content_filtered") return "MODEL_CONTENT_FILTERED";
  return "MODEL_RESPONSE_INVALID";
}

function normalizeGatewayError(error: unknown): ModelGatewayError {
  if (error instanceof ModelGatewayError) return error;
  if (error instanceof OpenAiCompatibleResponseError) {
    return new ModelGatewayError(responseErrorCode(error.reason), false);
  }
  if (error instanceof OpenAiCompatibleRequestError) {
    const status = error.status;
    if (status === 401 || status === 403) {
      return new ModelGatewayError("MODEL_AUTH_FAILED", false, status);
    }
    if (status === 404) {
      return new ModelGatewayError("MODEL_NOT_FOUND", false, status);
    }
    if (status === 429) {
      return new ModelGatewayError(
        "MODEL_RATE_LIMITED",
        true,
        status,
        error.retryAfterMs
      );
    }
    if (status !== null && status >= 500) {
      return new ModelGatewayError(
        "MODEL_PROVIDER_UNAVAILABLE",
        true,
        status
      );
    }
    const causeName = error.causeValue
      && typeof error.causeValue === "object"
      && "name" in error.causeValue
      ? String(error.causeValue.name)
      : "";
    if (causeName === "AbortError" || causeName === "TimeoutError") {
      return new ModelGatewayError("MODEL_TIMEOUT", true);
    }
    if (status === null) {
      return new ModelGatewayError("MODEL_PROVIDER_UNAVAILABLE", true);
    }
    return new ModelGatewayError("MODEL_RESPONSE_INVALID", false, status);
  }
  return new ModelGatewayError("MODEL_RESPONSE_INVALID", false);
}

function providerRequestIdFromError(error: unknown) {
  return error instanceof OpenAiCompatibleRequestError
    ? error.providerRequestId
    : null;
}

export class ActiveModelGateway {
  readonly #snapshot: AiJobModelSnapshot;
  readonly #identity: GatewayIdentity;
  readonly #capabilitySnapshotHash: string;
  readonly #baseUrlFingerprint: string;
  readonly #credentialResolver: ActiveModelGatewayOptions["credentialResolver"];
  readonly #ledger: ModelCallLedger;
  readonly #adapter: OpenAiCompatibleAdapter;
  readonly #attemptIdFactory: () => string;
  readonly #requestIdFactory: () => string;
  readonly #now: () => number;

  constructor(options: ActiveModelGatewayOptions) {
    this.#snapshot = frozenSnapshot(options.snapshot);
    this.#identity = Object.freeze({ ...options.identity });
    this.#capabilitySnapshotHash = options.capabilitySnapshotHash;
    this.#baseUrlFingerprint = options.baseUrlFingerprint;
    this.#credentialResolver = options.credentialResolver;
    this.#ledger = options.ledger;
    this.#attemptIdFactory = options.attemptIdFactory
      ?? (() => `model_attempt_${randomUUID()}`);
    this.#requestIdFactory = options.requestIdFactory
      ?? (() => `model_request_${randomUUID()}`);
    this.#now = options.now ?? Date.now;
    this.#adapter = new OpenAiCompatibleAdapter({
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs
    });
  }

  async healthCheck(): Promise<ModelHealthResult> {
    const result = await this.#runAttempt(
      { operation: "health_check" },
      async (credential, requestId) => {
        const response = await this.#adapter.listModels({
          credential,
          requestId
        });
        return {
          value: response,
          usage: response.usage,
          providerRequestId: response.providerRequestId,
          resultForHash: response.value.map((model) => model.id)
        };
      }
    );
    return {
      ok: true,
      provider: this.#snapshot.provider,
      model: this.#snapshot.model,
      providerRequestId: result.providerRequestId
    };
  }

  async listModels(): Promise<{
    source: "official_api" | "versioned_catalog";
    models: ModelDescriptor[];
  }> {
    if (!this.#snapshot.capabilitySnapshot.modelListing) {
      const catalog = getModelProviderCatalogEntry(this.#snapshot.provider);
      return {
        source: "versioned_catalog",
        models: catalog ? [...catalog.models] : []
      };
    }
    const result = await this.#runAttempt(
      { operation: "list_models" },
      async (credential, requestId) => {
        const response = await this.#adapter.listModels({
          credential,
          requestId
        });
        return {
          value: response.value,
          usage: response.usage,
          providerRequestId: response.providerRequestId,
          resultForHash: response.value.map((model) => model.id)
        };
      }
    );
    return {
      source: "official_api",
      models: result.value
    };
  }

  async generateStructured<T>(
    request: StructuredGenerationRequest<T>
  ): Promise<StructuredGenerationResult<T>> {
    this.#requireCapability(
      "structuredOutput",
      { operation: "generate_structured" }
    );
    try {
      const first = await this.#generateAndValidate(request.prompt, request.schema);
      return {
        value: first.value,
        repaired: false,
        usage: first.usage,
        providerRequestId: first.providerRequestId
      };
    } catch (error) {
      if (!(error instanceof SchemaValidationFailure)) throw error;
      const repairPrompt = [
        "Repair the following output so it matches the requested JSON schema.",
        "Return only one valid JSON object. Do not add facts or defaults.",
        "Local validation errors:",
        error.repairErrors(),
        "Previous output:",
        error.repairInput()
      ].join("\n");
      const repaired = await this.#generateAndValidate(
        repairPrompt,
        request.schema
      );
      return {
        value: repaired.value,
        repaired: true,
        usage: repaired.usage,
        providerRequestId: repaired.providerRequestId
      };
    }
  }

  async callTools(request: ToolCallingRequest): Promise<ToolCallingResult> {
    this.#requireCapability(
      "toolCalling",
      { operation: "call_tools", toolNames: request.tools.map((tool) => tool.name) }
    );
    if (request.parallelToolCalls) {
      this.#requireCapability(
        "parallelToolCalling",
        {
          operation: "call_tools",
          parallelToolCalls: true,
          toolNames: request.tools.map((tool) => tool.name)
        }
      );
    }
    const allowedToolNames = new Set(request.tools.map((tool) => tool.name));
    const result = await this.#runAttempt(
      {
        operation: "call_tools",
        prompt: request.prompt,
        tools: request.tools,
        parallelToolCalls: request.parallelToolCalls ?? false
      },
      async (credential, requestId) => {
        const response = await this.#adapter.callTools({
          snapshot: this.#snapshot,
          credential,
          requestId,
          prompt: request.prompt,
          tools: request.tools
        });
        const toolCalls = response.value.map((call) => {
          if (!allowedToolNames.has(call.name)) {
            throw new ModelGatewayError("MODEL_RESPONSE_INVALID", false);
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(call.argumentsText);
          } catch {
            throw new ModelGatewayError("MODEL_RESPONSE_INVALID", false);
          }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new ModelGatewayError("MODEL_RESPONSE_INVALID", false);
          }
          return {
            id: call.id,
            name: call.name,
            arguments: parsed as Record<string, unknown>
          };
        });
        return {
          value: toolCalls,
          usage: response.usage,
          providerRequestId: response.providerRequestId,
          resultForHash: response.value.map((call) => ({
            id: call.id,
            name: call.name,
            argumentsHash: hashModelCallValue(call.argumentsText)
          }))
        };
      }
    );
    return {
      toolCalls: result.value,
      usage: result.usage,
      providerRequestId: result.providerRequestId
    };
  }

  async *streamText(
    request: TextGenerationRequest
  ): AsyncIterable<ModelStreamEvent> {
    this.#requireCapability(
      "streaming",
      { operation: "stream_text" }
    );
    const context = this.#newAttempt({
      operation: "stream_text",
      prompt: request.prompt
    });
    let output = "";
    let providerRequestId: string | null = null;
    let usage = ZERO_USAGE;
    try {
      const credential = await this.#resolveCredential();
      const stream = await this.#adapter.streamText({
        snapshot: this.#snapshot,
        credential,
        requestId: context.requestId,
        prompt: request.prompt
      });
      providerRequestId = stream.providerRequestId;
      for await (const event of stream.events) {
        if (event.type === "text_delta" && event.delta) {
          output += event.delta;
          yield { type: "text_delta", delta: event.delta };
        } else if (event.type === "usage") {
          usage = event.usage;
        } else if (event.type === "done") {
          yield { type: "done" };
        }
      }
      this.#recordSuccess(
        context,
        usage,
        providerRequestId,
        output
      );
    } catch (error) {
      const normalized = error instanceof ModelGatewayError
        ? error
        : normalizeGatewayError(error);
      providerRequestId = providerRequestIdFromError(error);
      this.#recordFailure(context, normalized, providerRequestId);
      throw normalized;
    }
  }

  async #generateAndValidate<T>(prompt: string, schema: z.ZodType<T>) {
    return this.#runAttempt(
      {
        operation: "generate_structured",
        prompt
      },
      async (credential, requestId) => {
        const response = await this.#adapter.generateText({
          snapshot: this.#snapshot,
          credential,
          requestId,
          prompt,
          jsonMode: true
        });
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(response.value);
        } catch {
          throw new SchemaValidationFailure(
            response.value,
            "<root>: invalid_json",
            response.usage,
            response.providerRequestId
          );
        }
        const parsed = schema.safeParse(parsedJson);
        if (!parsed.success) {
          const validationErrors = parsed.error.issues
            .map((issue) =>
              `${issue.path.length ? issue.path.join(".") : "<root>"}: ${issue.code}`
            )
            .join("\n");
          throw new SchemaValidationFailure(
            response.value,
            validationErrors,
            response.usage,
            response.providerRequestId
          );
        }
        return {
          value: parsed.data,
          usage: response.usage,
          providerRequestId: response.providerRequestId,
          resultForHash: response.value
        };
      }
    );
  }

  #requireCapability(
    capability: keyof ModelCapabilitySnapshot,
    parameters: Record<string, unknown>
  ) {
    if (this.#snapshot.capabilitySnapshot[capability]) return;
    const context = this.#newAttempt(parameters);
    const error = new ModelGatewayError(
      "MODEL_CAPABILITY_UNSUPPORTED",
      false
    );
    this.#recordFailure(context, error, null);
    throw error;
  }

  async #resolveCredential() {
    try {
      const credential = await this.#credentialResolver(
        this.#snapshot.connectionId,
        this.#snapshot.credentialVersion
      );
      if (!credential.trim()) {
        throw new Error("Credential resolver returned an empty value");
      }
      return credential;
    } catch {
      throw new ModelGatewayError("MODEL_CREDENTIAL_UNAVAILABLE", false);
    }
  }

  async #runAttempt<T>(
    parameters: Record<string, unknown>,
    operation: (
      credential: string,
      requestId: string
    ) => Promise<AttemptValue<T>>
  ) {
    const context = this.#newAttempt(parameters);
    try {
      const credential = await this.#resolveCredential();
      const result = await operation(credential, context.requestId);
      this.#recordSuccess(
        context,
        result.usage,
        result.providerRequestId,
        result.resultForHash
      );
      return result;
    } catch (error) {
      const normalized = error instanceof ModelGatewayError
        ? error
        : normalizeGatewayError(error);
      const attemptFailure = error instanceof AttemptResponseFailure
        ? error
        : null;
      this.#recordFailure(
        context,
        normalized,
        attemptFailure?.providerRequestId
          ?? providerRequestIdFromError(error),
        attemptFailure?.usage ?? ZERO_USAGE,
        attemptFailure?.resultForHash()
      );
      throw error instanceof SchemaValidationFailure ? error : normalized;
    }
  }

  #newAttempt(parameters: Record<string, unknown>): AttemptContext {
    return {
      attemptId: this.#attemptIdFactory(),
      requestId: this.#requestIdFactory(),
      startedAt: this.#now(),
      parameterHash: hashModelCallValue(parameters)
    };
  }

  #recordSuccess(
    context: AttemptContext,
    usage: OpenAiCompatibleUsage,
    providerRequestId: string | null,
    resultForHash: unknown
  ) {
    this.#ledger.append(this.#recordBase(context, {
      providerRequestId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      status: "succeeded",
      error: null,
      resultHash: hashModelCallValue(resultForHash)
    }));
  }

  #recordFailure(
    context: AttemptContext,
    error: ModelGatewayError,
    providerRequestId: string | null,
    usage: OpenAiCompatibleUsage = ZERO_USAGE,
    resultForHash: unknown = { error: error.code }
  ) {
    this.#ledger.append(this.#recordBase(context, {
      providerRequestId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      status: "failed",
      error: {
        code: error.code,
        status: error.status,
        retryable: error.retryable,
        retryAfterMs: error.retryAfterMs
      },
      resultHash: hashModelCallValue(resultForHash)
    }));
  }

  #recordBase(
    context: AttemptContext,
    outcome: Pick<
      NewModelCallRecord,
      | "providerRequestId"
      | "inputTokens"
      | "outputTokens"
      | "reasoningTokens"
      | "status"
      | "error"
      | "resultHash"
    >
  ): NewModelCallRecord {
    return {
      ...this.#identity,
      attemptId: context.attemptId,
      connectionId: this.#snapshot.connectionId,
      credentialVersion: this.#snapshot.credentialVersion,
      capabilitySnapshotHash: this.#capabilitySnapshotHash,
      provider: this.#snapshot.provider,
      baseUrlFingerprint: this.#baseUrlFingerprint,
      model: this.#snapshot.model,
      promptVersion: this.#snapshot.promptVersion,
      schemaVersion: this.#snapshot.schemaVersion,
      requestId: context.requestId,
      providerRequestId: outcome.providerRequestId,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      reasoningTokens: outcome.reasoningTokens,
      latencyMs: Math.max(0, this.#now() - context.startedAt),
      status: outcome.status,
      error: outcome.error,
      cost: {
        amountMinor: 0,
        currency: "USD",
        kind: "unknown"
      },
      parameterHash: context.parameterHash,
      resultHash: outcome.resultHash
    };
  }
}
