import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { z } from "zod";
import {
  MODEL_PROVIDER_CATALOG
} from "./model-providers/catalog.js";
import {
  AppendOnlyModelCallLedger
} from "./model-providers/call-ledger.js";
import {
  ActiveModelGateway,
  ModelGatewayError
} from "./model-providers/gateway.js";
import type {
  AiJobModelSnapshot,
  ModelCapabilitySnapshot
} from "./model-providers/types.js";

const apiKey = "sk-task-four-private";
const rawPrompt = "Return the private launch plan";
const rawOutput = "{\"plan\":\"qualified\"}";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function snapshot(
  capabilityOverrides: Partial<ModelCapabilitySnapshot> = {}
): AiJobModelSnapshot {
  return Object.freeze({
    connectionId: "conn_moonshot",
    credentialVersion: 2,
    provider: "moonshot",
    model: "moonshot-v1-8k",
    capabilitySnapshot: Object.freeze({
      structuredOutput: true,
      toolCalling: true,
      parallelToolCalling: false,
      streaming: true,
      modelListing: true,
      ...capabilityOverrides
    }),
    promptVersion: "lead-plan.v1",
    schemaVersion: "acquisition-plan.v1"
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}

function completionResponse(
  content: string | null,
  overrides: Record<string, unknown> = {}
) {
  return jsonResponse({
    id: "chatcmpl_fixture",
    object: "chat.completion",
    created: 1_774_464_000,
    model: "moonshot-v1-8k",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content
      },
      finish_reason: "stop"
    }],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
      completion_tokens_details: {
        reasoning_tokens: 2
      }
    },
    ...overrides
  }, 200, {
    "x-request-id": "provider_req_fixture"
  });
}

function createFixture(
  responses: Array<Response | Error>,
  capabilityOverrides: Partial<ModelCapabilitySnapshot> = {},
  timeoutOptions: {
    requestTimeoutMs?: number;
    streamIdleTimeoutMs?: number;
  } = {}
) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const credentialResolutions: Array<{
    connectionId: string;
    credentialVersion: number;
  }> = [];
  let attempt = 0;
  let request = 0;
  let record = 0;
  const ledger = new AppendOnlyModelCallLedger({
    idFactory: () => `call_${++record}`,
    now: () => "2026-07-23T12:00:00.000Z"
  });
  const fixtureFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    const response = responses.shift();
    assert.ok(response, "fixture must provide a response for every request");
    if (response instanceof Error) throw response;
    return response;
  };
  const gateway = new ActiveModelGateway({
    snapshot: snapshot(capabilityOverrides),
    identity: {
      ownerId: "u1",
      teamId: "t1",
      jobId: "job_1"
    },
    capabilitySnapshotHash: "cap_hash",
    baseUrl: "https://api.moonshot.cn/v1",
    baseUrlFingerprint: "sha256:moonshot-base",
    credentialResolver: async (connectionId, credentialVersion) => {
      credentialResolutions.push({ connectionId, credentialVersion });
      return apiKey;
    },
    fetch: fixtureFetch,
    ledger,
    attemptIdFactory: () => `attempt_${++attempt}`,
    requestIdFactory: () => `request_${++request}`,
    now: () => 1_774_464_000_000,
    ...timeoutOptions
  });
  return {
    gateway,
    ledger,
    requests,
    credentialResolutions
  };
}

test("provider catalog contains exactly the nine approved official providers", () => {
  assert.deepEqual(
    MODEL_PROVIDER_CATALOG.map((provider) => provider.id),
    [
      "openai",
      "moonshot",
      "minimax",
      "zhipu",
      "deepseek",
      "qwen",
      "doubao",
      "hunyuan",
      "qianfan"
    ]
  );
  assert.equal(Object.isFrozen(MODEL_PROVIDER_CATALOG), true);
  for (const provider of MODEL_PROVIDER_CATALOG) {
    assert.equal(Object.isFrozen(provider), true);
    assert.equal(Object.isFrozen(provider.models), true);
  }
});

