# 12 — Research Graph GEPA 优化落地

Workstream: 把 Research Graph 中已落地的 GEPA **骨架**升级为可对接真实任务指标与（可选）LLM 候选/批判的优化循环，并明确其与「随口让 LLM 改 prompt」的边界。  
相关模块：`research-graph/`（不改 MedHorizon 核心源码）。  
上位计划：[research-graph-plan.md](research-graph-plan.md) §4 / Phase 7。

**TL;DR：** 今日 UI（Approve → Dry-run → Start GEPA → Generate/Gate）与表结构已齐，但评估器是本地确定性伪分，候选生成也非 LLM 反射。本计划把 **真实 evaluator、LLM propose/critique（可选）、objective 绑定假说、产物写回图谱** 做成可验收增量，使 GEPA 成为「带预算/种子/门控的 program 优化」，而不是演示循环。

---

## Current state

### 用户路径（已可用）

1. Experiments：创建 draft，默认 `objective: { "primary": "score" }`，`code_ref.argv` 常为 `["echo","ok"]`。
2. ExperimentView：**Approve**（`draft → approved`）→ **Dry-run**（`dry_run=true` 受限 runner）→ **Start GEPA**。
3. GepaRun：**Generate + evaluate generation** → `awaiting_gate` → **Approve selected (gate)**。

### 实现要点（代码现状）

| 能力 | 现状 | 关键位置 |
|------|------|----------|
| 实验门禁 | 未 approve 不能起 GEPA | `backend/services/gepa.py` `start_run` |
| Dry-run runner | argv-only、默认 dry-run、并发/输出上限 | `backend/services/runner.py` |
| 候选评估 | `local-deterministic-v1`：hash+长度伪分 | `gepa.evaluate_candidate` |
| Critic | 本地模板文案；**不改分数** | `gepa.iterate` |
| 选择 | 按 `scores.primary` 排序；patience / max_iterations 停 | 同上 |
| 人工门控 | `awaiting_gate` + `/approve` | `routers/gepa.py`、`GepaRun.tsx` |
| 插件 | `atlas_gepa` skill/tool、只读 `gepa-critic` agent | `medhorizon-plugin/` |
| OpenAI | RG 可继承 MedHorizon openai-compatible 配置 | `services/medhorizon_openai.py` 等 |

### 与「LLM 优化 prompt」的定位差

| | 常见 LLM 改 prompt | 本模块目标 GEPA |
|--|-------------------|-----------------|
| 对象 | 多半纯文本提示词 | `program`（prompt ± tools/config） |
| 打分 | LLM-as-judge 或临时感觉 | 显式 evaluator → `scores.primary` |
| 流程 | 对话试错 | Experiment 规格 + seed/budget + 迭代 + **gate** |
| 溯源 | 弱 | `program_hash`、iteration、provenance、可写回 graph |

Phase 7 验收过的是：**同 seed 可复现、未批准不应用、超预算停**——不是真实科学指标优化。

---

## What's broken / missing

1. **伪分无科学意义** — `primary` 不反映假说检验、benchmark 或真实 rollout。
2. **候选生成弱** — `_default_candidates` 本地拼装，未用 LLM / 未吃 critic 建议。
3. **Critic 未接模型** — `gepa-critic` agent / OpenAI 路径未驱动迭代改进。
4. **Objective 空洞** — `{primary:"score"}` 未绑定假说节点、数据集、metric 定义。
5. **Dry-run 与 GEPA 脱节** — Dry-run 不喂给 GEPA 作 baseline；GEPA 不调用实验 `code_ref` 做真实 evaluate。
6. **产物未闭环图谱** — 选中 program / 报告很少自动落成 graph 的 insight/result 节点。
7. **成本与模型未记账** — 计划要求记录 provider/model/cost；骨架未强制。
8. **易误解** — UI 展示的「高分」易被当成真实优化结果。

---

## Proposed change

分三档交付；默认从 A 开始，B/C 可配置打开。

### A. 真实评估器接口（必做）

- 抽象 `Evaluator`：`evaluate(program, experiment, seed) -> EvaluationRecord`  
  字段至少：`primary`、`secondary`、`evaluator`（版本名）、`constraints_ok`、可选 `artifacts`。
- 保留 `local-deterministic-v1` 作 CI/演示；新增至少一种：
  - **`argv-rollout-v1`**：对 `experiment.code_ref.argv` 注入 program（文件或 env），跑受限 runner，解析约定 stdout/JSON metrics；或
  - **`metric-file-v1`**：读固定路径/上一 run 的 metrics 表。
- Experiment Spec / UI：声明 `objective.primary` 对应的 metric 名；GEPA 排序只用该名。
- Dry-run 成功后可把 run 标为 **baseline**，GEPA 报告相对 baseline 的 Δprimary。

### B. LLM 候选生成 + 批判（可选，接 MedHorizon/OpenAI 配置）

