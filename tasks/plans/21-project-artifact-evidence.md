# 21 — Project Artifact discovery、manifest、inspector 与 provenance

- **Status:** 📝 Planned
- **Priority:** P1
- **Dependencies:** Plan 19 classification contract；Plan 15 Atlas 退役边界；Explorer UI 接入依赖 Plan 16 core；backend/API 任务须通过 Plan 00
- **Coordination:** backend discovery/manifest 可在 Plan 16 之前实施；最终 UI 只作为独立 `project-artifacts` module 插入 Explorer，不扩大或替换 Plan 16 的 session artifact 事实源
- **Source:** OpenScience 2.0 的 `file/artifacts.ts`、`file/annotations.ts`、`ArtifactInspector.tsx` 与 artifact inspector E2E，对照 MedHorizon 已有 `RLMArtifacts` 和 local provenance store

## Current state

- Plan 16 已计划建立 Explorer core，并明确 v1 只浏览 host files 与 `RLMArtifacts` session artifacts；project files、RG artifacts、provenance 和 notebook artifact 不属于其事实源。
- MedHorizon 已有 `backend/cli/src/science/provenance/store.ts`、`tool/provenance.ts` 与 review append-only evidence，但缺少 project artifact discovery、hash manifest 和浏览器 inspector API。
- project file 可通过 Files 打开，Plan 19 将提供统一科学分类与 renderer capability；当前没有稳定的 project artifact ID、版本 hash、annotation anchor 或 missing/stale 语义。
- OpenScience 2.0 会扫描研究输出、计算 Git provenance、生成 deterministic manifest，并提供 inspector/review threads；其 Atlas RightPane/Artifacts UI 不能直接恢复到 MedHorizon。
- Plan 15 要求 Stage 与 Research Graph 保持唯一面向用户的研究阶段/图谱入口，Atlas Canvas/artifacts 和 managed cloud 默认关闭。

## Problem

用户可以看到单个 project file，却无法从项目范围发现重要研究产物、验证内容 hash、查看生成/版本证据或留下可恢复审阅线程。若直接复活旧 Atlas artifact panel，会违反 Plan 15；若把 project artifacts 合并进 `RLMArtifacts`，会混淆 session ownership、TTL、ID 和下载权限。需要一个独立 project provider：事实源始终是当前 project worktree + local provenance/annotation records，UI 只复用 Plan 16 的 Explorer 壳和一致 inspector 体验。

## Goals

1. 以 Plan 19 detector 和明确目录/排除规则发现 project research artifacts，扫描在 depth、count、time 与并发上 bounded。
2. 定义 project-scoped stable artifact ID 与独立 content version hash；路径不变时 ID 稳定，内容变化可检测，rename 产生可解释的新 identity。
3. 生成路径排序稳定、hash 可复现、不会整文件入内存的 manifest；完整与部分/失败结果不可混淆。
4. 为单个 artifact 提供 metadata、renderer capability、Git/local provenance、manifest membership 与 missing/stale 状态，并提供 versioned project reproducibility audit。
5. 提供 versioned、project-scoped annotation/review thread，绑定 artifact ID + content hash，内容变化后不把旧注释冒充 current。
6. 作为 Plan 16 Explorer core 的独立 `project-artifacts` module 接入，并提供上下文 inspector；不恢复 Atlas artifact UI/API。
7. 为 Plan 22 提供稳定 artifact/provenance refs，但不在本计划创建第二套图谱或 UI tab。

## Non-goals

- 不改变 Plan 16 的 session artifact catalog、7 天 TTL、session ownership、route 或 ID。
- 不把 project artifact 与 session artifact 合并为一个 backend list 或 storage table；可在 inspector 层共享 presentation primitive。
- 不恢复 Atlas Canvas、Atlas `ArtifactsPanel`、RightPane toggle、`createAtlasAPI` 或 `/api/atlas/*`。
- 不自动上传、同步、发布、删除、rename 或修改 project artifacts。
- 不扫描 `.git`、dependencies、build cache、app data、外部 symlink target 或整个磁盘。
- 不在 discovery 时自动写 Research Graph；Plan 22 负责显式、幂等投影。
- 不让 manifest 的 timestamp、扫描顺序或 OS path separator 影响 content digest。