test("structured generation validates JSON and records only auditable hashes", async () => {
  const fixture = createFixture([completionResponse(rawOutput)]);
  const schema = z.object({
    plan: z.literal("qualified")
  }).strict();

  const result = await fixture.gateway.generateStructured({
    prompt: rawPrompt,
    schema
  });

  assert.deepEqual(result.value, { plan: "qualified" });
  assert.equal(result.repaired, false);
  assert.deepEqual(fixture.credentialResolutions, [{
    connectionId: "conn_moonshot",
    credentialVersion: 2
  }]);
  assert.equal(fixture.ledger.records.length, 1);
  const [record] = fixture.ledger.records;
  assert.deepEqual({
    ownerId: record.ownerId,
    teamId: record.teamId,
    jobId: record.jobId,
    attemptId: record.attemptId,
    connectionId: record.connectionId,
    credentialVersion: record.credentialVersion,
    capabilitySnapshotHash: record.capabilitySnapshotHash
  }, {
    ownerId: "u1",
    teamId: "t1",
    jobId: "job_1",
    attemptId: "attempt_1",
    connectionId: "conn_moonshot",
    credentialVersion: 2,
    capabilitySnapshotHash: "cap_hash"
  });
  assert.equal(record.provider, "moonshot");
  assert.equal(record.model, "moonshot-v1-8k");
  assert.equal(record.promptVersion, "lead-plan.v1");
  assert.equal(record.schemaVersion, "acquisition-plan.v1");
  assert.equal(record.providerRequestId, "provider_req_fixture");
  assert.deepEqual({
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    reasoningTokens: record.reasoningTokens
  }, {
    inputTokens: 11,
    outputTokens: 7,
    reasoningTokens: 2
  });
  assert.match(record.parameterHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(record.resultHash, /^sha256:[0-9a-f]{64}$/);
  const serializedLedger = JSON.stringify(fixture.ledger.records);
  assert.equal(serializedLedger.includes(rawPrompt), false);
  assert.equal(serializedLedger.includes(rawOutput), false);
  assert.equal(serializedLedger.includes(apiKey), false);
  assert.equal(Object.isFrozen(fixture.ledger.records), true);
  assert.equal(Object.isFrozen(record), true);
});

test("structured generation repairs invalid output once with the same snapshot and model", async () => {
  const fixture = createFixture([
    completionResponse("{\"plan\":7}"),
    completionResponse(rawOutput)
  ]);
  const result = await fixture.gateway.generateStructured({
    prompt: rawPrompt,
    schema: z.object({ plan: z.string() }).strict()
  });

  assert.deepEqual(result.value, { plan: "qualified" });
  assert.equal(result.repaired, true);
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.ledger.records.length, 2);
  assert.equal(
    fixture.ledger.records[0].providerRequestId,
    "provider_req_fixture"
  );
  assert.deepEqual({
    inputTokens: fixture.ledger.records[0].inputTokens,
    outputTokens: fixture.ledger.records[0].outputTokens,
    reasoningTokens: fixture.ledger.records[0].reasoningTokens
  }, {
    inputTokens: 11,
    outputTokens: 7,
    reasoningTokens: 2
  });
  assert.equal(
    fixture.ledger.records[0].resultHash,
    sha256("{\"plan\":7}")
  );
  assert.deepEqual(
    fixture.ledger.records.map((record) => [
      record.connectionId,
      record.credentialVersion,
      record.capabilitySnapshotHash,
      record.model
    ]),
    [
      ["conn_moonshot", 2, "cap_hash", "moonshot-v1-8k"],
      ["conn_moonshot", 2, "cap_hash", "moonshot-v1-8k"]
    ]
  );
  const bodies = fixture.requests.map((item) =>
    JSON.parse(String(item.init?.body)) as {
      model: string;
      messages: Array<{ content: string }>;
    }
  );
  assert.deepEqual(bodies.map((body) => body.model), [
    "moonshot-v1-8k",
    "moonshot-v1-8k"
  ]);
  assert.match(bodies[1].messages[0].content, /invalid_type/);
  assert.match(bodies[1].messages[0].content, /plan/);
});

