import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProviderCatalogPageDto,
  ProviderConnectionDto
} from "./api.js";
import {
  renderProviderConnectionCenter,
  type ProviderConnectionCenterCallbacks
} from "./components/provider-connection-center.js";
import type { ProviderConnectionCenterState } from "./controller.js";

const noop = () => undefined;

const callbacks: ProviderConnectionCenterCallbacks = {
  onClose: noop,
  onSelectProvider: noop,
  onSelectConnection: noop,
  onSave: noop,
  onTest: noop,
  onEnable: noop,
  onDisable: noop,
  onDelete: noop,
  onContinue: noop
};

function provider(
  id: string,
  displayName: string,
  overrides: Partial<ProviderCatalogPageDto["items"][number]> = {}
): ProviderCatalogPageDto["items"][number] {
  return {
    id,
    kind: "search",
    displayName,
    officialDocsUrl: `https://docs.example.com/${id}`,
    requiresKey: true,
    keyHint: `填写 ${displayName} 的官方 API Key`,
    costNote: "按官方用量计费",
    capabilities: ["web_search"],
    ...overrides
  };
}

function connection(
  id: string,
  providerId: string,
  overrides: Partial<ProviderConnectionDto> = {}
): ProviderConnectionDto {
  return {
    id,
    ownerId: "user-1",
    teamId: null,
    providerId,
    kind: "search",
    status: "disabled",
    credentialVersion: 1,
    lastHealthAt: null,
    lastHealthStatus: "untested",
    lastErrorCode: null,
    lastHealthMessage: "尚未测试",
    usage: "search",
    createdAt: "2026-08-06T00:00:00.000Z",
    ...overrides
  };
}

function center(
  overrides: Partial<ProviderConnectionCenterState> = {}
): ProviderConnectionCenterState {
  return {
    open: true,
    status: "ready",
    providers: [],
    connections: [],
    selectedProviderId: null,
    selectedConnectionId: null,
    mutationStatus: "idle",
    health: null,
    message: null,
    error: null,
    ...overrides
  };
}

test("provider drawer renders the six returned search providers and correlates a saved connection", () => {
  const providers = [
    provider("baidu", "百度 AI 搜索"),
    provider("tencent", "腾讯联网搜索"),
    provider("tavily", "Tavily"),
    provider("serper", "Serper"),
    provider("brave", "Brave Search"),
    provider("serpapi", "SerpApi")
  ];
  const rendered = renderProviderConnectionCenter(center({
    providers,
    connections: [connection("connection-tavily", "tavily")]
  }), callbacks);

  for (const item of providers) {
    assert.match(rendered.html, new RegExp(item.displayName));
  }
  assert.match(rendered.html, /role="dialog"/);
  assert.match(rendered.html, /aria-modal="true"/);
  assert.match(rendered.html, /aria-labelledby="providerConnectionCenterTitle"/);
  assert.match(rendered.html, /data-provider-id="tavily"[\s\S]*已保存·待测试/);
});

test("provider drawer renders every honest connection status label", () => {
  const providers = [
    provider("missing", "未配置来源"),
    provider("untested", "待测试来源"),
    provider("passed-disabled", "待启用来源"),
    provider("active-passed", "可用来源"),
    provider("failed", "失败来源"),
    provider("inactive", "已禁用来源")
  ];
  const rendered = renderProviderConnectionCenter(center({
    providers,
    connections: [
      connection("connection-untested", "untested"),
      connection("connection-passed-disabled", "passed-disabled", {
        lastHealthStatus: "passed",
        lastHealthAt: "2026-08-06T01:00:00.000Z"
      }),
      connection("connection-active-passed", "active-passed", {
        status: "active",
        lastHealthStatus: "passed",
        lastHealthAt: "2026-08-06T01:00:00.000Z"
      }),
      connection("connection-failed", "failed", {
        status: "error",
        lastHealthStatus: "failed",
        lastErrorCode: "invalid_api_key",
        lastHealthMessage: "凭据无效"
      }),
      connection("connection-inactive", "inactive", {
        status: "inactive",
        lastHealthStatus: "passed",
        lastHealthAt: "2026-08-06T01:00:00.000Z"
      })
    ]
  }), callbacks);

  for (const label of [
    "未配置",
    "已保存·待测试",
    "测试通过·待启用",
    "已启用·可用于获客",
    "测试失败",
    "已禁用"
  ]) {
    assert.match(rendered.html, new RegExp(label));
  }
});

