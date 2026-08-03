import { afterEach, describe, expect, test } from "vitest"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { AsyncState, type AsyncStateProps } from "./async-state"

let host: HTMLDivElement | null = null
let dispose: (() => void) | null = null

function mount(props: () => AsyncStateProps): HTMLDivElement {
  host = document.createElement("div")
  document.body.appendChild(host)
  dispose = render(() => <AsyncState {...props()} />, host)
  return host
}

afterEach(() => {
  dispose?.()
  dispose = null
  host?.remove()
  host = null
})

describe("AsyncState", () => {
  test("loading renders a polite status region with the label and message", () => {
    const root = mount(() => ({ state: "loading", label: "Files", message: "Loading files..." }))

    const status = root.querySelector<HTMLElement>('[role="status"]')
    expect(status).not.toBeNull()
    expect(status!.getAttribute("aria-label")).toBe("Files")
    expect(status!.textContent).toContain("Loading files...")
  })

  test("loading stays quiet across re-renders while the state does not change", () => {
    const [props, setProps] = createSignal<AsyncStateProps>({
      state: "loading",
      label: "Files",
      message: "Loading...",
    })
    const root = mount(() => props())

    setProps({ state: "loading", label: "Files", message: "Loading..." })

    const statuses = root.querySelectorAll('[role="status"]')
    expect(statuses.length).toBe(1)
    expect(statuses[0].textContent).toBe("Loading...")
  })

  test("refreshing keeps children mounted, marks content busy, hides the indicator, and adds no live region", () => {
    const root = mount(() => ({
      state: "refreshing",
      label: "Files",
      children: <div data-testid="list">file-a</div>,
      message: "Updating...",
    }))

    const content = root.querySelector('[data-slot="async-state-content"]')
    expect(content).not.toBeNull()
    expect(content!.getAttribute("aria-busy")).toBe("true")
    expect(content!.textContent).toContain("file-a")

    const indicator = root.querySelector('[data-slot="async-state-refreshing"]')
    expect(indicator).not.toBeNull()
    expect(indicator!.getAttribute("aria-hidden")).toBe("true")
    expect(indicator!.textContent).toContain("Updating...")

    expect(root.querySelector('[role="status"]')).toBeNull()
    expect(root.querySelector('[role="alert"]')).toBeNull()
  })

  test("loading → ready announces loadedMessage exactly once, then stays silent", () => {
    const [props, setProps] = createSignal<AsyncStateProps>({ state: "loading", label: "Files" })
    const root = mount(() => props())

    setProps({
      state: "ready",
      label: "Files",
      children: "ready content",
      loadedMessage: "Loaded 3 files",
    })

    const statuses = root.querySelectorAll('[role="status"]')
    expect(statuses.length).toBe(1)
    expect(statuses[0].classList.contains("sr-only")).toBe(true)
    expect(statuses[0].textContent).toBe("Loaded 3 files")

    setProps({ state: "ready", label: "Files", children: "other content", loadedMessage: "Loaded 3 files" })
    expect(root.querySelectorAll('[role="status"]').length).toBe(1)
  })

  test("ready on initial mount stays silent", () => {
    const root = mount(() => ({ state: "ready", label: "Files", children: "content", loadedMessage: "Loaded" }))
    expect(root.querySelectorAll('[role="status"]').length).toBe(0)
  })

  test("refreshing → ready stays silent", () => {
    const [props, setProps] = createSignal<AsyncStateProps>({
      state: "refreshing",
      label: "Files",
      children: "stale",
    })
    const root = mount(() => props())

    setProps({ state: "ready", label: "Files", children: "fresh", loadedMessage: "Updated" })

    expect(root.querySelectorAll('[role="status"]').length).toBe(0)
  })

  test("error renders an alert whose title and detail are linked by stable ids", () => {
    const root = mount(() => ({
      state: "error",
      label: "Files",
      title: "Sync failed",
      detail: "The service did not respond.",
      retry: () => {},
    }))

    const alert = root.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()

    const labelledby = alert!.getAttribute("aria-labelledby")
    const describedby = alert!.getAttribute("aria-describedby")
    expect(labelledby).toBeTruthy()
    expect(describedby).toBeTruthy()
    expect(alert!.querySelector(`#${labelledby}`)?.textContent).toBe("Sync failed")
    expect(alert!.querySelector(`#${describedby}`)?.textContent).toBe("The service did not respond.")
  })

  test("error without detail omits aria-describedby", () => {
    const root = mount(() => ({ state: "error", label: "Files", title: "Sync failed" }))
    const alert = root.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.hasAttribute("aria-describedby")).toBe(false)
  })

  test("retry button invokes the callback once per click", () => {
    let calls = 0
    const root = mount(() => ({
      state: "error",
      label: "Files",
      title: "Failed",
      retry: () => calls++,
    }))

    const button = root.querySelector("button")
    expect(button).not.toBeNull()
    button!.click()
    button!.click()
    expect(calls).toBe(2)
  })

  test("renders no retry button when no callback is given", () => {
    const root = mount(() => ({ state: "error", label: "Files", title: "Failed" }))
    expect(root.querySelector("button")).toBeNull()
  })

  test("does not swallow exceptions thrown by the retry callback", () => {
    const errors: Error[] = []
    const onError = (event: ErrorEvent) => errors.push(event.error as Error)
    window.addEventListener("error", onError)
    try {
      const root = mount(() => ({
        state: "error",
        label: "Files",
        title: "Failed",
        retry: () => {
          throw new Error("boom")
        },
      }))
      const button = root.querySelector("button")!
      button.click()
    } finally {
      window.removeEventListener("error", onError)
    }

    expect(errors.map((error) => error.message)).toContain("boom")
  })

  test("error with stale children keeps them outside the alert", () => {
    const root = mount(() => ({
      state: "error",
      label: "Files",
      title: "Sync failed",
      detail: "Retry in a moment.",
      retry: () => {},
      children: <div data-testid="stale">previous rows</div>,
    }))

    const content = root.querySelector('[data-slot="async-state-content"]')
    expect(content).not.toBeNull()
    expect(content!.textContent).toContain("previous rows")

    const alert = root.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.contains(content!)).toBe(false)
  })

  test("empty renders its message without a live region", () => {
    const root = mount(() => ({ state: "empty", label: "Files", message: "No files yet" }))
    expect(root.textContent).toContain("No files yet")
    expect(root.querySelector('[role="status"]')).toBeNull()
    expect(root.querySelector('[role="alert"]')).toBeNull()
  })

  test("ready renders its children", () => {
    const root = mount(() => ({
      state: "ready",
      label: "Files",
      children: (
        <ul>
          <li>file</li>
        </ul>
      ),
    }))

    const content = root.querySelector('[data-slot="async-state-content"]')
    expect(content).not.toBeNull()
    expect(content!.textContent).toContain("file")
  })
})