test("structured generation stops after one repair with MODEL_SCHEMA_INVALID", async () => {
  const fixture = createFixture([
    completionResponse("{\"plan\":7}"),
    completionResponse("{\"plan\":false}")
  ]);

  await assert.rejects(
    fixture.gateway.generateStructured({
      prompt: rawPrompt,
      schema: z.object({ plan: z.string() }).strict()
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelGatewayError);
      assert.equal(error.code, "MODEL_SCHEMA_INVALID");
      assert.equal(error.retryable, false);
      return true;
    }
  );
  assert.equal(fixture.requests.length, 2);
  assert.equal(fixture.ledger.records.length, 2);
});

test("tool calls normalize arguments and unsupported tools fail before network", async () => {
  const supported = createFixture([
    completionResponse(null, {
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "tool_fixture_1",
            type: "function",
            function: {
              name: "save_campaign_draft",
              arguments: "{\"campaignId\":\"campaign_1\"}"
            }
          }]
        },
        finish_reason: "tool_calls"
      }]
    })
  ]);
  const result = await supported.gateway.callTools({
    prompt: "Save the approved draft",
    tools: [{
      name: "save_campaign_draft",
      description: "Save a campaign draft",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["campaignId"],
        properties: {
          campaignId: { type: "string" }
        }
      }
    }]
  });
  assert.deepEqual(result.toolCalls, [{
    id: "tool_fixture_1",
    name: "save_campaign_draft",
    arguments: { campaignId: "campaign_1" }
  }]);
  const toolRequest = JSON.parse(
    String(supported.requests[0].init?.body)
  ) as {
    tool_choice?: string;
    parallel_tool_calls?: boolean;
  };
  assert.equal(toolRequest.tool_choice, "required");
  assert.equal(toolRequest.parallel_tool_calls, false);

  const unsupported = createFixture([], { toolCalling: false });
  await assert.rejects(
    unsupported.gateway.callTools({
      prompt: "Must not leave the process",
      tools: []
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelGatewayError);
      assert.equal(error.code, "MODEL_CAPABILITY_UNSUPPORTED");
      assert.equal(error.retryable, false);
      return true;
    }
  );
  assert.equal(unsupported.requests.length, 0);
  assert.equal(unsupported.credentialResolutions.length, 0);
  assert.equal(unsupported.ledger.records.length, 1);
  assert.equal(
    unsupported.ledger.records[0].error?.code,
    "MODEL_CAPABILITY_UNSUPPORTED"
  );
});

test("parallel tool calling is serialized only after capability preflight", async () => {
  const unsupported = createFixture([], {
    parallelToolCalling: false
  });
  await assert.rejects(
    unsupported.gateway.callTools({
      prompt: "Run both tools",
      tools: [],
      parallelToolCalls: true
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelGatewayError);
      assert.equal(error.code, "MODEL_CAPABILITY_UNSUPPORTED");
      return true;
    }
  );
  assert.equal(unsupported.requests.length, 0);

  const supported = createFixture([
    completionResponse(null, {
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: []
        },
        finish_reason: "tool_calls"
      }]
    })
  ], {
    parallelToolCalling: true
  });
  await supported.gateway.callTools({
    prompt: "Run both tools",
    tools: [],
    parallelToolCalls: true
  });
  const request = JSON.parse(
    String(supported.requests[0].init?.body)
  ) as {
    tool_choice?: string;
    parallel_tool_calls?: boolean;
  };
  assert.equal(request.tool_choice, "required");
  assert.equal(request.parallel_tool_calls, true);
});