## Identity and source boundaries

```text
host project file
  └─ project artifact id = project identity + normalized relative path
       ├─ version = sha256(current bytes)
       ├─ discovery metadata / manifest membership
       ├─ annotation threads bound to id + version
       └─ provenance refs (existing local DAG / Git)

session artifact
  └─ Plan 16 RLMArtifacts id + session ownership + TTL（保持独立）
```

- stable ID 不包含绝对路径，不直接等于 content hash；同路径内容更新保留 artifact identity 并产生新 version。
- rename 在 v1 视为 old artifact missing + new artifact；不得仅凭相同 hash 静默迁移 annotation。
- content hash 用 streaming SHA-256；manifest digest 基于排序后的 normalized relative path + type + size + content hash，排除 `generatedAt`。
- discovery 是 read-only，不能仅因 scan 就创建 provenance node 或 annotation。

## Implementation tasks

### Task 1：冻结 project artifact 分类、identity 与扫描基线

**Description:** 用真实临时 project 固定当前 Files、Plan 19 detector 和 local provenance 行为；定义 discovery include/exclude、normalized path、artifact ID/version、missing/stale 和 provider ownership contract。

**Acceptance:**

- [ ] detector、候选目录/扩展名与显式 include 规则有单一优先级；未知普通源码不会全部被误列为 artifact。
- [ ] `.git`、`node_modules`、vendor/cache、app internal data、hidden control files、symlink target 和 project 外路径明确排除。
- [ ] Windows/Unix separator、case policy、Unicode path 和 canonical project identity 对 stable ID 的影响有 table-driven tests。
- [ ] path 不变/内容变化保持 ID、更新 version；rename/missing/stale 语义冻结并被 Plan 22 引用。
- [ ] project artifact、session artifact、tool artifact、RG node 的 ownership/ID 不可互换；仅通过 typed ref 关联。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/file/project-artifacts.test.ts`
- [ ] `rg -n 'RLMArtifacts|session.*artifact' backend/cli/src/file frontend/workspace/src/features/explorer` 的预期依赖边界已记录
- [ ] 计划评审确认 identity、rename、missing/stale 与 exclude policy

**Dependencies:** Plan 19 Task 1；Plan 15

**Files:**

- `backend/cli/src/file/project-artifacts.ts`（新增 contract/scanner skeleton）
- `backend/cli/test/file/project-artifacts.test.ts`（新增）
- `tasks/plans/21-project-artifact-evidence.md`

**Scope:** S–M — contract、scanner characterization 与 focused tests

### Task 2：实现 bounded discovery 与 deterministic hash manifest

**Description:** 实现 project-scoped scanner、streaming SHA-256 与 deterministic manifest；限制 depth、entries、concurrent stat/hash、deadline 和 output，并以显式状态报告不可读/变化中的文件。

**Acceptance:**

- [ ] scan 遵守 exclude/ignore policy，不 follow symlink；每个 resolved target 再次通过 canonical containment。
- [ ] 结果排序稳定，limit/depth/deadline 到达时返回 typed incomplete reason，不能生成看似完整的 manifest digest。
- [ ] 相同 bytes/tree 在重复运行和 Windows/Unix path normalization 下产生相同 artifact entries 与 manifest digest；`generatedAt` 不参与 digest。
- [ ] hash 使用 stream，concurrency 有固定 cap；1 GiB fixture 不完整进入内存，取消/deadline 后 reader 释放。
- [ ] scan 中途文件变化使用 `changed_during_scan`/stale 状态，不把不一致 stat/hash 标记为 verified。
- [ ] manifest schema versioned，包含 algorithm、project ref、entries、completeness 与 errors，但不含绝对路径。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/file/project-artifacts.test.ts test/file/artifact-manifest.test.ts`
- [ ] 1 GiB sparse/stream fixture 记录 peak memory、hash concurrency 与 cancellation 证据
- [ ] `(cwd: backend/cli) bun run typecheck`

