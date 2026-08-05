import { For, Show, type JSX, type ParentComponent, type Component } from "solid-js"
import { Icon } from "@synsci/ui/icon"
import type { IconProps } from "@synsci/ui/icon"
import { DropdownMenu } from "@synsci/ui/dropdown-menu"
import { FONT_CODE, FONT_CONTENT, FONT_UI, RADIUS_CARD, RADIUS_CONTROL } from "@/styles/tokens"

// Shared visual language for Settings panels. Primitives consume the semantic
// UI/content/code and spacing/radius token bridges while panels stay isolated.

export const PanelScroll: ParentComponent = (props) => (
  <div class="flex flex-col h-full overflow-y-auto no-scrollbar" style={{ "font-family": FONT_UI }}>
    {props.children}
  </div>
)

export const PanelHeader: Component<{ title: string; description: string; toolbar?: JSX.Element }> = (props) => (
  <div
    class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_var(--space-6)),transparent)]"
    style={{ "font-family": FONT_UI }}
  >
    <div class="flex flex-col gap-[var(--space-4)] px-[var(--space-4)] pt-[var(--space-8)] pb-[var(--space-4)] sm:px-[var(--space-4)] max-w-[820px]">
      <div class="flex flex-col gap-[var(--space-1)]">
        <h2 class="text-16-medium text-text-strong" style={{ "font-family": FONT_UI }}>
          {props.title}
        </h2>
        <p class="text-13-regular text-text-weak" style={{ "font-family": FONT_CONTENT }}>
          {props.description}
        </p>
      </div>
      <Show when={props.toolbar}>{props.toolbar}</Show>
    </div>
  </div>
)

export const PanelBody: ParentComponent = (props) => (
  <div
    class="flex flex-col gap-[var(--space-6)] px-[var(--space-4)] pb-[var(--space-7)] sm:px-[var(--space-4)] max-w-[820px]"
    style={{ "font-family": FONT_UI }}
  >
    {props.children}
  </div>
)

// Muted "SECTION" subheader with a trailing count.
export const SectionLabel: Component<{ label: string; count?: number }> = (props) => (
  <div class="flex items-center gap-[var(--space-2)] px-[calc(var(--space-1)/2)]" style={{ "font-family": FONT_UI }}>
    <span class="atlas-section-label" style={{ "font-family": FONT_UI }}>
      {props.label}
    </span>
    <Show when={props.count !== undefined}>
      <span class="text-10-regular text-text-weaker" style={{ "font-family": FONT_UI }}>
        {props.count}
      </span>
    </Show>
  </div>
)

// Rounded card wrapping a stack of rows (dividers between children handled by
// Row's border-b). Use for grouped lists.
export const Card: ParentComponent = (props) => (
  <div
    class="border border-border-weak-base rounded-[var(--radius-card)] overflow-hidden bg-surface-base/40"
    style={{ "font-family": FONT_UI, "border-radius": RADIUS_CARD }}
  >
    {props.children}
  </div>
)

export const Row: ParentComponent<{ onClick?: () => void }> = (props) => (
  <div
    class="flex flex-wrap items-center gap-[var(--space-3)] px-[var(--space-4)] py-[calc(var(--space-3)_+_var(--space-1)/2)] border-b border-border-weak-base last:border-none transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    classList={{ "cursor-pointer hover:bg-surface-raised-base/40": !!props.onClick }}
    role={props.onClick ? "button" : undefined}
    tabIndex={props.onClick ? 0 : undefined}
    style={{ "font-family": FONT_UI }}
    onClick={props.onClick}
    onKeyDown={(event) => {
      if (!props.onClick) return
      if (event.key === "Enter") props.onClick()
      if (event.key !== " ") return
      event.preventDefault()
      props.onClick()
    }}
  >
    {props.children}
  </div>
)

export const EmptyState: Component<{ icon: IconProps["name"]; title: string; hint?: string }> = (props) => (
  <div
    class="flex flex-col items-center gap-[var(--space-3)] text-center py-[var(--space-7)]"
    style={{ "font-family": FONT_UI }}
  >
    <div
      class="flex items-center justify-center size-11 rounded-[var(--radius-control)] border border-border-weak-base bg-surface-base/40 text-icon-weak-base"
      style={{ "border-radius": RADIUS_CONTROL }}
    >
      <Icon name={props.icon} size="normal" />
    </div>
    <span class="text-14-medium text-text-strong" style={{ "font-family": FONT_UI }}>
      {props.title}
    </span>
    <Show when={props.hint}>
      <p class="text-12-regular text-text-weak leading-relaxed max-w-[380px]" style={{ "font-family": FONT_CONTENT }}>
        {props.hint}
      </p>
    </Show>
  </div>
)