test("health check returns a normalized failure result and records the failed attempt", async () => {
  const fixture = createFixture([
    jsonResponse({ error: { message: "unavailable" } }, 503, {
      "x-request-id": "provider_health_failed"
    })
  ]);
  const health = await fixture.gateway.healthCheck();
  assert.equal(health.ok, false);
  assert.equal(health.provider, "moonshot");
  assert.equal(health.model, "moonshot-v1-8k");
  assert.equal(health.error?.code, "MODEL_PROVIDER_UNAVAILABLE");
  assert.equal(health.error?.retryable, true);
  assert.equal(fixture.ledger.records.length, 1);
  assert.equal(fixture.ledger.records[0].status, "failed");
});

test("429 is retryable and retry after an active switch stays on the job snapshot", async () => {
  const fixture = createFixture([
    jsonResponse({
      error: {
        message: "fixture rate limit",
        type: "rate_limit_error"
      }
    }, 429, {
      "retry-after": "3",
      "x-request-id": "provider_req_rate_limited"
    }),
    completionResponse(rawOutput)
  ]);
  const activeStore = {
    connectionId: "conn_moonshot",
    credentialVersion: 2
  };

  await assert.rejects(
    fixture.gateway.generateStructured({
      prompt: rawPrompt,
      schema: z.object({ plan: z.string() }).strict()
    }),
    (error: unknown) => {
      assert.ok(error instanceof ModelGatewayError);
      assert.equal(error.code, "MODEL_RATE_LIMITED");
      assert.equal(error.retryable, true);
      assert.equal(error.retryAfterMs, 3_000);
      return true;
    }
  );
  activeStore.connectionId = "conn_zhipu";
  activeStore.credentialVersion = 9;

  const retry = await fixture.gateway.generateStructured({
    prompt: rawPrompt,
    schema: z.object({ plan: z.string() }).strict()
  });
  assert.deepEqual(retry.value, { plan: "qualified" });
  assert.deepEqual(
    fixture.credentialResolutions,
    [
      { connectionId: "conn_moonshot", credentialVersion: 2 },
      { connectionId: "conn_moonshot", credentialVersion: 2 }
    ]
  );
  assert.deepEqual(
    fixture.ledger.records.map((record) => ({
      attemptId: record.attemptId,
      connectionId: record.connectionId,
      credentialVersion: record.credentialVersion,
      capabilitySnapshotHash: record.capabilitySnapshotHash,
      status: record.status,
      retryable: record.error?.retryable ?? null
    })),
    [
      {
        attemptId: "attempt_1",
        connectionId: "conn_moonshot",
        credentialVersion: 2,
        capabilitySnapshotHash: "cap_hash",
        status: "failed",
        retryable: true
      },
      {
        attemptId: "attempt_2",
        connectionId: "conn_moonshot",
        credentialVersion: 2,
        capabilitySnapshotHash: "cap_hash",
        status: "succeeded",
        retryable: null
      }
    ]
  );
});

test("provider failures normalize authentication, lookup, outage, and timeout retryability", async (context) => {
  const cases: Array<{
    name: string;
    response: Response | Error;
    code: string;
    retryable: boolean;
  }> = [
    {
      name: "authentication",
      response: jsonResponse({ error: { message: "unauthorized" } }, 401),
      code: "MODEL_AUTH_FAILED",
      retryable: false
    },
    {
      name: "model lookup",
      response: jsonResponse({ error: { message: "missing" } }, 404),
      code: "MODEL_NOT_FOUND",
      retryable: false
    },
    {
      name: "provider outage",
      response: jsonResponse({ error: { message: "unavailable" } }, 503),
      code: "MODEL_PROVIDER_UNAVAILABLE",
      retryable: true
    },
    {
      name: "timeout",
      response: new DOMException("fixture timeout", "TimeoutError"),
      code: "MODEL_TIMEOUT",
      retryable: true
    }
  ];
  for (const fixtureCase of cases) {
    await context.test(fixtureCase.name, async () => {
      const fixture = createFixture([fixtureCase.response]);
      await assert.rejects(
        fixture.gateway.generateStructured({
          prompt: rawPrompt,
          schema: z.object({ plan: z.string() }).strict()
        }),
        (error: unknown) => {
          assert.ok(error instanceof ModelGatewayError);
          assert.equal(error.code, fixtureCase.code);
          assert.equal(error.retryable, fixtureCase.retryable);
          return true;
        }
      );
      assert.equal(fixture.ledger.records.length, 1);
      assert.equal(
        fixture.ledger.records[0].error?.code,
        fixtureCase.code
      );
      assert.equal(
        fixture.ledger.records[0].error?.retryable,
        fixtureCase.retryable
      );
    });
  }
});