**Dependencies:** Task 1

**Files:**

- `backend/cli/src/file/project-artifacts.ts`
- `backend/cli/src/file/artifact-manifest.ts`（新增）
- `backend/cli/test/file/project-artifacts.test.ts`
- `backend/cli/test/file/artifact-manifest.test.ts`（新增）

**Scope:** M — 2 个 implementation files、2 个 focused tests

### Task 3：增加 artifact catalog/detail/manifest/audit/provenance API 与 SDK

**Description:** 在中立 file namespace 增加分页 artifact list、单项 detail、manifest download、project reproducibility audit 和现有 provenance/Git evidence projection；先固定 OpenAPI schema，再生成 SDK。读取 API 不因查看而写 provenance。

**Acceptance:**

- [ ] list 支持 bounded limit/cursor/kind/filter，排序与 cursor 稳定；detail 以 artifact ID 解析 canonical current path。
- [ ] public payload 只暴露 normalized relative path、stable ID、version、kind、size、mtime、capability 和 typed states，不暴露 absolute path。
- [ ] detail 合并现有 local provenance store 与 Git evidence 时使用稳定 ref/path/hash 匹配，并区分 `none/current/stale/missing`。
- [ ] manifest download 只有 `complete` 时标记 verified digest；incomplete report 明确不能用于完整性证明。
- [ ] audit schema/version 与 check IDs 稳定，至少覆盖 Git state、lockfile、environment spec、notebook structure、non-empty artifacts 与 project instructions；pass/warn/fail 附带可验证 evidence，不把缺失数据自动判为 pass。
- [ ] invalid/stale ID、deleted/renamed file、traversal 与项目切换有稳定 4xx/error code；不跨 project 泄漏。
- [ ] API 位于 `/file/*` 或既有 project namespace，不增加 `/api/atlas`、独立 artifact server 或第二套 graph route。
- [ ] SDK 由 generator 生成，frontend 不手写 transport DTO。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/server/project-artifacts.test.ts test/file/artifact-manifest.test.ts`
- [ ] `(cwd: backend/cli) bun run typecheck`
- [ ] `(cwd: repository root) ./tooling/repo/generate.ts`
- [ ] `(cwd: repository root) bun run typecheck`

**Dependencies:** Task 2；Plan 00 合并护栏

**Files:**

- `backend/cli/src/file/project-artifacts.ts`
- `backend/cli/src/file/index.ts`
- `backend/cli/src/server/routes/file.ts`
- `backend/cli/test/server/project-artifacts.test.ts`（新增）
- generated files under `tooling/sdk/js/src/v2/gen/`

**Scope:** M — 3 个 hand-edited implementation files、1 个 route test 与生成物

## Checkpoint A：事实源、identity 与完整性

- [ ] project/session/tool/RG 四种 identity 保持分离且有 typed ref。
- [ ] discovery/manifest 在 traversal、symlink、超限、文件变化、取消和跨平台排序下稳定。
- [ ] manifest digest 可复现，incomplete scan 不会伪装 verified。
- [ ] read-only list/detail 不写 local provenance/RG；public API 无 absolute path。
- [ ] focused backend tests、SDK generation 与 typecheck 通过。

### Task 4：实现 versioned project artifact annotations

**Description:** 新增 project-scoped annotation threads，支持 artifact/text/notebook/molecule/genome anchor、reply、edit、resolve/reopen 和 recoverable tombstone；每个 revision 绑定 artifact ID + content hash，并提供 typed API。

**Acceptance:**

- [ ] create 前验证 artifact current/existing，记录 stable ID、version hash、anchor、author、timestamps 与 version 1 revision。
- [ ] update 使用 optimistic version/precondition，冲突返回 409；每次 edit/reply/status/delete 追加 immutable revision。
- [ ] artifact bytes 改变后旧 thread 标为 stale，仍可查看历史但不能静默显示为 current；missing artifact 同理。
- [ ] text line、notebook cell、molecule selection、genome locus anchor 有长度/范围上限，不接受任意未验证对象。
- [ ] annotation storage 以 project identity 隔离；ID 不能跨 project 查询或修改，删除为 recoverable tombstone。
- [ ] route error/telemetry 不记录完整 annotation body、absolute path 或文件内容。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/file/artifact-annotations.test.ts test/server/project-artifacts.test.ts`
- [ ] `(cwd: backend/cli) bun run typecheck`
- [ ] `(cwd: repository root) ./tooling/repo/generate.ts`

