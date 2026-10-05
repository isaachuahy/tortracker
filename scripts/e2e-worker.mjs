// Test infrastructure only: restart the actual Python process to exercise queue recovery.
import { spawn } from "node:child_process";
import http from "node:http";
let child;
function start() {
  child = spawn(
    process.env.WORKER_PYTHON || ".venv/bin/python",
    ["-m", "worker.main"],
    { stdio: "inherit", env: process.env },
  );
  child.once("error", () => {
    process.exitCode = 1;
  });
}
start();
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(child?.exitCode === null ? 200 : 503).end("worker");
    return;
  }
  if (req.url === "/restart" && req.method === "POST") {
    child.once("exit", () => {
      start();
      res.end("restarted");
    });
    child.kill("SIGKILL");
    return;
  }
  res.writeHead(404).end();
});
server.listen(4012, "127.0.0.1");
function stop() {
  server.close();
  child.once("exit", () => process.exit());
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 1500).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