- **Propose**：用已解析的 openai-compatible client，按 parent program + critic 建议 + 假说摘要生成 N 个 JSON `program`；schema 校验后入库。
- **Critique**：失败样本 / 低分候选 → 结构化建议；**禁止**直接改 `scores`（保持现有不变量）。
- 每次 LLM 调用写入 provenance：`provider`、`model`、token/cost 估计、`idempotency_key`。
- 无 Key / `openai:false` 时回退 A 的本地候选，UI 标明 `proposer=local`。

### C. 科研闭环与 UX（建议）

- Start GEPA 可带 `hypothesis_node_id`；报告与选中 program **Promote** 为 graph `insight`/`result`，edge `derives`/`supports`。
- UI 文案：伪分模式显示 **「demo evaluator」**；真实模式显示 evaluator 版本与 baseline Δ。
- `atlas-gepa` skill：要求先 Approve +（建议）Dry-run；写明与「聊天里改 prompt」的区别。
- 示例文档：用假说 H1（Wnt→ICI 耐药）走通「规格 → dry-run → 2 代 gate → 导出选中 prompt」的期望 JSON 形状。

### 非目标（本 workstream 不做）

- 不训练/不改模型权重。
- 不替换 MedHorizon StagesPanel 实现（仅 skill 映射 stage 名）。
- 不把 GEPA 做成无门控的全自动烧钱循环（默认保留 gate）。

---

## 示例：假说 H1 的期望最终产出形态

在接上真实/半真实 evaluator 后，一次完成的 GEPA 对用户可见的「最终 output」应接近：

```json
{
  "experiment": {
    "title": "H1 Wnt–ICI check",
    "status": "approved",
    "objective": { "primary": "auroc", "hypothesis_node_id": "…" }
  },
  "baseline_run": {
    "dry_run": false,
    "metrics": [{ "name": "auroc", "value": 0.62 }],
    "input_hash": "…"
  },
  "gepa_run": {
    "status": "completed",
    "evaluator": "argv-rollout-v1",
    "current_candidate_id": "cand_best",
    "aggregate_best_primary": 0.71,
    "delta_vs_baseline": 0.09
  },
  "selected_program": {
    "prompt": "…H1 相关、带输出 schema 的可执行 prompt/config…",
    "tools": []
  },
  "gate_history": [{ "generation": 2, "decision": "approve", "candidate_id": "cand_best" }]
}
```

演示模式下 `evaluator` 仍为 `local-deterministic-v1`，UI 必须标注 demo，避免误读为临床/benchmark 结果。

---

## Risks

| 风险 | 缓解 |
|------|------|
| 真实 rollout 命令注入 / 逃逸 | 继续 argv-only + worktree 限制；默认 dry-run；approve + budget |
| LLM propose 成本失控 | budget.max_candidates、max_iterations、patience；无 Key 回退本地 |
| Critic 污染分数 | 代码层禁止 critic 写 scores；测试锁定 |
| 用户误信伪分 | UI/API 强制 `evaluator` 字段 + demo 徽章 |
| 与 MedHorizon 配置耦合 | 仅 RG 读配置；`OPENAI_*` 仍可覆盖 |

---

## Acceptance criteria

1. **可插拔 evaluator**：CI 仍用 deterministic；至少一条集成测试用假 argv/metric 文件证明 `primary` 来自真实解析而非 hash 伪分。
2. **不变量**：同 seed + 同 evaluator 版本 → 至少两代选择可复现；critic 不能改变已写入 scores；未 gate approve 的候选不得标为 applied。
3. **预算**：触达 `max_iterations` / patience / cost 上限时 status∈{`stopped`,`completed`}，并保留完整 iteration 历史。
4. **可选 LLM 路径**：配置可用时 propose/critique 成功记账；不可用时自动回退且错误信息不误导为「已优化成功」。
5. **UX**：Experiment/GEPA 页能区分 demo vs real evaluator；Start GEPA 在 `draft` 时仍拒绝。
6. **文档**：本文件 + `research-graph/docs/USAGE.md` 增补「GEPA vs 聊天改 prompt」一小段；H1 示例与上节 JSON 形状一致。
7. **不改 MedHorizon 核心**：变更限于 `research-graph/`（及本 `docs/plans` 文档）。

---

## Implementation sketch（建议顺序）

1. `Evaluator` 协议 + 保留 deterministic + 新增 argv/metric 实现；测复现与排序。
2. Experiment/GEPA API：`objective.metric`、baseline_run_id、响应中暴露 `evaluator`。
3. UI：demo 徽章、baseline Δ、Promote 选中 program。
4. （可选）LLM propose/critique + provenance 成本字段。
5. 更新 `atlas-gepa` skill 与 USAGE；补 pytest。

**Key files：**  
`research-graph/backend/services/gepa.py`、`runner.py`、`routers/gepa.py`、`routers/experiments.py`  
`research-graph/frontend/src/pages/{ExperimentView,GepaRun}.tsx`  
`research-graph/medhorizon-plugin/{tools/atlas_gepa.ts,skills/atlas-gepa/SKILL.md}`  
`research-graph/docs/USAGE.md`、`docs/plans/research-graph-plan.md`（Phase 7 后续勾选）

---

## Status

📝 plan drafted — 待按 A→B→C 实施。