**Dependencies:** Task 3、Checkpoint A

**Files:**

- `backend/cli/src/file/artifact-annotations.ts`（新增）
- `backend/cli/src/server/routes/file.ts`
- `backend/cli/test/file/artifact-annotations.test.ts`（新增）
- `backend/cli/test/server/project-artifacts.test.ts`
- generated files under `tooling/sdk/js/src/v2/gen/`

**Scope:** M — 2 个 implementation files、2 个 focused tests 与生成物

### Task 5：实现 Project Artifacts Explorer module 与上下文 Inspector

**Description:** 消费生成 SDK 构建独立 `project-artifacts` Explorer module，并提供 context inspector 的 Overview、Preview、Review、Provenance/History；只复用 Plan 16 shell/展示 primitives，不合并 backend provider。

**Acceptance:**

- [ ] Explorer 宿主注入 `files`、`session-artifacts`、`project-artifacts` 三个 module；默认仍为 files，core 不 import 任何 provider 实现。
- [ ] Project module list/filter/load-more/selection 只调用 project artifact SDK；Session module 仍只调用 Plan 16 session API。
- [ ] Inspector 显示 stable ID/version/kind/size/path、Plan 19 renderer preview、manifest/audit/provenance states 与 annotation threads。
- [ ] stale/missing/incomplete/scan error 与成功 empty 分开；旧 selection 不会在快速切换 artifact/project 后覆盖当前 inspector。
- [ ] narrow desktop inspector overlay/drawer 不压碎文档工作区，tablist/focus/escape/return focus 满足可访问性。
- [ ] 打开 source 使用现有 center document tab；不创建 Atlas RightPane、artifact canvas 或第二套 file viewer。

**Verification:**

- [ ] `(cwd: frontend/workspace) bun test src/features/explorer/project-artifacts.test.tsx src/artifacts/inspector.test.ts`
- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `rg -n 'createAtlasAPI|/api/atlas|OPENSCIENCE_ENABLE_ATLAS' frontend/workspace/src/features/explorer frontend/workspace/src/artifacts` 无新增命中
- [ ] `rg -n 'RLMArtifacts|session/.*/artifacts' frontend/workspace/src/features/explorer/modules/project-artifacts.tsx` 无命中

**Dependencies:** Task 4；Plan 16 ExplorerShell/contract；Plan 19 renderer registry

**Files:**

- `frontend/workspace/src/features/explorer/modules/project-artifacts.tsx`（新增）
- `frontend/workspace/src/features/explorer/ProjectArtifacts.tsx`（新增）
- `frontend/workspace/src/artifacts/ArtifactInspector.tsx`（新增）
- `frontend/workspace/src/artifacts/inspector.ts`（新增 view model）
- `frontend/workspace/src/pages/session.tsx`

**Scope:** M — 4 个新实现文件、1 个局部宿主接线

### Task 6：锁定 discover→inspect→annotate→manifest→provenance E2E

