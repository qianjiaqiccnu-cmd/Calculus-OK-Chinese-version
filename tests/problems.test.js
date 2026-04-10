import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGenerationPromptWithType,
  buildProblemHistoryEntry,
  buildHiddenPayload,
  buildProblemPayload,
  getGenerationSchema,
  getGenerationTypes,
  getProblemModes,
  isProblemTooSimilar,
  normalizeGeneratedProblem,
  normalizeSignature,
  pickGenerationType,
  buildSolverExplanation,
  validateGeneratedProblem
} from "../src/problems.js";

test("problem modes still expose definite and indefinite selectors", () => {
  assert.deepEqual(getProblemModes(), ["definite", "indefinite"]);
});

test("generation prompt enforces dynamic model-based problem creation", () => {
  const prompt = buildGenerationPromptWithType(
    "indefinite",
    getGenerationTypes("indefinite")[0],
    { type: "不定积分", title: "旧题", signature: "int x dx" }
  );

  assert.match(prompt, /直接生成一道不定积分题/);
  assert.match(prompt, /本次题型模板/);
  assert.match(prompt, /只需要避免与上一题过于相似/);
  assert.match(prompt, /完整答案/);
  assert.match(prompt, /JSON/);
  assert.match(prompt, /积分常数 C/);
});

test("generation schema requires both problem and solution fields", () => {
  const schema = getGenerationSchema();

  assert.ok(schema.required.includes("statement"));
  assert.ok(schema.required.includes("finalAnswer"));
  assert.ok(schema.required.includes("traditionalMethod"));
  assert.ok(schema.required.includes("cleverMethod"));
});

test("normalize and validate accept a well-formed generated problem", () => {
  const normalized = normalizeGeneratedProblem(
    {
      title: "  动态命题  ",
      statement: "\\[\\int x e^x\\,dx\\]",
      tags: ["分部积分", " 指数函数 "],
      rationale: " 适合测试分部积分。 ",
      finalAnswer: "\\[(x-1)e^x+C\\]",
      traditionalMethod: [
        "令 \\(u=x\\), \\(dv=e^x dx\\)",
        "\\[du=dx,\\quad v=e^x\\]",
        "分部积分",
        "\\[I=xe^x-\\int e^x dx\\]",
        "\\[I=(x-1)e^x+C\\]"
      ],
      cleverMethod: [
        "设原函数为 \\((ax+b)e^x\\)",
        "\\[((ax+b)e^x)'=(ax+a+b)e^x\\]",
        "比较系数得 \\(a=1,\\ b=-1\\)"
      ]
    },
    "indefinite"
  );

  validateGeneratedProblem(normalized, "indefinite");

  assert.equal(normalized.type, "不定积分");
  assert.equal(normalized.title, "动态命题");
  assert.deepEqual(normalized.tags, ["分部积分", "指数函数"]);
});

test("payload builders keep answers hidden until reveal time", () => {
  const problem = normalizeGeneratedProblem(
    {
      type: "定积分",
      title: "测试题",
      statement: "\\[\\int_0^1 x\\,dx\\]",
      tags: ["定积分", "多项式"],
      rationale: "用于测试 payload。",
      finalAnswer: "\\[\\frac12\\]",
      traditionalMethod: [
        "拆步 1",
        "\\[I=\\int_0^1 x\\,dx\\]",
        "拆步 2",
        "\\[I=\\left.\\frac{x^2}{2}\\right|_0^1\\]",
        "\\[I=\\frac12\\]"
      ],
      cleverMethod: ["观察", "\\[I=\\frac12\\]", "结束"]
    },
    "definite"
  );
  const publicPayload = buildProblemPayload(problem);
  const hiddenPayload = buildHiddenPayload(problem, "prompt", {
    ok: true,
    content: "ok"
  });

  assert.equal(publicPayload.finalAnswer, undefined);
  assert.equal(hiddenPayload.finalAnswer, "\\[\\frac12\\]");
  assert.match(buildSolverExplanation(), /Claude Code/);
});

test("generation type picker and history similarity checks work", () => {
  const picked = pickGenerationType("definite", () => 0);
  assert.ok(picked.label);

  const problem = normalizeGeneratedProblem(
    {
      type: "不定积分",
      title: "三角型测试题",
      statement: "\\[\\int \\frac{dx}{\\sin x+\\cos x}\\]",
      tags: ["三角函数", "万能代换"],
      rationale: "测试去重。",
      finalAnswer: "\\[C+1\\]",
      traditionalMethod: ["步1", "步2", "步3", "步4", "步5"],
      cleverMethod: ["巧1", "巧2", "巧3"]
    },
    "indefinite"
  );
  const historyEntry = buildProblemHistoryEntry(problem);

  assert.ok(normalizeSignature(problem.statement).length > 0);
  assert.equal(isProblemTooSimilar(problem, historyEntry), true);
});
