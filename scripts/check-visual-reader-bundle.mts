import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditVisualReaderBundle } from "./build-visual-reader-manifest.mts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = resolve(
  projectRoot,
  process.env.VISUAL_READER_DIST_DIR ?? "dist-visual-reader/douyin-visual-reader"
);

await auditVisualReaderBundle(distDir);
