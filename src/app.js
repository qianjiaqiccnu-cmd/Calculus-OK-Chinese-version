const modeForm = document.querySelector("#mode-form");
const generateButton = document.querySelector("#generate-button");
const revealButton = document.querySelector("#reveal-button");
const status = document.querySelector("#status");
const typeLabel = document.querySelector("#problem-type");
const title = document.querySelector("#problem-title");
const statement = document.querySelector("#problem-statement");
const rationale = document.querySelector("#problem-rationale");
const tags = document.querySelector("#problem-tags");
const answerPanel = document.querySelector("#answer-panel");
const finalAnswer = document.querySelector("#final-answer");
const traditionalMethod = document.querySelector("#traditional-method");
const cleverMethod = document.querySelector("#clever-method");
const modelPrompt = document.querySelector("#model-prompt");
const modelFeedback = document.querySelector("#model-feedback");

let hiddenPayload = null;

modeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  generateProblem();
});

revealButton.addEventListener("click", () => {
  if (!hiddenPayload) {
    return;
  }

  renderHiddenAnswer(hiddenPayload);
  answerPanel.hidden = false;
  revealButton.disabled = true;
  status.textContent = "答案已展开，包含手算过程与模型返回内容。";
  renderMath();
});

generateProblem();

async function generateProblem() {
  const mode = new FormData(modeForm).get("mode");
  setLoading(true);
  answerPanel.hidden = true;
  hiddenPayload = null;

  try {
    const response = await fetch("/api/problem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ mode })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "出题失败。");
    }

    hiddenPayload = data.hidden;
    renderProblem(data.problem, data.config);
    revealButton.disabled = false;
    status.textContent = "新题已生成，答案与模型解答已隐藏。";
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "生成题目时出现未知错误。";
    title.textContent = "暂时无法生成题目";
    statement.textContent = "";
    rationale.textContent = "";
    tags.innerHTML = "";
    revealButton.disabled = true;
  } finally {
    setLoading(false);
    renderMath();
  }
}

function renderProblem(problem, config) {
  typeLabel.textContent = problem.type;
  title.textContent = problem.title;
  statement.innerHTML = problem.statement;
  rationale.textContent = `${problem.rationale} ${config.explanation}`;
  tags.innerHTML = "";

  for (const tag of problem.tags) {
    const item = document.createElement("li");
    item.textContent = tag;
    tags.append(item);
  }
}

function renderHiddenAnswer(payload) {
  finalAnswer.innerHTML = payload.finalAnswer;
  renderList(traditionalMethod, payload.traditionalMethod);
  renderList(cleverMethod, payload.cleverMethod);
  modelPrompt.textContent = payload.modelPrompt;
  modelFeedback.textContent = buildModelFeedback(payload.modelAnswer);
}

function buildModelFeedback(modelAnswer) {
  const sections = [`[${modelAnswer.provider}]`, modelAnswer.content];

  if (modelAnswer.reasoning) {
    sections.push("--- 推理内容 ---", modelAnswer.reasoning);
  }

  if (modelAnswer.generatedRaw) {
    sections.push("--- 模型原始输出 ---", modelAnswer.generatedRaw);
  }

  return sections.join("\n\n");
}

function renderList(container, items) {
  container.innerHTML = "";

  for (const item of items) {
    const row = document.createElement("li");
    row.className = "solution-step";
    row.innerHTML = item;
    container.append(row);
  }
}

function setLoading(isLoading) {
  generateButton.disabled = isLoading;
  revealButton.disabled = isLoading || !hiddenPayload;
  generateButton.textContent = isLoading ? "正在命题..." : "换一道题";
  status.textContent = isLoading ? "正在挑选题目并请求模型手算..." : status.textContent;
}

function renderMath() {
  if (!window.MathJax?.typesetPromise) {
    return;
  }

  window.MathJax.typesetPromise();
}
