import http from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGenerationPromptWithType,
  buildHiddenPayload,
  buildProblemHistoryEntry,
  buildProblemPayload,
  buildSolverExplanation,
  isProblemTooSimilar,
  normalizeGeneratedProblem,
  pickGenerationType,
  validateGeneratedProblem
} from "./src/problems.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_TIMEOUT_MS = 90000;
const CLAUDE_MAX_ATTEMPTS = 4;
const HISTORY_LIMIT = 40;
const HISTORY_PATH = path.join(__dirname, "data", "problem-history.json");
const SOLVER = {
  id: "claude",
  label: "Claude Code",
  description: "通过本地 claude CLI 非交互生成题目与答案"
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/problem") {
      const body = await readJsonBody(request);
      const mode = body.mode ?? "indefinite";
      const historyEntries = await readProblemHistory();
      const generated = await requestClaudeGenerationWithRetry(mode, historyEntries);
      await appendProblemHistory(generated.problem, historyEntries);

      return sendJson(response, 200, {
        config: {
          solver: SOLVER.id,
          solvers: [SOLVER],
          explanation: buildSolverExplanation()
        },
        problem: buildProblemPayload(generated.problem),
        hidden: buildHiddenPayload(
          generated.problem,
          generated.modelAnswer.prompt,
          generated.modelAnswer
        )
      });
    }

    if (request.method === "GET") {
      return serveStaticFile(url.pathname, response);
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Integral generator running at http://${HOST}:${PORT}`);
});

async function requestClaudeGenerationWithRetry(mode, historyEntries) {
  let lastError = "Claude Code 未返回可用题目。";
  const previousProblem = historyEntries.at(-1) ?? null;

  for (let attempt = 1; attempt <= CLAUDE_MAX_ATTEMPTS; attempt += 1) {
    const generationType = pickGenerationType(mode);
    const generationPrompt = buildGenerationPromptWithType(
      mode,
      generationType,
      previousProblem
    );
    const result = await requestClaudeGenerationOnce(
      generationPrompt,
      mode,
      attempt,
      previousProblem
    );

    if (result.ok) {
      return result;
    }

    lastError = result.error;
  }

  throw new Error(`Claude Code 连续 ${CLAUDE_MAX_ATTEMPTS} 次生成失败：${lastError}`);
}

function requestClaudeGenerationOnce(generationPrompt, mode, attempt, previousProblem) {
  const prompt =
    attempt === 1
      ? generationPrompt
      : `${generationPrompt}\n\n上一次输出未通过校验，或与历史题过于相似。请重新生成不同题目，并严格满足 JSON 与格式要求。`;

  return new Promise((resolve) => {
    const child = spawn(
      CLAUDE_BIN,
      [
        "-p",
        "--output-format",
        "text",
        "--effort",
        "low",
        "--permission-mode",
        "bypassPermissions",
        "--tools",
        ""
      ],
      {
        cwd: __dirname,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        ok: false,
        error: `第 ${attempt} 次请求超时（>${CLAUDE_TIMEOUT_MS / 1000} 秒）`
      });
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      finish({
        ok: false,
        error: `第 ${attempt} 次调用失败：${error.message}（CLAUDE_BIN=${CLAUDE_BIN}）`
      });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        finish({
          ok: false,
          error: `第 ${attempt} 次退出码 ${code}${stderr.trim() ? `：${stderr.trim()}` : ""}`
        });
        return;
      }

      finish(
        parseGeneratedProblem(
          stdout.trim(),
          stderr.trim(),
          mode,
          attempt,
          previousProblem,
          generationPrompt
        )
      );
    });

    child.stdin.write(prompt);
    child.stdin.end();

    function finish(result) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(result);
    }
  });
}

function parseGeneratedProblem(
  rawText,
  reasoning,
  mode,
  attempt,
  previousProblem,
  generationPrompt
) {
  try {
    const parsed = JSON.parse(extractJsonObject(rawText));
    const problem = normalizeGeneratedProblem(parsed, mode);
    validateGeneratedProblem(problem, mode);

    if (isProblemTooSimilar(problem, previousProblem)) {
      return {
        ok: false,
        error: `第 ${attempt} 次命题与上一题过于相似`
      };
    }

    return {
      ok: true,
      problem,
      modelAnswer: {
        ok: true,
        provider: SOLVER.label,
        attempt,
        content: `本次题目与答案由 Claude Code 第 ${attempt} 次请求生成。`,
        prompt: generationPrompt,
        reasoning: reasoning || undefined,
        generatedRaw: rawText
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: `第 ${attempt} 次解析失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }
}

async function readProblemHistory() {
  try {
    const raw = await readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function appendProblemHistory(problem, existingEntries) {
  const nextEntries = [
    ...existingEntries,
    buildProblemHistoryEntry(problem)
  ].slice(-HISTORY_LIMIT);

  await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(nextEntries, null, 2), "utf8");
}

function extractJsonObject(rawText) {
  const trimmed = rawText.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

async function serveStaticFile(requestPath, response) {
  const safePath = normalizePath(requestPath);
  const filePath = path.join(__dirname, safePath);
  let content;

  try {
    content = await readFile(filePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    throw error;
  }

  const extension = path.extname(filePath);
  const contentType = MIME_TYPES[extension] ?? "text/plain; charset=utf-8";

  response.writeHead(200, { "Content-Type": contentType });
  response.end(content);
}

function normalizePath(requestPath) {
  if (requestPath === "/") {
    return "index.html";
  }

  const decodedPath = decodeURIComponent(requestPath);
  const normalized = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");

  return normalized.startsWith(path.sep) ? normalized.slice(1) : normalized;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}
