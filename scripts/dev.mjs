import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync("frontend/node_modules/vite/bin/vite.js")) {
  console.error(
    "Install frontend dependencies first: npm ci --prefix frontend",
  );
  process.exit(1);
}
const processes = [
  spawn(
    process.execPath,
    [
      "--env-file-if-exists=.env",
      "--import",
      "tsx",
      "--watch",
      "src/server.ts",
    ],
    { stdio: "inherit" },
  ),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    cwd: "frontend",
    stdio: "inherit",
  }),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of processes) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of processes) {
  child.on("error", (error) => {
    console.error(error.message);
    close(1);
  });
  child.on("exit", (code) => close(code || 0));
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
