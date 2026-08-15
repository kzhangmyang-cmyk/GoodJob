import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

interface VisualReaderManifest {
  manifest_version: number;
  name: string;
  version: string;
  permissions: string[];
  host_permissions: string[];
  background?: { service_worker?: string; type?: string };
  action?: { default_popup?: string; default_title?: string };
  content_scripts?: Array<{ matches?: string[]; js?: string[]; run_at?: string }>;
  content_security_policy?: { extension_pages?: string };
  [key: string]: unknown;
}

const EXACT_PERMISSIONS = ["activeTab", "scripting", "storage", "offscreen"];
const EXACT_DOUYIN_HOSTS = ["https://www.douyin.com/*"];
const DEVELOPMENT_GOODJOB_ORIGIN = "http://127.0.0.1:5191";
const FORBIDDEN_PERMISSIONS = new Set([
  "cookies", "webRequest", "webRequestBlocking", "debugger", "proxy", "downloads", "<all_urls>"
]);

function normalizedOrigin(value: string, release: boolean): string {
  if (!value || /[*<>]/u.test(value)) throw new Error("GoodJob origin 格式无效");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("GoodJob origin 格式无效");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("GoodJob origin 必须是不含路径或凭据的精确 origin");
  }
  if (release && parsed.protocol !== "https:") {
    throw new Error("GoodJob origin 发布环境必须使用 HTTPS");
  }
  if (!release && parsed.protocol === "http:"
    && !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("GoodJob origin 的 HTTP 仅允许本机开发地址");
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("GoodJob origin 协议无效");
  return parsed.origin;
}

export async function renderVisualReaderManifest(options: {
  templateUrl: URL;
  originsLiteral?: string;
  release: boolean;
}): Promise<VisualReaderManifest> {
  if (options.release && !options.originsLiteral?.trim()) {
    throw new Error("发布构建必须显式配置 HTTPS GoodJob origin");
  }
  const requestedDevelopmentOrigin = options.originsLiteral?.trim();
  if (!options.release && requestedDevelopmentOrigin && requestedDevelopmentOrigin !== DEVELOPMENT_GOODJOB_ORIGIN) {
    throw new Error("开发构建只能使用固定 GoodJob local origin");
  }
  const literals = options.release
    ? options.originsLiteral!.split(",").map((value) => value.trim()).filter(Boolean)
    : [DEVELOPMENT_GOODJOB_ORIGIN];
  const origins = [...new Set(literals.map((value) => normalizedOrigin(value, options.release)))].sort();
  if (origins.length === 0 || origins.length > 8) throw new Error("GoodJob origin 数量无效");
  const manifest = JSON.parse(await readFile(options.templateUrl, "utf8")) as VisualReaderManifest;
  if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length !== 1) {
    throw new Error("视觉读取 manifest 模板无效");
  }
  manifest.content_scripts[0].matches = origins.map((origin) => `${origin}/*`);
  return manifest;
}

async function filesRecursively(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesRecursively(path));
    else output.push(path);
  }
  return output;
}

export async function auditVisualReaderBundle(distDir: string, options: {
  templateUrl: URL;
  originsLiteral?: string;
  release: boolean;
}): Promise<{
  files: number;
  forbiddenFindings: string[];
}> {
  const files = await filesRecursively(distDir);
  const findings: string[] = [];
  const manifestPath = join(distDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as VisualReaderManifest;
  const expectedManifest = await renderVisualReaderManifest(options);
  if (!isDeepStrictEqual(manifest, expectedManifest)) {
    findings.push("manifest 与当前模板和构建 origin 不精确一致");
  }
  if (JSON.stringify(manifest.permissions) !== JSON.stringify(EXACT_PERMISSIONS)) {
    findings.push("禁止权限或权限集合不精确");
  }
  const declaredPermissions = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions as string[] : [])
  ];
  if (declaredPermissions.some((permission) => FORBIDDEN_PERMISSIONS.has(permission))) {
    findings.push("禁止权限");
  }
  if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(EXACT_DOUYIN_HOSTS)) {
    findings.push("host_permissions 不精确");
  }
  const matches = manifest.content_scripts?.flatMap((script) => script.matches ?? []) ?? [];
  if (matches.length === 0 || matches.some((match) => match === "<all_urls>"
    || /^https:\/\/\*/u.test(match) || !/^https?:\/\/[^/*]+(?::[0-9]+)?\/\*$/u.test(match))) {
    findings.push("GoodJob content-script origin 不受控");
  }
  if (manifest.background?.service_worker !== "service-worker.js" || manifest.background.type !== "module") {
    findings.push("service worker 配置无效");
  }
  if (manifest.action?.default_popup !== "popup.html") findings.push("popup 配置无效");
  for (const path of files) {
    const name = basename(path);
    if (name.endsWith(".map")) findings.push(`source map:${name}`);
    if (!/\.(?:js|html|json|css)$/u.test(name)) continue;
    const content = await readFile(path, "utf8");
    if (/sourceMappingURL|\beval\s*\(|new\s+Function\s*\(/u.test(content)) {
      findings.push(`source map 或动态代码:${name}`);
    }
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/u.test(content)) {
      findings.push(`远程网络 endpoint:${name}`);
    }
    if (/<script[^>]+src=["']https?:\/\//iu.test(content)) findings.push(`远程脚本:${name}`);
    if (/linkedom/iu.test(content)) findings.push(`测试依赖泄漏:${name}`);
  }
  if (findings.length > 0) throw new Error(findings.join("; "));
  return { files: files.length, forbiddenFindings: [] };
}

async function main(): Promise<void> {
  const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const templateUrl = new URL("../browser-extension/douyin-visual-reader/manifest.template.json", import.meta.url);
  const distDir = resolve(
    projectRoot,
    process.env.VISUAL_READER_DIST_DIR ?? "dist-visual-reader/douyin-visual-reader"
  );
  const manifest = await renderVisualReaderManifest({
    templateUrl,
    originsLiteral: process.env.GOODJOB_APP_ORIGINS,
    release: process.env.VISUAL_READER_RELEASE === "1"
  });
  await writeFile(join(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
