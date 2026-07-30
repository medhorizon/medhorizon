# 最小化研究图谱系统 — 实施计划（MedHorizon 模块化接入版）

> **原有技术路线保留**：Supabase + OpenAI API + Python（FastAPI）+ React（Vite）。
> **目标**：在 MedHorizon 上以可选模块提供 Atlas 风格的研究图谱管理、研究实验管理和 GEPA 实验优化循环。
> **硬约束**：不修改 `medhorizon` 仓库原有代码；本计划只新增独立模块、配置、Plugin、Skill 和 sidecar。

---

## 零、冷启动上下文（Cold Start Context）

> 新 session 进入时先读本节，再决定从哪一步继续。每完成一个阶段，更新“当前状态”和“进度日志”。

### 项目路径

```text
独立模块（Windows）：D:/claude work/research-graph/
独立模块（Unix/Mac）：~/research-graph/
MedHorizon 仓库：D:/claude work/medhorizon/

research-graph/
├── backend/                 # FastAPI 模块服务（独立进程）
├── frontend/                # React/Vite 模块界面（独立进程）
├── medhorizon-plugin/       # Plugin、Skills、Agents 和 bridge client
├── supabase/schema.sql      # 模块数据结构
├── .env                     # 仅模块服务读取，禁止提交
└── research-graph-plan.md   # 本执行文档
```

### 前置条件检查

```bash
python --version    # 需要 3.11+
node --version      # 需要 18+
git --version
git -C ../medhorizon status
pip --version
npm --version
```

外部账号：Supabase 项目、OpenAI API Key；如启用远端 Atlas，同步使用 MedHorizon 已有的 Atlas 登录状态。

### 当前状态

- **状态**：Phase 2 完成；正在执行 Phase 3
- **最后更新**：2026-07-30
- **已完成**：Phase 1–2
- **当前阶段**：Phase 3（图谱可视化）
- **下一步**：Markdown 导入导出、experiment link、filter/颜色验收


### 路径缩写

| 缩写 | 完整路径 |
|------|----------|
| `[ROOT]` | `research-graph/` |
| `[BACK]` | `research-graph/backend/` |
| `[FRONT]` | `research-graph/frontend/src/` |
| `[PLUGIN]` | `research-graph/medhorizon-plugin/` |
| `[SQL]` | `research-graph/supabase/schema.sql` |
| `[MED]` | `D:/claude work/medhorizon/` |

---

## 一、总体架构

原计划的 FastAPI、React、Supabase 和 OpenAI 分层不变；新增的 MedHorizon 接入层只作为适配器。

```text
┌──────────────────────────────────────────────────────────┐
│ MedHorizon（不修改源码）                                  │
│  Agent / Session / Stage / Atlas bridge                   │
│  Plugin + Skill 通过外部配置加载                           │
└───────────────┬───────────────────────────────┬──────────┘
                │ HTTP（Plugin/bridge）           │ 可选现有 Atlas bridge
                v                                 v
┌──────────────────────────┐        ┌────────────────────────┐
│ FastAPI 模块服务 :8000    │───────>│ Supabase PostgreSQL      │
│ 图谱 / 实验 / GEPA / RAG  │        │ Auth / DB / Storage / pgvector │
└──────────────┬───────────┘        └────────────────────────┘
               │ REST/SSE
               v
┌──────────────────────────┐
│ React/Vite 模块界面 :5173 │
│ 图谱、实验、GEPA、报告     │
└──────────────────────────┘
```

### 模块化接入原则

1. `research-graph` 是独立服务和独立前端，不把文件复制到 `[MED]/backend` 或 `[MED]/frontend`。
2. MedHorizon 只通过外部 Plugin、Skill、Agent 配置和 HTTP client 接入；不改 `processor`、`llm`、`server`、`registry`、`snapshot` 或现有 Atlas UI。
3. 运行时默认 `local`：模块服务访问自己的 Supabase；启用 Atlas 时通过 adapter 投影节点和 artifact，不复制 Atlas 认证实现。
4. 现有 MedHorizon `stage` 工具用于实验阶段时间线和人工 gate；研究图谱和实验历史由本模块持久化，二者不混为一谈。
5. 所有模块写操作带 `idempotency_key`、`session_id`、`message_id` 和 `reason`，便于重试和审计。

