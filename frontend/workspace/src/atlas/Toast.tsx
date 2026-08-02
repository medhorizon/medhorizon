import { showToast, toaster, type ToastOptions } from "@synsci/ui/toast"

export type ToastKind = "info" | "success" | "warning" | "error"

type ToastInput = {
  title: string
  description?: string
  kind: ToastKind
  ttl_ms?: number
}

const DEFAULT_TTL_MS = 4500

/** Pure legacy→kit options mapper. Not re-exported from the workspace barrel. */
export function mapToastOptions(input: ToastInput): ToastOptions {
  const variant = (() => {
    if (input.kind === "success") return "success" as const
    if (input.kind === "error") return "error" as const
    return "default" as const
  })()
  const title =
    input.kind === "warning" && !input.title.startsWith("⚠") ? `⚠ ${input.title}` : input.title
  const ttl = input.ttl_ms ?? DEFAULT_TTL_MS
  if (ttl <= 0) {
    return {
      title,
      description: input.description,
      variant,
      persistent: true,
    }
  }
  return {
    title,
    description: input.description,
    variant,
    duration: ttl,
  }
}

export const toast = {
  push(input: ToastInput) {
    return showToast(mapToastOptions(input))
  },
  dismiss(id: number) {
    toaster.dismiss(id)
  },
  info(title: string, description?: string) {
    return toast.push({ kind: "info", title, description })
  },
  success(title: string, description?: string) {
    return toast.push({ kind: "success", title, description })
  },
  warning(title: string, description?: string) {
    return toast.push({ kind: "warning", title, description })
  },
  error(title: string, description?: string) {
    return toast.push({ kind: "error", title, description })
  },
}
