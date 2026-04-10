export function getProblemModes() {
  return ["definite", "indefinite"];
}

const GENERATION_TYPES = {
  indefinite: [
    {
      id: "u-sub-log-exp",
      label: "换元 / 对数指数型",
      constraint:
        "优先出换元积分主导的题，涉及 \\(\\ln x\\)、\\(e^x\\)、有理式或根式中的一类或两类组合。"
    },
    {
      id: "parts-trig",
      label: "分部 / 三角混合型",
      constraint:
        "优先出分部积分主导的题，可含三角函数、反三角函数、对数函数，但整体难度保持中等。"
    },
    {
      id: "rationalizing-radical",
      label: "有理化 / 根式代换型",
      constraint:
        "优先出含根式的题，适合有理化、配方、根式代换或欧拉代换，不要过度嵌套。"
    },
    {
      id: "trig-rational",
      label: "三角有理式型",
      constraint:
        "优先出三角恒等变形、万能代换、半角公式等技巧明显的三角有理式题。"
    }
  ],
  definite: [
    {
      id: "def-u-sub",
      label: "定积分换元型",
      constraint:
        "优先出定积分，主方法是换元，区间变换清晰，最终结果为显式初等常数或反三角值。"
    },
    {
      id: "def-symmetry-trig",
      label: "定积分对称 / 三角型",
      constraint:
        "优先出定积分，适合三角代换、对称化简、半角恒等式或面积解释。"
    },
    {
      id: "def-rational-exp",
      label: "定积分有理指数型",
      constraint:
        "优先出含指数函数与有理式组合的定积分，换元后落到 \\(\\arctan\\)、\\(\\ln\\) 或有理积分。"
    },
    {
      id: "def-radical",
      label: "定积分根式型",
      constraint:
        "优先出含根式的定积分，适合配方、三角代换或结构拆分，表达式自然不过怪。"
    }
  ]
};

export function getGenerationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "type",
      "title",
      "statement",
      "tags",
      "rationale",
      "finalAnswer",
      "traditionalMethod",
      "cleverMethod"
    ],
    properties: {
      type: {
        type: "string",
        enum: ["定积分", "不定积分"]
      },
      title: {
        type: "string",
        minLength: 4
      },
      statement: {
        type: "string",
        minLength: 8
      },
      tags: {
        type: "array",
        minItems: 2,
        maxItems: 6,
        items: {
          type: "string",
          minLength: 2
        }
      },
      rationale: {
        type: "string",
        minLength: 10
      },
      finalAnswer: {
        type: "string",
        minLength: 6
      },
      traditionalMethod: {
        type: "array",
        minItems: 5,
        maxItems: 14,
        items: {
          type: "string",
          minLength: 4
        }
      },
      cleverMethod: {
        type: "array",
        minItems: 3,
        maxItems: 12,
        items: {
          type: "string",
          minLength: 4
        }
      }
    }
  };
}

export function buildGenerationPrompt(mode) {
  return buildGenerationPromptWithType(
    mode,
    pickGenerationType(mode)
  );
}

export function buildGenerationPromptWithType(mode, generationType, lastProblem = null) {
  const typeLabel = mode === "definite" ? "定积分" : "不定积分";
  const answerSuffix =
    mode === "definite"
      ? "finalAnswer 不要出现积分常数 C。"
      : "finalAnswer 必须包含积分常数 C。";
  const historyBlock = lastProblem
    ? [
        "只需要避免与上一题过于相似：",
        `${lastProblem.type} | ${lastProblem.title} | ${lastProblem.signature}`
      ].join("\n")
    : "上一题为空，本次无需避让。";

  return [
    `请直接生成一道${typeLabel}题，并同时给出完整答案。`,
    "只输出一个 JSON 对象，不要 Markdown，不要解释。",
    "",
    `type 固定写成 ${typeLabel}。`,
    `本次题型模板：${generationType.label}。`,
    generationType.constraint,
    "题目要求：",
    "- 被积函数只能由初等函数组成。",
    "- 必须有显式初等解，禁止椭圆积分、贝塞尔函数等特殊函数。",
    "- 不要太简单，不能是一眼看穿的逆求导题。",
    "- 优先体现换元、分部积分、凑微分、有理化、三角恒等变形、根式代换、万能代换等技巧。",
    "- 难度控制在中等，不要让三个以上复杂因子直接相乘。",
    "- 尽量避免出现过深复合，例如 \\ln(\\arctan(\\cdot))、e^{\\sqrt{\\cdot}} 这类层层嵌套。",
    "- 题目应该像高数作业或考研题，而不是研究型怪题。",
    "",
    "JSON 字段必须有：type, title, statement, tags, rationale, finalAnswer, traditionalMethod, cleverMethod。",
    "- statement 和 finalAnswer 用 MathJax 友好的 LaTeX 字符串，尽量用 \\[ \\] 包裹主公式。",
    "- traditionalMethod 必须是字符串数组，每个元素是一条步骤，至少 5 条。",
    "- cleverMethod 必须是字符串数组，每个元素是一条步骤，至少 3 条。",
    "- traditionalMethod / cleverMethod 要写成板书推导，一步一步展开，不要省略中间变形。",
    "- 公式必须包在 `\\( ... \\)` 或 `\\[ ... \\]` 中，禁止输出裸露的 `\\frac` `\\tan` `\\int`。",
    "- 每个步骤允许多行：先写极短动作词，再把关键式子单独成行。",
    "- 关键换元、分部积分数据、拆分、整理结果都尽量单独写一行显示公式，即使用 `\\[ ... \\]`。",
    "- 风格参考：`令 \\(t=\\arctan x\\)` 换行 `\\[x=\\tan t,\\quad dx=\\sec^2 t\\,dt\\]`。",
    "- 风格参考：`代入` 换行 `\\[I=\\int e^t\\cos t\\,dt\\]`。",
    "- 风格参考：`取 \\(u=\\cos t\\), \\(dv=e^t dt\\)` 换行 `\\[du=-\\sin t\\,dt,\\quad v=e^t\\]`。",
    "- 中文只保留必要动作词，如“令”“取”“代入”“拆分”“整理”“代回”；不要写大段分析。",
    "- 不要把很多公式塞进同一行；宁可多分几步，也不要合并成拥挤长句。",
    `- ${answerSuffix}`,
    "- 不要数值近似。",
    "",
    historyBlock,
    "",
    "先确认你自己能完整手算，再输出 JSON。"
  ].join("\n");
}

