import { execSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import path from "node:path";

console.log("\n=======================================================");
console.log("   OmniVault Unified Verification Test Harness");
console.log("=======================================================\n");

const steps = [
  {
    name: "Frontend TypeScript & Vite Production Build",
    command: "npm run build",
  },
  {
    name: "Rust Core Compilation & Unit Test Suite (cargo test)",
    command: "cargo test --lib --test storage_integration_test --test sync_integration_test",
    cwd: "src-tauri",
  },
  {
    name: "Structural & Design Token Integrity Assertions",
    command: "node test/baseline_test.mjs",
  },
  {
    name: "Frontend Production Bundle Smoke Test",
    command: "node test/preview_check.mjs",
  },
  {
    name: "Windows Release Packaging & Multi-Platform Asset Integrity Check (Windows + Android)",
    command: "node scripts/package_windows.mjs && node scripts/package_android.mjs",
  },
];

let allPassed = true;
const startTime = performance.now();

for (const [index, step] of steps.entries()) {
  const stepNum = index + 1;
  process.stdout.write(`[${stepNum}/${steps.length}] Running: ${step.name}... `);
  const stepStart = performance.now();

  try {
    const execCwd = step.cwd ? path.resolve(process.cwd(), step.cwd) : process.cwd();
    let attempts = 0;
    while (attempts < 3) {
      try {
        execSync(step.command, { cwd: execCwd, stdio: "pipe", encoding: "utf-8" });
        break;
      } catch (err) {
        attempts++;
        const outStr = String(err.stdout || "") + String(err.stderr || "") + String(err.message || "");
        if (outStr.includes("LNK1104") && attempts < 3) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
          continue;
        }
        throw err;
      }
    }
    const stepDuration = ((performance.now() - stepStart) / 1000).toFixed(2);
    console.log(`✅ PASSED (${stepDuration}s)`);
  } catch (error) {
    console.log(`❌ FAILED`);
    console.error(`\nError in step: ${step.name}`);
    if (error.stdout) console.error(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());
    allPassed = false;
    process.exit(1);
  }
}

const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
console.log("\n-------------------------------------------------------");
console.log(`✅ All verification checks passed cleanly in ${totalDuration}s.`);
console.log("=======================================================\n");