// Leading identity tile for a list row — the shared visual anchor that makes the
// Specialists and Connectors lists read as one family. Pass a `monogram` (takes
// the tint as its colour, for a specialist's identity) or an `icon` (stays
// neutral on the tinted tile, for a connector's type). `tint` (hex or a CSS var)
// washes the tile background; omit it for a neutral tile.
export const Avatar: Component<{ tint?: string; icon?: IconProps["name"]; monogram?: string }> = (props) => (
  <div
    class="flex items-center justify-center size-8 rounded-[var(--radius-control)] flex-shrink-0 text-13-medium leading-none uppercase"
    style={{
      "border-radius": RADIUS_CONTROL,
      "font-family": FONT_UI,
      background: props.tint ? `color-mix(in srgb, ${props.tint} 14%, transparent)` : "var(--surface-raised-base)",
      color: props.monogram && props.tint ? props.tint : "var(--icon-strong-base)",
    }}
  >
    <Show when={props.icon} fallback={<span>{props.monogram}</span>}>
      <Icon name={props.icon!} size="small" />
    </Show>
  </div>
)

// Small inline metadata badge (a specialist's mode, a connector's type).
export const Chip: ParentComponent = (props) => (
  <span
    class="text-11-medium text-text-weak/70 px-[calc(var(--space-1)_+_var(--space-1)/2)] py-[calc(var(--space-1)/2)] rounded-[var(--radius-control)] bg-surface-raised-base/60 flex-shrink-0"
    style={{ "font-family": FONT_UI, "border-radius": RADIUS_CONTROL }}
  >
    {props.children}
  </span>
)

// ── Toolbar pieces ──────────────────────────────────────────────────────────

const controlBase =
  "flex items-center gap-[var(--space-2)] h-[calc(var(--space-6)_+_var(--space-1))] px-[var(--space-3)] rounded-[var(--radius-control)] border border-border-weak-base bg-surface-base text-13-medium transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"

export const SearchInput: Component<{ value: string; onInput: (v: string) => void; placeholder?: string }> = (
  props,
) => (
  <label
    class={`${controlBase} flex-1 min-w-[140px] focus-within:border-border-strong-base focus-within:shadow-[var(--focus-ring)] cursor-text`}
    style={{ "font-family": FONT_UI, "border-radius": RADIUS_CONTROL }}
  >
    <Icon name="magnifying-glass" size="small" class="text-icon-weak-base flex-shrink-0" />
    <input
      type="text"
      value={props.value}
      placeholder={props.placeholder ?? "Search"}
      spellcheck={false}
      autocapitalize="off"
      autocomplete="off"
      class="flex-1 bg-transparent outline-none text-text-strong placeholder:text-text-weak/60 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      style={{ "font-family": FONT_UI }}
      onInput={(e) => props.onInput(e.currentTarget.value)}
    />
    <Show when={props.value}>
      <button
        type="button"
        class="text-icon-weak-base hover:text-text-strong focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        aria-label="Clear search"
        onClick={() => props.onInput("")}
      >
        <Icon name="circle-x" size="small" />
      </button>
    </Show>
  </label>
)

export interface FilterOption {
  id: string
  label: string
  count?: number
}