export function buildSolverExplanation() {
  return "当前题目与答案均由 Claude Code 动态生成；若本次生成失败，服务端会自动重试。";
}

export function buildProblemPayload(problem) {
  return {
    id: problem.id,
    type: problem.type,
    title: problem.title,
    statement: problem.statement,
    tags: problem.tags,
    rationale: problem.rationale
  };
}

export function buildHiddenPayload(problem, modelPrompt, modelAnswer) {
  return {
    finalAnswer: problem.finalAnswer,
    traditionalMethod: problem.traditionalMethod,
    cleverMethod: problem.cleverMethod,
    modelPrompt,
    modelAnswer
  };
}

export function normalizeGeneratedProblem(rawProblem, mode) {
  const normalizeTags = (value) => {
    if (Array.isArray(value)) {
      return value.map((tag) => String(tag).trim()).filter(Boolean);
    }

    if (typeof value === "string") {
      return value
        .split(/[，,、]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
    }

    return [];
  };

  const normalizeSteps = (value) => {
    if (Array.isArray(value)) {
      return value.map((step) => String(step).trim()).filter(Boolean);
    }

    if (typeof value === "string") {
      return value
        .split(/\n+/)
        .map((step) => step.replace(/^\s*[\d.-]+\s*/, "").trim())
        .filter(Boolean);
    }

    return [];
  };

  const type = mode === "definite" ? "定积分" : "不定积分";

  return {
    id: `generated-${Date.now()}`,
    type,
    title: String(rawProblem.title).trim(),
    statement: String(rawProblem.statement).trim(),
    tags: normalizeTags(rawProblem.tags),
    rationale: String(rawProblem.rationale).trim(),
    finalAnswer: String(rawProblem.finalAnswer).trim(),
    traditionalMethod: normalizeSteps(rawProblem.traditionalMethod),
    cleverMethod: normalizeSteps(rawProblem.cleverMethod)
  };
}

export function validateGeneratedProblem(problem, mode) {
  const expectedType = mode === "definite" ? "定积分" : "不定积分";
  const stepList = [...problem.traditionalMethod, ...problem.cleverMethod];

  if (problem.type !== expectedType) {
    throw new Error(`Generated type mismatch: expected ${expectedType}, got ${problem.type}`);
  }

  if (!problem.statement.includes("\\int")) {
    throw new Error("Generated statement does not look like an integral.");
  }

  if (!problem.finalAnswer.includes("\\[")) {
    throw new Error("Generated final answer is missing display math delimiters.");
  }

  if (mode === "indefinite" && !problem.finalAnswer.includes("C")) {
    throw new Error("Indefinite integral answer is missing constant C.");
  }

  if (problem.tags.length < 2) {
    throw new Error("Generated problem has too few tags.");
  }

  if (problem.traditionalMethod.length < 5 || problem.cleverMethod.length < 3) {
    throw new Error("Generated solution steps are incomplete.");
  }

  for (const step of stepList) {
    if (step.includes("\\")) {
      const hasMathDelimiters =
        step.includes("\\(") ||
        step.includes("\\)") ||
        step.includes("\\[") ||
        step.includes("\\]");

      if (!hasMathDelimiters) {
        throw new Error("Generated step contains raw LaTeX without MathJax delimiters.");
      }
    }
  }
}

export function getGenerationTypes(mode) {
  return GENERATION_TYPES[mode] ?? [];
}

export function pickGenerationType(mode, rng = Math.random) {
  const types = getGenerationTypes(mode);

  if (types.length === 0) {
    throw new Error(`Unsupported mode for generation type: ${mode}`);
  }

  const index = Math.min(types.length - 1, Math.floor(rng() * types.length));
  return types[index];
}

export function buildProblemHistoryEntry(problem) {
  return {
    id: problem.id,
    type: problem.type,
    title: problem.title,
    signature: normalizeSignature(problem.statement),
    createdAt: new Date().toISOString()
  };
}

export function normalizeSignature(text) {
  return String(text)
    .toLowerCase()
    .replace(/\\/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isProblemTooSimilar(problem, previousProblem) {
  const title = normalizeSignature(problem.title);
  const signature = normalizeSignature(problem.statement);

  if (!previousProblem) {
    return false;
  }

  const previousTitle = normalizeSignature(previousProblem.title);
  const previousSignature = normalizeSignature(previousProblem.signature);
  const sameTitle = title && title === previousTitle;
  const sameSignature = signature && signature === previousSignature;
  const overlap = jaccardSimilarity(signature, previousSignature);

  return sameTitle || sameSignature || overlap >= 0.82;
}

function jaccardSimilarity(left, right) {
  const leftSet = new Set(left.split(" ").filter(Boolean));
  const rightSet = new Set(right.split(" ").filter(Boolean));

  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return intersection / union;
}
