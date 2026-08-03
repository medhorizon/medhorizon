import { Match, Show, Switch, createRenderEffect, createSignal, createUniqueId, type JSX } from "solid-js"
import { Button } from "./button"
import { Spinner } from "./spinner"

type AsyncBase = {
  label: string
  compact?: boolean
}

export type AsyncStateProps = AsyncBase &
  (
    | { state: "loading"; message?: string }
    | { state: "refreshing"; message?: string; children: JSX.Element }
    | { state: "empty"; message?: string }
    | {
        state: "error"
        title?: string
        detail?: string
        retry?: () => void
        retryLabel?: string
        children?: JSX.Element
      }
    | { state: "ready"; children: JSX.Element; loadedMessage?: string }
  )
export function AsyncState(props: AsyncStateProps) {
  const [first, setFirst] = createSignal(true)
  const [prev, setPrev] = createSignal<AsyncStateProps["state"]>("loading")
  const [announce, setAnnounce] = createSignal(false)
  const titleId = `async-state-title-${createUniqueId()}`
  const detailId = `async-state-detail-${createUniqueId()}`

  // Announce "loaded" only on a real loading/error → ready transition, never on
  // first mount and never after refreshing (a background refresh stays quiet).
  createRenderEffect(() => {
    const current = props.state
    const previous = prev()
    if (current !== "ready") {
      setAnnounce(false)
    } else if ((previous === "loading" || previous === "error") && !first() && props.loadedMessage) {
      setAnnounce(true)
    }
    setPrev(current)
    setFirst(false)
  })

  return (
    <Switch>
      <Match when={props.state === "loading" && props}>
        {(loading) => {
          const p = loading()
          return (
            <div
              data-component="async-state"
              role="status"
              aria-label={p.label}
              data-compact={p.compact ? "true" : undefined}
            >
              <Show when={p.message}>{(message) => <span>{message()}</span>}</Show>
            </div>
          )
        }}
      </Match>
      <Match when={props.state === "refreshing" && props}>
        {(refreshing) => {
          const p = refreshing()
          return (
            <div data-component="async-state" data-compact={p.compact ? "true" : undefined}>
              <div data-slot="async-state-content" aria-busy="true">
                {p.children}
              </div>
              <div data-slot="async-state-refreshing" aria-hidden="true">
                <Spinner />
                <Show when={p.message}>{(message) => <span>{message()}</span>}</Show>
              </div>
            </div>
          )
        }}
      </Match>
      <Match when={props.state === "empty" && props}>
        {(empty) => {
          const p = empty()
          return (
            <div data-component="async-state" data-compact={p.compact ? "true" : undefined}>
              <Show when={p.message}>{(message) => <span>{message()}</span>}</Show>
            </div>
          )
        }}
      </Match>
      <Match when={props.state === "error" && props}>
        {(error) => {
          const p = error()
          return (
            <div data-component="async-state" data-compact={p.compact ? "true" : undefined}>
              <Show when={p.children}>
                <div data-slot="async-state-content">{p.children}</div>
              </Show>
              <div
                data-slot="async-state-banner"
                role="alert"
                aria-labelledby={p.title ? titleId : undefined}
                aria-describedby={p.detail ? detailId : undefined}
              >
                <Show when={p.title}>
                  <span data-slot="async-state-title" id={titleId}>
                    {p.title}
                  </span>
                </Show>
                <Show when={p.detail}>
                  <span data-slot="async-state-detail" id={detailId}>
                    {p.detail}
                  </span>
                </Show>
                <Show when={p.retry}>
                  {(retry) => (
                    <Button onClick={retry()} variant="secondary" size="small">
                      {p.retryLabel ?? "Retry"}
                    </Button>
                  )}
                </Show>
              </div>
            </div>
          )
        }}
      </Match>
      <Match when={props.state === "ready" && props}>
        {(ready) => {
          const p = ready()
          return (
            <div data-component="async-state" data-compact={p.compact ? "true" : undefined}>
              <div data-slot="async-state-content">{p.children}</div>
              <Show when={announce()}>
                <Show when={p.loadedMessage}>
                  {(message) => (
                    <span role="status" class="sr-only">
                      {message()}
                    </span>
                  )}
                </Show>
              </Show>
            </div>
          )
        }}
      </Match>
    </Switch>
  )
}