### 不修改的 MedHorizon 文件

```text
[MED]/backend/cli/src/session/processor.ts
[MED]/backend/cli/src/session/compaction.ts
[MED]/backend/cli/src/llm/llm.ts
[MED]/backend/cli/src/server/server.ts
[MED]/backend/cli/src/tool/registry.ts
[MED]/frontend/workspace/src/atlas/AtlasCanvas.tsx
[MED]/frontend/workspace/src/atlas/StagesPanel.tsx
```

需要在 MedHorizon 中显示时，第一版使用独立 UI URL 或 Plugin 打开外部页面；把它接入右侧 tab 属于后续、需要单独批准的变更。

---

## 二、数据库 Schema（Supabase PostgreSQL）

**文件路径**：`[SQL]`。执行方式仍为 Supabase SQL Editor；所有表启用 RLS，按 `user_id` 隔离。

### 2.1 原有核心表（保留）

原计划的 `graphs`、`nodes`、`edges`、`artifacts`、`chat_history` 表保持不变，继续支持：

- `nodes.kind`：`experiment`、`hypothesis`、`evidence`、`literature`、`note`；
- `nodes.lifecycle`：`staged`、`committed`、`archived`；
- `edges.relation`：`supports`、`contradicts`、`derives`、`references`、`parent`；
- `embedding vector(1536)`、图谱/节点/边索引和现有 RLS 策略。

### 2.2 研究实验扩展表（新增）

在原有 schema 后追加以下表；不删除或重命名旧列。

