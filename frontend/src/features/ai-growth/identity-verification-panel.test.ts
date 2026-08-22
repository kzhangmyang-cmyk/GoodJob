import assert from "node:assert/strict";
import test from "node:test";

import {
  isExactDouyinProfileUrl,
  renderIdentityVerificationPanel,
  type IdentityVerificationPanelCallbacks,
  type IdentityVerificationPanelVm
} from "./components/identity-verification-panel.js";

const callbacks: IdentityVerificationPanelCallbacks = {
  onFetchProfile: () => undefined,
  onToggleEvidence: () => undefined,
  onConfirm: () => undefined,
  onRetryContinuation: () => undefined
};

function viewModel(
  overrides: Partial<IdentityVerificationPanelVm> = {}
): IdentityVerificationPanelVm {
  return {
    identityResolved: false,
    candidateVersion: 3,
    sourcePlatform: "douyin",
    originalSourceUrl: "https://www.douyin.com/video/123456",
    originalSourceType: "video",
    originalProvider: "baidu",
    originalExcerpt: "评论里正在寻找获客系统",
    profileUrl: "",
    rationale: "",
    selectedEvidenceIds: [],
    evidence: [],
    status: "needs_profile",
    message: null,
    error: null,
    ...overrides
  };
}

test("exact Douyin profile validation accepts public user pages only", () => {
  assert.equal(
    isExactDouyinProfileUrl("https://www.douyin.com/user/MS4wLjABAAAA"),
    true
  );
  assert.equal(
    isExactDouyinProfileUrl("https://douyin.com/user/MS4wLjABAAAA/"),
    true
  );
  assert.equal(
    isExactDouyinProfileUrl("https://www.douyin.com/video/123456"),
    false
  );
  assert.equal(isExactDouyinProfileUrl("https://v.douyin.com/abc"), false);
  assert.equal(
    isExactDouyinProfileUrl("https://evil.douyin.com/user/MS4wLjABAAAA"),
    false
  );
  assert.equal(
    isExactDouyinProfileUrl("https://www.douyin.com:8443/user/MS4wLjABAAAA"),
    false
  );
  assert.equal(
    isExactDouyinProfileUrl("https://www.douyin.com/user/MS4wLjABAAAA?share=1"),
    false
  );
  assert.equal(
    isExactDouyinProfileUrl("javascript:alert(1)"),
    false
  );
});

test("unresolved panel explains the evidence boundary and blocks premature confirmation", () => {
  const rendered = renderIdentityVerificationPanel(viewModel(), callbacks);

  assert.match(rendered.html, /主体核验/);
  assert.match(rendered.html, /搜索结果不是已核验的客户身份/);
  assert.match(rendered.html, /抖音视频页/);
  assert.match(rendered.html, /百度搜索/);
  assert.match(rendered.html, /data-field="identity-profile-url"/);
  assert.match(rendered.html, /仅接受.*\/user\//);
  assert.match(
    rendered.html,
    /data-action="confirm-candidate-identity"[^>]*disabled/
  );
});

test("read-only data shows the identity boundary without mutable controls", () => {
  const rendered = renderIdentityVerificationPanel(viewModel({
    readOnly: true
  }), callbacks);

  assert.match(rendered.html, /演示数据 · 只读/);
  assert.match(rendered.html, /不会抓取公开主页、保存主体确认或启动后续判断/);
  assert.doesNotMatch(rendered.html, /data-field="identity-profile-url"/);
  assert.doesNotMatch(rendered.html, /data-field="identity-evidence"/);
  assert.doesNotMatch(rendered.html, /data-action="fetch-identity-profile"/);
  assert.doesNotMatch(rendered.html, /data-action="confirm-candidate-identity"/);
});

test("eligible exact-profile evidence is selectable and enables human confirmation", () => {
  const rendered = renderIdentityVerificationPanel(viewModel({
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    rationale: "公开主页名称、内容主题与原始需求信号一致，已人工核对。",
    selectedEvidenceIds: ["evidence-profile"],
    status: "ready_to_confirm",
    evidence: [
      {
        id: "evidence-profile",
        title: "厦门装修获客公开主页",
        url: "https://www.douyin.com/user/MS4wLjABAAAA",
        sourcePlatform: "www.douyin.com",
        sourceType: "profile",
        excerpt: "公开主页简介",
        accessStatus: "public",
        fetchedAt: "2026-08-06T09:00:00.000Z",
        eligible: true,
        ineligibleReason: null
      }
    ]
  }), callbacks);

  assert.match(rendered.html, /厦门装修获客公开主页/);
  assert.match(rendered.html, /data-evidence-id="evidence-profile"/);
  assert.match(rendered.html, /checked/);
  assert.match(rendered.html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(
    rendered.html,
    /data-action="confirm-candidate-identity"(?![^>]*disabled)/
  );
  assert.match(rendered.html, /确认主体并继续/);
});

test("restricted or mismatched evidence stays disabled and unsafe values are escaped", () => {
  const rendered = renderIdentityVerificationPanel(viewModel({
    profileUrl: "https://www.douyin.com/user/expected",
    rationale: "已人工检查",
    status: "fetched_no_eligible",
    evidence: [
      {
        id: "restricted-evidence",
        title: "<img src=x onerror=alert(1)>",
        url: "javascript:alert(1)",
        sourcePlatform: "douyin",
        sourceType: "video",
        excerpt: "</p><script>alert(1)</script>",
        accessStatus: "access_restricted",
        fetchedAt: null,
        eligible: false,
        ineligibleReason: "访问受限，且不是精确公开主页"
      }
    ]
  }), callbacks);

  assert.doesNotMatch(rendered.html, /<img|<script|href="javascript:/);
  assert.match(rendered.html, /访问受限，且不是精确公开主页/);
  assert.match(
    rendered.html,
    /data-evidence-id="restricted-evidence"[^>]*disabled/
  );
  assert.match(
    rendered.html,
    /data-action="confirm-candidate-identity"[^>]*disabled/
  );
});

test("confirmation recomputes exact evidence eligibility instead of trusting its flag", () => {
  const rendered = renderIdentityVerificationPanel(viewModel({
    profileUrl: "https://www.douyin.com/user/expected",
    rationale: "已人工检查",
    selectedEvidenceIds: ["video-marked-eligible"],
    status: "ready_to_confirm",
    evidence: [{
      id: "video-marked-eligible",
      title: "错误标记为 eligible 的视频页",
      url: "https://www.douyin.com/video/123456",
      sourcePlatform: "douyin",
      sourceType: "video",
      excerpt: "视频摘要",
      accessStatus: "public_content",
      fetchedAt: "2026-08-06T09:00:00.000Z",
      eligible: true,
      ineligibleReason: null
    }]
  }), callbacks);

  assert.match(
    rendered.html,
    /data-evidence-id="video-marked-eligible"[^>]*disabled/
  );
  assert.match(
    rendered.html,
    /data-action="confirm-candidate-identity"[^>]*disabled/
  );
});

test("confirmed identity shows honest continuation progress without outreach actions", () => {
  const rendered = renderIdentityVerificationPanel(viewModel({
    identityResolved: true,
    profileUrl: "https://www.douyin.com/user/MS4wLjABAAAA",
    status: "qualifying",
    message: "主体已确认，正在重新计算意向与财务价值",
    error: null
  }), callbacks);

  assert.match(rendered.html, /主体已确认/);
  assert.match(rendered.html, /重新计算意向与财务价值/);
  assert.doesNotMatch(rendered.html, /data-field="identity-profile-url"/);
  assert.doesNotMatch(rendered.html, /自动私信|自动加好友|自动触达/);
});