export const FilterMenu: Component<{ options: FilterOption[]; value: string; onSelect: (id: string) => void }> = (
  props,
) => {
  const active = () => props.options.find((o) => o.id === props.value) ?? props.options[0]
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        class={`${controlBase} text-text-strong hover:bg-surface-raised-base/60 data-[expanded]:bg-surface-raised-base-active flex-shrink-0`}
        style={{ "font-family": FONT_UI, "border-radius": RADIUS_CONTROL }}
      >
        <span class="truncate max-w-[160px]">
          {active()?.label}
          <Show when={active()?.count !== undefined}> ({active()?.count})</Show>
        </span>
        <Icon name="chevron-down" size="small" class="text-icon-weak-base" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="mt-[var(--space-1)] min-w-[180px]">
          <For each={props.options}>
            {(option) => (
              <DropdownMenu.Item onSelect={() => props.onSelect(option.id)}>
                <DropdownMenu.ItemLabel class="flex-1">{option.label}</DropdownMenu.ItemLabel>
                <Show when={option.count !== undefined}>
                  <span class="text-12-regular text-text-weak ml-[var(--space-4)]" style={{ "font-family": FONT_UI }}>
                    {option.count}
                  </span>
                </Show>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

export interface AddItem {
  icon: IconProps["name"]
  label: string
  description?: string
  onSelect: () => void
}

export const AddMenu: Component<{ label: string; items: AddItem[] }> = (props) => (
  <DropdownMenu>
    <DropdownMenu.Trigger
      class={`${controlBase} text-text-strong bg-surface-raised-base-active hover:bg-surface-raised-base-active/80 data-[expanded]:bg-surface-raised-base-active flex-shrink-0`}
      style={{ "font-family": FONT_UI, "border-radius": RADIUS_CONTROL }}
    >
      <Icon name="plus" size="small" />
      <span class="truncate">{props.label}</span>
      <Icon name="chevron-down" size="small" class="text-icon-weak-base" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content class="mt-[var(--space-1)] min-w-[240px]">
        <For each={props.items}>
          {(item) => (
            <DropdownMenu.Item
              onSelect={item.onSelect}
              class="items-start gap-[calc(var(--space-2)_+_var(--space-1)/2)] py-[var(--space-2)]"
              style={{ "font-family": FONT_UI }}
            >
              <Icon
                name={item.icon}
                size="small"
                class="text-icon-weak-base mt-[calc(var(--space-1)/2)] flex-shrink-0"
              />
              <div class="flex flex-col gap-[calc(var(--space-1)/2)] min-w-0">
                <DropdownMenu.ItemLabel>{item.label}</DropdownMenu.ItemLabel>
                <Show when={item.description}>
                  <DropdownMenu.ItemDescription
                    class="text-12-regular text-text-weak"
                    style={{ "font-family": FONT_CONTENT }}
                  >
                    {item.description}
                  </DropdownMenu.ItemDescription>
                </Show>
              </div>
            </DropdownMenu.Item>
          )}
        </For>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu>
)

export const Toolbar: ParentComponent = (props) => (
  <div class="flex items-center gap-[var(--space-2)] flex-wrap" style={{ "font-family": FONT_UI }}>
    {props.children}
  </div>
)

// A small labelled text/textarea field used by the inline creation forms.
export const FormField: Component<{
  label: string
  value: string
  onInput: (v: string) => void
  placeholder?: string
  multiline?: boolean
  disabled?: boolean
  mono?: boolean
}> = (props) => (
  <label class="flex flex-col gap-[calc(var(--space-1)_+_var(--space-1)/2)]" style={{ "font-family": FONT_UI }}>
    <span class="text-12-medium text-text-strong" style={{ "font-family": FONT_UI }}>
      {props.label}
    </span>
    <Show
      when={props.multiline}
      fallback={
        <input
          type="text"
          value={props.value}
          disabled={props.disabled}
          placeholder={props.placeholder}
          class="h-[calc(var(--space-6)_+_var(--space-1))] px-[var(--space-3)] rounded-[var(--radius-control)] border border-border-weak-base bg-surface-base text-13-regular text-text-strong outline-none focus:border-border-strong-base focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] placeholder:text-text-weak/60"
          style={{ "font-family": FONT_UI, "border-radius": RADIUS_CONTROL }}
          onInput={(e) => props.onInput(e.currentTarget.value)}
        />
      }
    >
      <textarea
        value={props.value}
        disabled={props.disabled}
        placeholder={props.placeholder}
        rows={5}
        class="px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-control)] border border-border-weak-base bg-surface-base text-13-regular text-text-strong outline-none focus:border-border-strong-base focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] resize-y min-h-[calc(var(--space-8)_+_var(--space-6))] placeholder:text-text-weak/60"
        style={{ "font-family": props.mono ? FONT_CODE : FONT_CONTENT, "border-radius": RADIUS_CONTROL }}
        classList={{ "font-mono": props.mono }}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
    </Show>
  </label>
)

export const FormButton: Component<{
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: "primary" | "ghost" | "danger"
}> = (props) => (
  <button
    type="button"
    disabled={props.disabled}
    onClick={props.onClick}
    class="h-[calc(var(--space-6)_+_var(--space-1))] px-[var(--space-4)] rounded-[var(--radius-control)] text-13-medium transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:opacity-50"
    style={{ "font-family": FONT_UI, "border-radius": RADIUS_CONTROL }}
    classList={{
      "bg-surface-raised-base-active text-text-strong hover:bg-surface-raised-base-active/80":
        (props.variant ?? "primary") === "primary",
      "border border-border-weak-base text-text-weak hover:text-text-strong hover:bg-surface-raised-base/60":
        props.variant === "ghost",
      "text-text-on-critical-base hover:bg-surface-critical-weak": props.variant === "danger",
    }}
  >
    {props.label}
  </button>
)