```sql
CREATE TABLE experiments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  graph_id            UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  hypothesis_node_id  UUID REFERENCES nodes(id) ON DELETE SET NULL,
  user_id             UUID NOT NULL REFERENCES auth.users(id),
  title               TEXT NOT NULL,
  objective           JSONB NOT NULL DEFAULT '{}',
  dataset_refs        JSONB NOT NULL DEFAULT '[]',
  code_ref            JSONB NOT NULL DEFAULT '{}',
  parameters          JSONB NOT NULL DEFAULT '{}',
  budget              JSONB NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','running','completed','failed','archived')),
  revision            INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE experiment_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id   UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  status          TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input_hash      TEXT NOT NULL,
  seed            BIGINT,
  provenance      JSONB NOT NULL DEFAULT '{}',
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  exit_code       INTEGER,
  error_code      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE run_metrics (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id          UUID NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  value           DOUBLE PRECISION NOT NULL,
  split           TEXT,
  unit            TEXT,
  evaluator       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gepa_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id   UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  objective       JSONB NOT NULL,
  budget          JSONB NOT NULL,
  seed            BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','generating','evaluating','awaiting_gate','selected','completed','stopped','failed')),
  current_candidate_id UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gepa_iterations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gepa_run_id     UUID NOT NULL REFERENCES gepa_runs(id) ON DELETE CASCADE,
  generation      INTEGER NOT NULL,
  rollout_run_ids UUID[] NOT NULL DEFAULT '{}',
  aggregate       JSONB NOT NULL DEFAULT '{}',
  critic_report   JSONB NOT NULL DEFAULT '{}',
  selected_id     UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (gepa_run_id, generation)
);

CREATE TABLE gepa_candidates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  iteration_id    UUID NOT NULL REFERENCES gepa_iterations(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES gepa_candidates(id),
  program         JSONB NOT NULL,
  program_hash    TEXT NOT NULL,
  scores          JSONB NOT NULL DEFAULT '{}',
  constraints     JSONB NOT NULL DEFAULT '{}',
  decision        TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','selected','rejected','invalid')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE provenance_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  graph_id        UUID REFERENCES graphs(id) ON DELETE CASCADE,
  session_id      TEXT,
  message_id      TEXT,
  actor           TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sync_outbox (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  operation       TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 2.3 约束与索引

- 扩展表全部开启 RLS；策略沿用 `auth.uid() = user_id`，并通过 graph/experiment 关系检查归属。
- `experiment_runs.input_hash`、`gepa_candidates.program_hash` 用于幂等和去重。
- 为 `experiments(graph_id,status)`、`experiment_runs(experiment_id,status)`、`gepa_iterations(gepa_run_id,generation)`、`provenance_events(session_id)` 建索引。
- 不保存 API Key、完整环境变量或未脱敏实验数据到 provenance。

---

## 三、后端 API（FastAPI）

原有图谱 CRUD、认证、AI 和 artifact endpoint 保留；新增能力均挂在独立 FastAPI 模块服务上。

### 3.1 原有 endpoint（保留）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET/POST/DELETE | `/api/graphs` | 图谱列表、创建、删除 |
| GET | `/api/graphs/{id}` | 图谱详情 |
| GET | `/api/graphs/{id}/tree` | 子图 |
| GET/POST/PATCH/DELETE | `/api/nodes`、`/api/nodes/{id}` | 节点 CRUD |
| POST/DELETE | `/api/edges`、`/api/edges/{id}` | 边 CRUD |
| POST | `/api/search/semantic` | 语义搜索 |
| POST | `/api/ai/summarize`、`suggest-links`、`chat`、`generate-hypothesis` | AI 辅助 |
| POST | `/api/artifacts/upload` | artifact 上传 |
| GET | `/api/graphs/{id}/export` | JSON 导出 |

### 3.2 实验 endpoint（新增）

```text
POST   /api/experiments
GET    /api/experiments?graph_id=...
GET    /api/experiments/{id}
PATCH  /api/experiments/{id}
POST   /api/experiments/{id}/approve
POST   /api/experiments/{id}/runs
GET    /api/runs/{id}
POST   /api/runs/{id}/metrics
POST   /api/runs/{id}/artifacts
POST   /api/runs/{id}/finish
POST   /api/runs/{id}/cancel
```

实验执行必须经过 `draft -> approved -> queued -> running -> succeeded/failed/cancelled`，服务端拒绝越级状态转换。

### 3.3 GEPA endpoint（新增）

```text
POST   /api/gepa/runs
GET    /api/gepa/runs/{id}
POST   /api/gepa/runs/{id}/iterations
GET    /api/gepa/runs/{id}/iterations/{generation}
POST   /api/gepa/runs/{id}/approve
POST   /api/gepa/runs/{id}/stop
POST   /api/gepa/runs/{id}/replay
```

GEPA 迭代必须记录 parent candidate、rollout run、evaluator 版本、primary/secondary metric、critic 报告、预算消耗和最终选择。

### 3.4 MedHorizon adapter

`[PLUGIN]/atlas_bridge.ts` 只做协议适配，不复制核心认证：

- local 模式直接调用本模块 `/api/*`；
- atlas/hybrid 模式调用现有 MedHorizon `/api/atlas/*` bridge，利用已有 Atlas 登录和 `thk_` 凭据；
- 远端不支持的 experiment/gepa 字段保存在本模块，仅投影兼容的节点摘要；
- 同步通过 `sync_outbox` 重试，禁止在前端或 agent prompt 中直接拼 Atlas API。

---

## 四、OpenAI 集成与 GEPA Pipeline

### 4.1 模型选择（原有策略保留）

| 用途 | 模型 |
|------|------|
| 摘要、格式化 | `gpt-4o-mini` |
| 关联发现、假设生成 | `gpt-4o` |
| RAG 问答 | `gpt-4o` |
| 文本向量化 | `text-embedding-3-small` |
| GEPA candidate/critic | 可配置，必须记录 provider/model 和成本 |

### 4.2 GEPA 循环

GEPA（Generalized Evolutionary Prompt Adaptation）优化的是 prompt/program/config，不直接修改模型权重。

1. **Design**：从 hypothesis 和 ExperimentSpec 固化目标、数据 split、baseline、evaluator、seed 和 budget。
2. **Generate**：生成 1..N 个 candidate，校验 schema、长度、工具权限和禁用指令。
3. **Evaluate**：在固定数据和环境上运行受限 rollout，生成结构化 `EvaluationRecord`。
4. **Critique**：分析失败样本并提出候选改进；critic 不能直接修改分数。
5. **Select**：按 primary metric、约束、secondary metric 和 tie-break 选择候选。
6. **Gate**：在应用下一代或产生真实成本前暂停等待用户确认。
7. **Record**：把 iteration、candidate、metrics、artifact、cost 和报告写回图谱。

停止条件：达到 `max_iterations`、`max_candidates`、token/time/cost budget，或连续 `patience` 轮无有效改进。

### 4.3 与 MedHorizon Stage 的映射

GEPA skill 调用现有 `stage` 工具，不修改 `StageTool`：

| 阶段 | gate | 结果 |
|------|------|------|
| Design | 是 | 假设、目标、预算审阅 |
| Baseline | 否 | 基线和 evaluator 固化 |
| Generate candidates | 否 | 候选及校验结果 |
| Evaluate | 否 | rollout、metrics、artifact |
| Critique | 否 | 失败样本和改进建议 |
| Select/apply | 是 | 用户批准后应用候选 |
| Report | 是 | 结果写入 graph 并导出 |

Stage jump 只重启会话分支；GEPA 旧 iteration 和 artifact 永远保留，不覆盖历史。

### 4.4 安全与预算

- runner 只允许当前 worktree/sandbox 内的参数数组命令，禁止 shell 字符串拼接。
- 默认 dry-run；真实运行需要 permission ask、experiment approve 和预算检查。
- 支持 timeout、取消、最大输出、并发上限和重试次数；每次重试写 provenance event。
- 日志和 artifact manifest 做 secret scan；不记录 API key、完整环境变量和敏感数据。

---

## 五、前端（React + Vite）

原有 Dashboard、GraphView、GraphCanvas、NodePanel、AIChat、Search 继续实现图谱管理；新增页面仍属于独立模块前端。

### 5.1 新增页面

```text
[FRONT]/pages/Experiments.tsx       # 实验规格和运行列表
[FRONT]/pages/ExperimentView.tsx    # 指标、artifact、provenance、日志
[FRONT]/pages/GepaRun.tsx           # candidate、iteration、gate、成本
[FRONT]/components/MetricTable.tsx
[FRONT]/components/ProvenancePanel.tsx
[FRONT]/components/GepaCandidateDiff.tsx
```

UI 必须区分 `pending`、`approved`、`running`、`succeeded`、`failed` 和 `partial sync`，不得把候选预览显示为已应用结果。

### 5.2 MedHorizon 中的使用方式

- 第一版通过 `medhorizon-atlas-plugin` 工具返回 UI URL，或由命令打开 `http://localhost:5173`。
- 可复用现有 MedHorizon AtlasCanvas 查看已同步的 Atlas graph，复用 StagesPanel 查看 GEPA stage timeline。
- 不修改 `frontend/workspace/src/atlas/*`；如未来要新增右侧 tab，单独建 RFC 和兼容性变更。

---

## 六、模块化接入目录

```text
[PLUGIN]/
├── plugin.ts                    # MedHorizon Plugin 入口，只调用模块 API
├── atlas_bridge.ts              # 现有 Atlas bridge 的 TypeScript adapter
├── tools/atlas_graph.ts         # graph 查询/写入
├── tools/atlas_experiment.ts    # spec/run/artifact
├── tools/atlas_gepa.ts          # start/iterate/approve/stop
├── skills/atlas-graph/SKILL.md
├── skills/atlas-experiment/SKILL.md
├── skills/atlas-gepa/SKILL.md
├── agents/experiment-critic.md  # 只读
├── agents/gepa-critic.md        # 只读
└── config/medhorizon.jsonc      # 外部 overlay，不放入 [MED]
```

### 6.1 加载方式

```powershell
$env:OPENSCIENCE_CONFIG_DIR = 'D:\claude work\research-graph\medhorizon-plugin\config'
$env:RESEARCH_GRAPH_API = 'http://127.0.0.1:8000'
$env:RESEARCH_GRAPH_MODE = 'local'       # local | atlas | hybrid
medhorizon web
```

`config/medhorizon.jsonc` 只声明外部 plugin、skills path、agent 和权限。MedHorizon 仓库保持原样；禁用模块时移除环境变量即可。

### 6.2 工具契约

| 工具 | 读操作 | 写操作 | 默认权限 |
|------|--------|--------|----------|
| `atlas_graph` | list/get/search/tree | create/update/edge/export | 读自动，写 ask |
| `atlas_experiment` | spec/run/metrics | approve/start/finish/artifact | 执行 ask |
| `atlas_gepa` | status/iteration/report | generate/apply/stop | 全部 ask |
| `atlas_sync` | capability/outbox | retry/commit | ask |

每个写操作必须传 `idempotency_key`、`reason`、`session_id` 和 `message_id`；sidecar 不可用时返回 `RESEARCH_GRAPH_UNAVAILABLE`，不得伪造成功。

---

## 七、实施阶段

### Phase 1：基础设施（1–2 天）

**目标文件**：`[SQL]`、`[BACK]/main.py`、`[BACK]/config.py`、`[ROOT]/.env`

- [x] 创建 Supabase 项目并执行原有 schema + 实验扩展表。
  - schema 已就绪：`research-graph/supabase/schema.sql`；本地用 SQLite `backend/migrate.py` 等价迁移。真实 Supabase 项目需操作者在控制台执行 SQL。
- [x] 初始化独立 FastAPI 服务和 `/health`；绑定 `127.0.0.1`，不暴露到公网。
  - `scripts/start-backend.sh` 拒绝非 loopback。
- [x] 完成 JWT/RLS、配置读取、CORS、迁移和 `idempotency_key` 基础设施。
- [x] 创建 Plugin/Skill overlay；验证 `medhorizon` 原仓库无 diff。

**验证边界**：`curl http://localhost:8000/health` 返回 200；`git -C "D:/claude work/medhorizon" diff --exit-code`。 ✅（相对 main 仅 `research-graph/` + 本计划文档）

### Phase 2：核心 CRUD（2–3 天）

**目标文件**：`[BACK]/routers/graphs.py`、`nodes.py`、`edges.py`、`models/schemas.py`

- [x] 保留并测试原有 graph/node/edge CRUD。
- [x] 增加图谱导出、归档、revision 冲突和幂等重试测试。
- [x] Plugin `atlas_graph` 可从 MedHorizon session 完成问题 -> 假设 -> 证据 -> 结论。
  - HTTP 链 `test_phase2` 覆盖；离线契约 `RESEARCH_GRAPH_UNAVAILABLE`。

**验证边界**：注册/登录/创建图谱/无 token 401；Plugin 离线时返回明确错误。 ✅

### Phase 3：图谱可视化（2–3 天）

**目标文件**：`[FRONT]/pages/Dashboard.tsx`、`GraphView.tsx`、`components/GraphCanvas.tsx`、`NodePanel.tsx`

- [ ] 完成原有图谱列表、React Flow 画布、节点编辑和 Markdown 导入/导出。
- [ ] 增加 graph filter、kind/lifecycle 颜色和节点详情中的 experiment link。
- [ ] 不向 `[MED]/frontend/workspace` 写入任何组件。

**验证边界**：`npm run build`；浏览器可创建、编辑、归档和导出图谱。

### Phase 4：AI 功能（3–4 天）

**目标文件**：`[BACK]/services/embedding.py`、`openai_service.py`、`routers/search.py`、`routers/ai.py`、`[FRONT]/components/AIChat.tsx`、`pages/Search.tsx`

- [ ] 保留摘要、语义搜索、RAG chat、关联建议和假设生成。
- [ ] Node 创建/更新后异步更新 embedding；embedding 失败不阻塞节点保存。
- [ ] AI 输出必须标注来源节点、模型、时间和 `provenance_event`。

**验证边界**：summarize/search/chat 通过；无 OpenAI Key 时返回可操作错误。

### Phase 5：文件、导入导出与部署（1–2 天）

**目标文件**：`[BACK]/routers/artifacts.py`、`[FRONT]/pages/*`、`[PLUGIN]/tools/*`

- [ ] 私有 Storage bucket、artifact manifest、节点 Markdown 导入和 graph JSON 导出。
- [ ] 增加 `atlas_sync` outbox 查看和重试，不阻塞本地保存。
- [ ] 独立服务部署到 Railway/Fly.io，独立前端部署到 Vercel；MedHorizon 仍按原方式部署。

**验证边界**：上传/下载/导出可用；断网后恢复同步且不产生重复节点。

### Phase 6：研究实验管理（3–5 天）

**目标文件**：`[BACK]/routers/experiments.py`、`runs.py`、`services/runner.py`、`[FRONT]/pages/Experiments.tsx`、`ExperimentView.tsx`

- [ ] ExperimentSpec 包含 objective、dataset/code/environment、parameters、baseline 和 budget。
- [ ] ExperimentRun 支持 approved、queued、running、succeeded、failed、cancelled；运行不可覆盖历史。
- [ ] runner 支持 dry-run、sandbox、timeout、取消、并发/输出上限和 artifact manifest。
- [ ] 每次运行记录 session/message、agent/model、git commit、数据 hash、seed、指标和成本。
- [ ] `/atlas-experiment` skill 先设计审阅，再执行和报告；执行前调用现有 permission ask。

**验证边界**：完成一次假设 -> 实验规格 -> baseline -> run -> result node；越界路径和 shell 注入被拒绝。

### Phase 7：GEPA 循环优化（4–7 天）

**目标文件**：`[BACK]/services/gepa.py`、`routers/gepa.py`、`[FRONT]/pages/GepaRun.tsx`、`[PLUGIN]/skills/atlas-gepa/SKILL.md`

- [ ] 实现 candidate、iteration、critic、selection、constraints、budget 和停止条件。
- [ ] 使用 deterministic evaluator 计算分数；critic 只能产生解释和建议。
- [ ] 每轮生成候选 -> rollout -> 评估 -> critic -> 选择，并写入不可变 provenance。
- [ ] Design、Select/apply、Report 使用已有 `stage(gate=true)`，不修改 StageTool 或 StagesPanel。
- [ ] 支持 replay、从 stage 分支重启、失败候选保留和成本报告。

**验证边界**：固定 seed/数据/evaluator 可以稳定复现至少两代选择；未批准候选不会应用；超预算自动停止。

### Checkpoint：完成交付

- [ ] 原有 Phase 1–5 图谱能力通过。
- [ ] 实验和 GEPA 端到端流程通过。
- [ ] `git -C "D:/claude work/medhorizon" diff --exit-code`；不修改仓库原先代码。
- [ ] local/atlas/hybrid 模式均有离线、401、402、5xx、partial sync 和恢复测试。

---

## 八、环境变量（`[ROOT]/.env`）

```env
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...       # 仅后端，勿提交
SUPABASE_JWT_SECRET=your-jwt-secret

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1

# Module
APP_ENV=development
BACKEND_PORT=8000
CORS_ORIGINS=http://localhost:5173
RESEARCH_GRAPH_MODE=local

# MedHorizon adapter（可选）
MEDHORIZON_SERVER_URL=http://127.0.0.1:4096
MEDHORIZON_ATLAS_BRIDGE=/api/atlas
OPENSCIENCE_CONFIG_DIR=D:/claude work/research-graph/medhorizon-plugin/config
```

`.env`、service role key、runtime token 和实验敏感数据加入 `.gitignore`。sidecar 仅监听 loopback，跨设备访问需另行配置认证代理。

---

## 九、成本估算（个人使用）

| 项目 | 免费额度 | 超出费用 |
|------|----------|----------|
| Supabase Free | 500MB DB、1GB Storage、50k MAU | Pro 计划按官方价格 |
| OpenAI Embedding | 按 token | 约 $0.02 / 百万 token |
| GPT-4o-mini | 按 token | 约 $0.15 / 百万输入 token |
| GPT-4o | 按 token | 约 $2.50 / 百万输入 token |
| GEPA rollout | 取决于候选数和 budget | 每次 run 在报告中显示 |

默认先使用 BYOK/local evaluator；managed Atlas 只有在用户批准并通过 budget 检查后执行。

---

## 十、与 Atlas / MedHorizon 功能对照

| Atlas/MedHorizon 能力 | 本模块对应 |
|----------------------|------------|
| `thk_*` 认证 | 复用 MedHorizon/Atlas 登录；独立模式使用 Supabase JWT |
| Graph list/tree/node/edge | `/api/graphs`、`/api/graphs/{id}/tree`、`/api/nodes`、`/api/edges` |
| `AtlasNode.kind/lifecycle` | `nodes.kind/lifecycle`，保留 staged/committed/archived |
| parent/child | `edges.relation='parent'` |
| ExperimentSpec/Run | `experiments`、`experiment_runs`、`run_metrics` |
| GEPA lineage | `gepa_runs`、`gepa_iterations`、`gepa_candidates` |
| session stage | 复用 MedHorizon `stage`/StagesPanel，不复制到 graph 表 |
| Atlas bridge | `[PLUGIN]/atlas_bridge.ts` 调用现有 `/api/atlas/*` |
| Atlas cloud storage | `sync_outbox` 异步投影；本地完整数据仍可导出 |

---

## 十一、快速启动命令

```bash
# 1. 独立模块
cd "D:/claude work/research-graph"
python -m venv backend/.venv
backend/.venv/Scripts/pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000

# 2. 独立前端（另一个终端）
cd frontend
npm install
npm run dev

# 3. 启用 MedHorizon 外部模块（另一个终端）
$env:OPENSCIENCE_CONFIG_DIR = 'D:\claude work\research-graph\medhorizon-plugin\config'
$env:RESEARCH_GRAPH_API = 'http://127.0.0.1:8000'
medhorizon web
```

停用模块只需取消 `OPENSCIENCE_CONFIG_DIR`/`RESEARCH_GRAPH_API`；不需要回滚或清理 MedHorizon 源码。

---

## 十二、进度日志（Progress Log）

> 每完成一个阶段，在此处追加一行并更新顶部“当前状态”。
> 格式：`- YYYY-MM-DD ✅ Phase X 描述 — 备注`

<!-- 进度记录从这里开始 -->

- 2026-07-30 ✅ Phase 2 核心 CRUD — 拆分 nodes/edges、archive/export、revision/idempotency、研究链测试；11 passed
- 2026-07-30 ✅ Phase 1 基础设施 — schema + migrate、loopback `/health`、JWT/idempotency、plugin overlay；`test_phase1` 通过
- 2026-07-30 ✅ Phase 1–7 模块骨架已落地 — 新增顶层 `research-graph/`（不改 MedHorizon 源码）；local SQLite + FastAPI CRUD/实验/GEPA；Vite UI；Plugin/Skills/Agents overlay；`pytest` 4 passed；`curl /health` 可用

<!-- 新记录追加在上方，保留此注释 -->
