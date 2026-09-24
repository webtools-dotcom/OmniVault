import { spawn } from "node:child_process";
import assert from "node:assert";

console.log("Testing frontend production preview server...");

const previewProcess = spawn("npx", ["vite", "preview", "--port", "4173"], {
  shell: true,
  stdio: "pipe",
});

await new Promise((resolve) => setTimeout(resolve, 2000));

try {
  const response = await fetch("http://localhost:4173");
  assert.strictEqual(response.status, 200, "Preview server did not return 200 OK");
  const html = await response.text();
  assert.ok(html.includes("OmniVault"), "HTML does not contain OmniVault title");
  assert.ok(html.includes("/assets/index-"), "HTML does not include compiled bundle asset");
  console.log(
    `✅ Preview server verified! Status: ${response.status}, HTML length: ${html.length} bytes`,
  );
} finally {
  previewProcess.kill();
  // On windows child process might linger; make sure port is freed
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", previewProcess.pid.toString(), "/f", "/t"], { stdio: "ignore" });
  }
  process.exit(0);
}
