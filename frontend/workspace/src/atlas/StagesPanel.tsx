import { createEffect, createMemo, For, Show, type JSX } from "solid-js"
import { useParams, useNavigate } from "@solidjs/router"
import { FONT_SANS, sectionTitle } from "@/styles/tokens"
import { useSync } from "@/context/sync"
import { useDialog } from "@synsci/ui/context/dialog"
import { confirmDialog } from "@/atlas/dialogs"
import { toast } from "@/atlas/Toast"
import { IconCheckCircle, IconClock, IconArrowRight } from "@/atlas/shared/Icon"
import { useLanguage } from "@/context/language"

/**
 * The stage graph for the current session: a vertical timeline of the phases the
 * agent marked with the `stage` tool, each one resumable. Jumping forks the session
 * at that boundary, so the earlier stages' history comes along and the original
 * branch stays intact.
 *
 * The five phases of a long task are a sequence, not a general DAG, so this renders
 * as a timeline rather than a node-and-edge canvas — same information, far denser.
 */
export function StagesPanel(): JSX.Element {
  const params = useParams()
  const navigate = useNavigate()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()

  const sessionID = createMemo(() => params.id as string | undefined)
  const stages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return sync.data.session_stages[id] ?? []
  })

  // Live updates arrive over SSE, but a session opened from history needs one fetch.
  createEffect(() => {
    const id = sessionID()
    if (id) sync.session.stages(id).catch(() => {})
  })

  const jump = async (partID: string, name: string, index: number) => {
    const id = sessionID()
    if (!id) return
    const ok = await confirmDialog(dialog, {
      title: language.t("atlas.stages.confirmTitle", { name }),
      message: language.t("atlas.stages.confirmMessage", { index: String(index) }),
      confirmLabel: language.t("atlas.stages.confirmLabel"),
    })
    if (!ok) return
    try {
      const result = await sync.session.stageJump(id, partID)
      toast.success(
        language.t("atlas.stages.toastSuccess", { name }),
        result.restored
          ? language.t("atlas.stages.toastRestored")
          : language.t("atlas.stages.toastNotRestored"),
      )
      navigate(`/${params.dir}/session/${result.session.id}`)
    } catch (e: any) {
      toast.error(language.t("atlas.stages.toastError"), e?.message ?? String(e))
    }
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", "min-height": 0 }}>
      <div style={{ padding: "12px 14px 8px", "flex-shrink": 0 }}>
        <div style={sectionTitle}>{language.t("atlas.tab.stages")}</div>
      </div>
      <Show
        when={stages().length > 0}
        fallback={
          <div
            style={{
              padding: "8px 14px",
              "font-family": FONT_SANS,
              "font-size": "12px",
              color: "var(--color-text-faint)",
              "line-height": 1.6,
            }}
          >
            {language.t("atlas.stages.empty")}
          </div>
        }
      >
        <div style={{ flex: 1, "min-height": 0, "overflow-y": "auto", padding: "0 14px 14px" }}>
          <For each={stages()}>
            {(stage, i) => (
              <div style={{ display: "flex", gap: "10px" }}>
                {/* rail: dot + connector */}
                <div
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    "flex-shrink": 0,
                    width: "16px",
                  }}
                >
                  <div
                    style={{
                      "margin-top": "3px",
                      color:
                        stage.status === "running" ? "var(--color-active, currentColor)" : "var(--color-text-faint)",
                    }}
                  >
                    <Show when={stage.status === "completed"} fallback={<IconClock size={13} strokeWidth={1.5} />}>
                      <IconCheckCircle size={13} strokeWidth={1.5} />
                    </Show>
                  </div>
                  <Show when={i() < stages().length - 1}>
                    <div style={{ flex: 1, width: "1px", background: "var(--color-border)", "min-height": "18px" }} />
                  </Show>
                </div>

                <div style={{ flex: 1, "padding-bottom": "14px", "min-width": 0 }}>
                  <div style={{ display: "flex", "align-items": "baseline", gap: "6px" }}>
                    <span
                      style={{
                        "font-family": FONT_SANS,
                        "font-size": "11px",
                        color: "var(--color-text-faint)",
                        "font-variant-numeric": "tabular-nums",
                      }}
                    >
                      {stage.index}
                    </span>
                    <span
                      style={{
                        "font-family": FONT_SANS,
                        "font-size": "13px",
                        color: "var(--color-text)",
                        "font-weight": stage.status === "running" ? 600 : 400,
                        "overflow-wrap": "anywhere",
                      }}
                    >
                      {stage.name}
                    </span>
                  </div>
                  <Show when={stage.summary}>
                    <div
                      style={{
                        "margin-top": "3px",
                        "font-family": FONT_SANS,
                        "font-size": "11px",
                        color: "var(--color-text-muted)",
                        "line-height": 1.5,
                        "overflow-wrap": "anywhere",
                      }}
                    >
                      {stage.summary}
                    </div>
                  </Show>
                  <Show when={stage.diff}>
                    <div
                      style={{
                        "margin-top": "4px",
                        "font-family": FONT_SANS,
                        "font-size": "10px",
                        color: "var(--color-text-faint)",
                        display: "flex",
                        gap: "8px",
                      }}
                    >
                      <span style={{ color: "var(--color-success, #22c55e)" }}>+{stage.diff!.additions}</span>
                      <span style={{ color: "var(--color-error, #ef4444)" }}>-{stage.diff!.deletions}</span>
                    </div>
                  </Show>
                  <button
                    onClick={() => jump(stage.partID, stage.name, stage.index)}
                    title={language.t("atlas.stages.restartTooltip")}
                    style={{
                      "margin-top": "6px",
                      display: "inline-flex",
                      "align-items": "center",
                      gap: "4px",
                      padding: "2px 6px",
                      "font-family": FONT_SANS,
                      "font-size": "11px",
                      color: "var(--color-text-muted)",
                      background: "transparent",
                      border: "1px solid var(--color-border)",
                      "border-radius": "4px",
                      cursor: "pointer",
                    }}
                  >
                    <IconArrowRight size={11} strokeWidth={1.5} />
                    {language.t("atlas.stages.restartButton")}
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