test("health, model listing, and streaming use normalized OpenAI-compatible responses", async () => {
  const fixture = createFixture([
    jsonResponse({
      object: "list",
      data: [{
        id: "moonshot-v1-8k",
        object: "model",
        created: 1_774_464_000,
        owned_by: "moonshot"
      }]
    }, 200, {
      "x-request-id": "provider_health"
    }),
    jsonResponse({
      object: "list",
      data: [{
        id: "moonshot-v1-8k",
        object: "model",
        created: 1_774_464_000,
        owned_by: "moonshot"
      }]
    }, 200, {
      "x-request-id": "provider_models"
    }),
    new Response([
      "data: {\"id\":\"chunk_1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}",
      "",
      "data: {\"id\":\"chunk_1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"},\"finish_reason\":null}]}",
      "",
      "data: {\"id\":\"chunk_1\",\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"completion_tokens_details\":{\"reasoning_tokens\":1}}}",
      "",
      "data: [DONE]",
      ""
    ].join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "provider_stream"
      }
    })
  ]);

  const health = await fixture.gateway.healthCheck();
  assert.equal(health.ok, true);
  assert.equal(health.provider, "moonshot");
  assert.equal(health.model, "moonshot-v1-8k");

  const models = await fixture.gateway.listModels();
  assert.equal(models.source, "official_api");
  assert.deepEqual(models.models.map((model) => model.id), [
    "moonshot-v1-8k"
  ]);

  const events = [];
  for await (const event of fixture.gateway.streamText({
    prompt: "Say hello"
  })) {
    events.push(event);
  }
  assert.deepEqual(events, [
    { type: "text_delta", delta: "hello" },
    { type: "text_delta", delta: " world" },
    { type: "done" }
  ]);
  assert.equal(fixture.ledger.records.length, 3);
  assert.deepEqual(
    fixture.ledger.records.map((record) => record.status),
    ["succeeded", "succeeded", "succeeded"]
  );
  assert.deepEqual({
    inputTokens: fixture.ledger.records[2].inputTokens,
    outputTokens: fixture.ledger.records[2].outputTokens,
    reasoningTokens: fixture.ledger.records[2].reasoningTokens,
    providerRequestId: fixture.ledger.records[2].providerRequestId
  }, {
    inputTokens: 5,
    outputTokens: 2,
    reasoningTokens: 1,
    providerRequestId: "provider_stream"
  });
  const streamBody = JSON.parse(
    String(fixture.requests[2].init?.body)
  ) as {
    stream_options?: { include_usage?: boolean };
  };
  assert.equal(streamBody.stream_options?.include_usage, true);
});

test("streaming yields an SSE delta before the response body closes", async () => {
  const encoder = new TextEncoder();
  let streamController:
    | ReadableStreamDefaultController<Uint8Array>
    | undefined;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      controller.enqueue(encoder.encode(
        "data: {\"id\":\"chunk_live\",\"choices\":[{\"index\":0,"
        + "\"delta\":{\"content\":\"first\"},\"finish_reason\":null}]}\n\n"
      ));
    }
  }), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "x-request-id": "provider_stream_live"
    }
  });
  const fixture = createFixture([response]);
  const iterator = fixture.gateway.streamText({
    prompt: "Stream incrementally"
  })[Symbol.asyncIterator]();
  const firstPromise = iterator.next();
  let firstSettled = false;
  void firstPromise.then(() => {
    firstSettled = true;
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  const settledBeforeClose = firstSettled;
  assert.ok(streamController);
  streamController.enqueue(encoder.encode("data: [DONE]\n\n"));
  streamController.close();
  const first = await firstPromise;

  assert.equal(settledBeforeClose, true);
  assert.deepEqual(first, {
    done: false,
    value: { type: "text_delta", delta: "first" }
  });
  assert.deepEqual(await iterator.next(), {
    done: false,
    value: { type: "done" }
  });
  assert.deepEqual(await iterator.next(), {
    done: true,
    value: undefined
  });
  assert.equal(fixture.ledger.records.length, 1);
});