test("provider drawer escapes API text and rejects non-HTTPS documentation links", () => {
  const rendered = renderProviderConnectionCenter(center({
    providers: [
      provider("safe", `<img src=x onerror="alert(1)">`, {
        officialDocsUrl: "https://docs.example.com/search?q=official&lang=zh",
        capabilities: ["<script>unsafe()</script>"],
        costNote: `</p><script>alert("cost")</script>`
      }),
      provider("javascript", "危险链接", {
        officialDocsUrl: "javascript:alert(1)"
      }),
      provider("http", "非 HTTPS 链接", {
        officialDocsUrl: "http://docs.example.com/insecure"
      })
    ]
  }), callbacks);

  assert.doesNotMatch(rendered.html, /<img|<script|javascript:|http:\/\/docs/);
  assert.match(rendered.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(rendered.html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.match(rendered.html, /href="https:\/\/docs\.example\.com\/search\?q=official&amp;lang=zh"/);
  assert.match(rendered.html, /target="_blank" rel="noreferrer noopener"/);
});

test("provider drawer password field never serializes a secret or value attribute", () => {
  const fixtureSecret = "fixture-api-key-never-render";
  const rendered = renderProviderConnectionCenter(center({
    providers: [provider("baidu", "百度 AI 搜索", {
      keyHint: fixtureSecret
    })],
    selectedProviderId: "baidu"
  }), callbacks);

  assert.match(rendered.html, /<input[^>]*type="password"[^>]*data-field="provider-api-key"/);
  assert.doesNotMatch(rendered.html, /<input[^>]*\svalue=/);
  assert.doesNotMatch(rendered.html, new RegExp(fixtureSecret));
});

test("provider drawer gates enable and continue on passed connection health", () => {
  const selected = provider("baidu", "百度 AI 搜索");
  const failed = renderProviderConnectionCenter(center({
    providers: [selected],
    connections: [connection("connection-baidu", "baidu", {
      status: "error",
      lastHealthStatus: "failed",
      lastHealthMessage: "凭据无效"
    })],
    selectedProviderId: "baidu",
    selectedConnectionId: "connection-baidu"
  }), callbacks).html;
  assert.match(failed, /data-action="test-provider-connection"/);
  assert.match(failed, /data-action="rotate-provider-connection"/);
  assert.match(failed, /data-action="delete-provider-connection"/);
  assert.doesNotMatch(failed, /data-action="enable-provider-connection"/);
  assert.match(
    failed,
    /data-action="continue-after-connection"[^>]*disabled/
  );

  const passedDisabled = renderProviderConnectionCenter(center({
    providers: [selected],
    connections: [connection("connection-baidu", "baidu", {
      lastHealthStatus: "passed"
    })],
    selectedProviderId: "baidu",
    selectedConnectionId: "connection-baidu"
  }), callbacks).html;
  assert.match(passedDisabled, /data-action="enable-provider-connection"/);
  assert.match(
    passedDisabled,
    /data-action="continue-after-connection"[^>]*disabled/
  );

  const active = renderProviderConnectionCenter(center({
    providers: [selected],
    connections: [connection("connection-baidu", "baidu", {
      status: "active",
      lastHealthStatus: "passed"
    })],
    selectedProviderId: "baidu",
    selectedConnectionId: "connection-baidu"
  }), callbacks).html;
  assert.match(active, /data-action="disable-provider-connection"/);
  assert.match(active, /data-action="continue-after-connection"(?![^>]*disabled)/);
});

test("provider drawer disables a pending save and names its progress", () => {
  const rendered = renderProviderConnectionCenter(center({
    providers: [provider("baidu", "百度 AI 搜索")],
    selectedProviderId: "baidu",
    mutationStatus: "saving"
  }), callbacks).html;

  assert.match(
    rendered,
    /data-action="save-provider-connection"[^>]*disabled[^>]*>正在保存…/
  );
});
