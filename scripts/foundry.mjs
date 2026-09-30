// Native Foundry launcher: the upstream npm shim currently swallows exit status.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const [tool, ...args] = process.argv.slice(2);
if (!["forge", "anvil"].includes(tool)) {
  console.error("Usage: node scripts/foundry.mjs forge|anvil [arguments]");
  process.exit(2);
}
const arch = process.arch === "x64" ? "amd64" : process.arch;
const name = process.platform === "win32" ? `${tool}.exe` : tool;
let binary;
try {
  binary = require.resolve(
    `@foundry-rs/${tool}-${process.platform}-${arch}/bin/${name}`,
  );
} catch {
  const packageRoot = path.dirname(
    require.resolve(`@foundry-rs/${tool}/package.json`),
  );
  const candidate = path.resolve(packageRoot, "../dist", name);
  if (!existsSync(candidate))
    throw new Error(
      `Native ${tool} binary unavailable for ${process.platform}/${process.arch}`,
    );
  binary = candidate;
}
const child = spawn(binary, args, { stdio: "inherit", shell: false });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal)
    process.exitCode =
      signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
  else process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