test("stream idle timeout is per read and records failure after an earlier delta", async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n"
      ));
    }
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
  const fixture = createFixture(
    [response],
    {},
    { requestTimeoutMs: 1_000, streamIdleTimeoutMs: 15 }
  );
  const iterator = fixture.gateway.streamText({
    prompt: "Stream with idle protection"
  })[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), {
    done: false,
    value: { type: "text_delta", delta: "first" }
  });
  await assert.rejects(
    iterator.next(),
    (error: unknown) => {
      assert.ok(error instanceof ModelGatewayError);
      assert.equal(error.code, "MODEL_TIMEOUT");
      return true;
    }
  );
  assert.equal(fixture.ledger.records.length, 1);
  assert.equal(fixture.ledger.records[0].status, "failed");
  assert.equal(fixture.ledger.records[0].error?.code, "MODEL_TIMEOUT");
});

test("stream reader failure preserves usage already received in the failure ledger", async () => {
  const encoder = new TextEncoder();
  let readCount = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      readCount += 1;
      if (readCount === 1) {
        controller.enqueue(encoder.encode(
          "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":8,"
          + "\"completion_tokens\":3,\"completion_tokens_details\":"
          + "{\"reasoning_tokens\":2}}}\n\n"
        ));
        return;
      }
      controller.error(new Error("fixture reader failed"));
    }
  }, { highWaterMark: 0 }), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
  const fixture = createFixture([response]);
  await assert.rejects(async () => {
    for await (const _event of fixture.gateway.streamText({
      prompt: "Preserve usage"
    })) {
      // Consume until the transport fails.
    }
  });
  assert.equal(fixture.ledger.records.length, 1);
  assert.deepEqual({
    status: fixture.ledger.records[0].status,
    inputTokens: fixture.ledger.records[0].inputTokens,
    outputTokens: fixture.ledger.records[0].outputTokens,
    reasoningTokens: fixture.ledger.records[0].reasoningTokens
  }, {
    status: "failed",
    inputTokens: 8,
    outputTokens: 3,
    reasoningTokens: 2
  });
});

test("early stream consumer cancellation is never recorded as success", async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"
      ));
    }
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
  const fixture = createFixture([response]);
  const iterator = fixture.gateway.streamText({
    prompt: "Cancel after one delta"
  })[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return?.();
  assert.equal(fixture.ledger.records.length, 1);
  assert.equal(fixture.ledger.records[0].status, "failed");
  assert.equal(
    fixture.ledger.records[0].error?.code,
    "MODEL_STREAM_CANCELLED"
  );
});

test("caller abort after a delta is normalized and audited as a failed stream", async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"
      ));
    }
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
  const fixture = createFixture(
    [response],
    {},
    { streamIdleTimeoutMs: 5_000 }
  );
  const abort = new AbortController();
  const iterator = fixture.gateway.streamText({
    prompt: "Abort after one delta",
    signal: abort.signal
  })[Symbol.asyncIterator]();
  await iterator.next();
  abort.abort();
  await assert.rejects(iterator.next(), (error: unknown) => {
    assert.ok(error instanceof ModelGatewayError);
    assert.equal(error.code, "MODEL_STREAM_ABORTED");
    return true;
  });
  assert.equal(fixture.ledger.records[0].status, "failed");
  assert.equal(
    fixture.ledger.records[0].error?.code,
    "MODEL_STREAM_ABORTED"
  );
});
