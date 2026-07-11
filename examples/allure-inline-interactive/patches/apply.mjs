import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import makeLiveViewInteractable from "./make-live-view-interactable.mjs";

// Post-generation report patches. Each is (ctx) => void with ctx = { outDir }.
// Add more here if you have other report customizations.
export const patches = [makeLiveViewInteractable];

// Resolve the report output directory from the allure CLI args (`-o`/`--output`),
// falling back to the given default — works for both a local `allure generate`
// and CI (e.g. the Jenkins plugin), since both read the config that calls this.
export function resolveOutDir(fallback = "allure-report") {
  const argv = process.argv;
  const i = Math.max(argv.lastIndexOf("-o"), argv.lastIndexOf("--output"));
  const out = i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  return isAbsolute(out) ? out : resolve(process.cwd(), out);
}

export function applyPatches({ outDir }) {
  if (!existsSync(join(outDir, "index.html"))) {
    console.error(`[allure-patch] no index.html in ${outDir}; skipping patches`);
    return;
  }
  for (const patch of patches) {
    try {
      patch({ outDir });
      console.error(`[allure-patch] ${patch.name}: ok`);
    } catch (err) {
      console.error(`[allure-patch] ${patch.name}: FAILED — ${err.message}`);
    }
  }
}
