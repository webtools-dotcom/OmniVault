// Runs every check the project has, in order, and stops at the first failure.
// This is what `npm test` runs.

import { execSync } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";

const steps = [
  { name: "Format", command: "npm run format:check" },
  { name: "Lint (tsc, clippy)", command: "npm run lint" },
  { name: "Frontend build", command: "npm run build" },
  { name: "Rust tests", command: "cargo test", cwd: "src-tauri" },
  { name: "Frontend tests", command: "node --test test/frontend.test.mjs" },
  { name: "Production bundle smoke test", command: "node test/preview_check.mjs" },
  {
    name: "Release packaging (Windows + Android)",
    command:
      "node scripts/package_windows.mjs && node scripts/package_android.mjs && node scripts/check_signing_key.mjs",
  },
];

// On Windows the linker occasionally fails with LNK1104 while an antivirus
// scanner still holds a freshly written binary; a short retry clears it.
function run(command, cwd) {
  for (let attempt = 1; ; attempt++) {
    try {
      execSync(command, { cwd, stdio: "pipe", encoding: "utf-8" });
      return;
    } catch (err) {
      const output = `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}`;
      if (attempt < 3 && output.includes("LNK1104")) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
        continue;
      }
      throw err;
    }
  }
}

const started = performance.now();

for (const [index, step] of steps.entries()) {
  process.stdout.write(`[${index + 1}/${steps.length}] ${step.name}... `);
  const stepStarted = performance.now();
  try {
    run(step.command, path.resolve(process.cwd(), step.cwd ?? "."));
    console.log(`ok (${((performance.now() - stepStarted) / 1000).toFixed(1)}s)`);
  } catch (error) {
    console.log("FAILED\n");
    if (error.stdout) console.error(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());
    process.exit(1);
  }
}

console.log(`\nAll checks passed in ${((performance.now() - started) / 1000).toFixed(1)}s.`);
