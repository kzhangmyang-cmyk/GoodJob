import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite";

export type VisualReaderEntry = "service-worker" | "goodjob-bridge-content" | "douyin-content" | "popup";

const extensionRoot = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const visualReaderDistDir = resolve(
  projectRoot,
  process.env.VISUAL_READER_DIST_DIR ?? "dist-visual-reader/douyin-visual-reader"
);

export function createVisualReaderViteConfig(entry: VisualReaderEntry): UserConfig {
  const moduleEntry = entry === "service-worker";
  return {
    root: extensionRoot,
    publicDir: false,
    build: {
      outDir: visualReaderDistDir,
      emptyOutDir: false,
      sourcemap: false,
      minify: false,
      target: "es2022",
      lib: {
        entry: resolve(extensionRoot, `src/${entry}.ts`),
        name: moduleEntry ? undefined : `GoodJob${entry.replaceAll("-", "")}`,
        formats: [moduleEntry ? "es" : "iife"],
        fileName: () => `${entry}.js`
      },
      rollupOptions: {
        output: { inlineDynamicImports: true }
      }
    }
  };
}

export default defineConfig(createVisualReaderViteConfig(
  (process.env.VISUAL_READER_ENTRY as VisualReaderEntry | undefined) ?? "service-worker"
));