**Description:** 用真实 project tree、Git repo、local provenance records 和浏览器验证完整闭环，覆盖内容变化、rename/delete、incomplete scan、module 切换、manifest 重跑和零 Atlas 请求。

**Acceptance:**

- [ ] 真实 project output 被 discovery 找到，普通源码/cache/symlink external 不出现；list→inspect→source tab 可导航。
- [ ] create→reply→resolve→reopen→edit→tombstone annotation 均保留版本历史；修改 artifact 后 thread 明确 stale。
- [ ] 两次未改变 tree 的 manifest entries/digest 相同；修改一个文件只改变对应 version 和 digest；timestamp 不影响 digest。
- [ ] 增删 lockfile/environment spec、损坏 notebook 与空 artifact 会改变对应 audit check，且 Inspector 展示的 pass/warn/fail 与 API evidence 一致。
- [ ] rename/delete 后旧 artifact ref 显示 missing/stale，不静默迁移 annotation 或 provenance。
- [ ] Project/Session artifact module 快速切换不混 list/ID/preview/download，Files 默认状态保持。
- [ ] 测试捕获 `/api/atlas/*` 和外部网络为零；没有 Atlas UI、第二套 graph tab 或自动 RG mutation。

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/file/project-artifacts.test.ts test/file/artifact-manifest.test.ts test/file/artifact-annotations.test.ts test/server/project-artifacts.test.ts`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- e2e/project-artifacts.spec.ts e2e/file-science-routing.spec.ts e2e/session-artifacts.spec.ts`
- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `(cwd: repository root) bun run typecheck`

**Dependencies:** Task 5

**Files:**

- `frontend/workspace/e2e/project-artifacts.spec.ts`（新增）
- `frontend/workspace/e2e/project-artifacts/` fixtures/generator
- `backend/cli/test/server/project-artifacts.test.ts`
- `tasks/plans/21-project-artifact-evidence.md`（记录证据）

**Scope:** M — 1 个真实 E2E、fixtures、route test 与计划证据

## Checkpoint B

- [ ] Project Artifacts 是 Plan 16 Explorer core 的独立 provider；Session Artifacts contract/ownership 未改变。
- [ ] discovery、manifest、audit、inspector、annotations 与 provenance 使用同一 stable artifact ID + version contract。
- [ ] stale/missing/incomplete 状态在 backend 与 UI 一致，不静默丢证据或伪造 current/verified。
- [ ] source 打开复用 FileView/centerTabs，预览复用 Plan 19 renderer；没有第二套 viewer/graph/Atlas surface。
- [ ] focused backend/frontend tests、真实 E2E、SDK generation 与 typecheck 通过。

## Compatibility and rollback

- backend routes、metadata 与 annotation storage 均 additive；移除 Project module 后 Files 与 Plan 16 Session Artifacts 继续工作。
- scanner/discovery 是 read-only；回退不会删除/改写 project files。annotation tombstone/revisions 在 UI 回退后仍保留。
- manifest format versioned；旧 consumer 不应把未知新版本视为 verified。
- Plan 22 projection 只能消费 stable refs；回退 Plan 22 不影响本计划 inspector/provenance evidence。
- 若 Plan 16 尚未实现，Tasks 1–4 可完成，Task 5 保持阻塞而不复制 Explorer shell。

## Definition of done

- [ ] Tasks 1–6 与 Checkpoint A/B 全部完成并有可复跑证据。
- [ ] project artifact 可安全发现、检查、注释、生成可复现 manifest/reproducibility audit 并查看 provenance。
- [ ] project/session/tool/RG identity 与事实源不混合，stale/missing/incomplete 全链路可见。
- [ ] Plan 15 Atlas 退役 invariant 未改变，Explorer/FileView/Research Graph 保持唯一既有产品入口。
- [ ] Plan 22 所需 artifact/provenance identity contract 已冻结。
