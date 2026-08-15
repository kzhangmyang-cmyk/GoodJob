import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import {
  createVisualReaderViteConfig,
  type VisualReaderEntry
} from "../browser-extension/douyin-visual-reader/vite.config";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const extensionRoot = resolve(projectRoot, "browser-extension/douyin-visual-reader");
const distDir = resolve(projectRoot, "dist/douyin-visual-reader");
const entries: VisualReaderEntry[] = [
  "service-worker", "goodjob-bridge-content", "douyin-content", "popup"
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
for (const entry of entries) {
  await build({ ...createVisualReaderViteConfig(entry), configFile: false, logLevel: "warn" });
}
await copyFile(resolve(extensionRoot, "src/popup.html"), resolve(distDir, "popup.html"));
await copyFile(resolve(extensionRoot, "src/popup.css"), resolve(distDir, "popup.css"));
