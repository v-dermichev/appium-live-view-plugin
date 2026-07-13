import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyPatches, resolveOutDir } from "./patches/apply.mjs";

// Allure 3 imports this config (running its top-level code) for every
// `allure generate`. We register a post-generation hook that re-applies the
// report patches — here, the one that makes appium-live-view HTML attachments
// interactive inline. It runs after the report is written, so it works the same
// for a local `allure generate` and for CI.
const here = dirname(fileURLToPath(import.meta.url));

process.on("exit", () => {
  applyPatches({ outDir: resolveOutDir("allure-report") });
});

// Path kept for reference; the patch itself needs only the output dir.
void here;

export default {
  name: "Allure Report",
  output: "allure-report",
  plugins: {
    awesome: {
      options: {
        // Flip to true for a single self-contained index.html. The inline
        // interactivity patch works for both served and single-file reports.
        singleFile: true,
      },
    },
  },
};
