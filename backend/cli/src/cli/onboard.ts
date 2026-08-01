import * as prompts from "@clack/prompts"
import path from "path"
import { cmd } from "./cmd/cmd"
import { UI } from "./ui"
import { Auth } from "../auth"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { Sandbox } from "../sandbox/sandbox"
import { Global } from "../global"
import { AuthLoginCommand } from "./cmd/auth"
import { runLocalModelSetup } from "./cmd/local"

const MARKER = path.join(Global.Path.state, "onboarded")

/** Provider env vars that count as "already configured" so we never nag a
 *  user who exported a key in their shell. Deliberately not exhaustive — a
 *  false negative just re-offers setup, which is harmless. */
const PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "CEREBRAS_API_KEY",
  "TOGETHER_API_KEY",
  "PERPLEXITY_API_KEY",
]

function hasProviderEnv(): boolean {
  return PROVIDER_ENV_KEYS.some((k) => !!process.env[k])
}

/** True once the user has any usable way to run a model: a saved BYOK key,
 *  a provider env var, or an explicit default model in config. Used to decide
 *  whether to auto-launch onboarding and whether to warn about a missing model.
 *  Managed cloud sessions no longer count as configured by default. */
export async function isConfigured(): Promise<boolean> {
  if (hasProviderEnv()) return true
  try {
    if (Object.keys(await Auth.all()).length > 0) return true
  } catch {}
  try {
    const config = await Config.get()
    if (config.model) return true
  } catch {}
  return false
}

async function isOnboarded(): Promise<boolean> {
  try {
    return await Bun.file(MARKER).exists()
  } catch {
    return false
  }
}

async function markOnboarded(): Promise<void> {
  try {
    await Bun.write(MARKER, new Date().toISOString() + "\n")
  } catch {}
}

/** Whether to auto-launch the first-run wizard from the default command.
 *  Gated on an interactive TTY plus "nothing configured yet"; suppressed in
 *  CI, when piped, once the marker is set, or via OPENSCIENCE_NO_ONBOARD=1. */
export async function needsOnboarding(): Promise<boolean> {
  if (process.env.OPENSCIENCE_NO_ONBOARD === "1") return false
  if (process.env.CI) return false
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false
  if (await isOnboarded()) return false
  if (await isConfigured()) return false
  return true
}

async function onboardByok(): Promise<void> {
  prompts.log.info(
    "Bring your own key or sign in with a subscription (ChatGPT/Codex, Claude Max) — pick next. Both stay on this machine and are free.",
  )
  // Reuse the proven provider picker + key/OAuth flow. It also handles
  // Claude Max / ChatGPT / Copilot sign-in via the provider auth plugins.
  await AuthLoginCommand.handler({} as never)
}

async function onboardLocal(): Promise<void> {
  prompts.log.info(
    "Point MedHorizon at a local model server (Ollama, LM Studio, or any OpenAI-compatible endpoint). " +
      "It runs on your machine — free, offline, no API key.",
  )
  await runLocalModelSetup({ intro: false })
}

function onboardSkip(): void {
  prompts.log.info("No problem — start right away with the free demo models.")
  prompts.log.message(
    "When you're ready:\n" +
      "  medhorizon keys add    add your own provider key (always free)\n" +
      "  medhorizon local add   use a local model (Ollama / LM Studio / OpenAI-compatible)",
  )
}

/** The first-run setup wizard. BYOK / local first — MedHorizon never requires an account. */
export async function runOnboarding(opts?: { force?: boolean }): Promise<void> {
  prompts.intro(opts?.force ? "MedHorizon setup" : "Welcome to MedHorizon")

  const choice = await prompts.select({
    message: "How do you want to power the models?",
    initialValue: "byok",
    options: [
      { value: "byok", label: "Your own keys", hint: "Anthropic · OpenAI · Google · 100+ providers · always free" },
      {
        value: "local",
        label: "Local models",
        hint: "Ollama · LM Studio · OpenAI-compatible endpoint · free, offline",
      },
      { value: "skip", label: "Not now", hint: "free demo models now, set up anytime" },
    ],
  })
  if (prompts.isCancel(choice)) {
    prompts.cancel("Setup cancelled — run `medhorizon init` whenever you're ready.")
    await markOnboarded()
    return
  }

  if (choice === "byok") await onboardByok()
  else if (choice === "local") await onboardLocal()
  else onboardSkip()

  await markOnboarded()
  prompts.outro("You're all set.")
}

export const InitCommand = cmd({
  command: ["init", "onboard"],
  describe: "set up MedHorizon — models and keys",
  async handler() {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    await runOnboarding({ force: true })
  },
})

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "check what's configured and what's missing",
  async handler() {
    UI.empty()
    prompts.intro("medhorizon doctor")

    if (Global.LegacyConflicts.length) {
      prompts.log.warn(
        `Legacy data directories are ignored because current directories exist: ${Global.LegacyConflicts.map((item) => item.legacy).join(", ")}. Merge or remove them.`,
      )
    }

    try {
      const keys = Object.keys(await Auth.all())
      if (keys.length) prompts.log.success(`Provider keys: ${keys.join(", ")}`)
      else prompts.log.info("Provider keys: none  (run `medhorizon keys add`)")
    } catch {}

    const envKeys = PROVIDER_ENV_KEYS.filter((k) => !!process.env[k])
    if (envKeys.length) prompts.log.info(`Environment keys: ${envKeys.join(", ")}`)

    try {
      const config = await Config.get()
      const locals = Object.entries(config.provider ?? {}).filter(([, p]) =>
        Provider.isLocalBaseURL(p?.options?.baseURL ?? p?.api),
      )
      if (locals.length) {
        prompts.log.success(`Local models: ${locals.map(([id]) => id).join(", ")}  (run \`medhorizon local list\`)`)
      }
      prompts.log.info(`Default model: ${config.model ?? "auto (chosen from available providers)"}`)

      const sandbox = Sandbox.describe()
      const sandboxOn = (await Config.trustedSandbox())?.enabled === true
      const sandboxLine = sandboxOn
        ? sandbox.available
          ? { level: "success" as const, msg: `Sandbox: on (${sandbox.backend})  (run \`medhorizon sandbox test\`)` }
          : { level: "warn" as const, msg: `Sandbox: on but no backend here — ${sandbox.reason}` }
        : {
            level: "info" as const,
            msg: sandbox.available
              ? `Sandbox: off  (${sandbox.backend} available — \`medhorizon sandbox enable\`)`
              : "Sandbox: off",
          }
      prompts.log[sandboxLine.level](sandboxLine.msg)
    } catch {}

    if (!(await isConfigured())) {
      prompts.log.warn(
        "No model source configured — free demo models will be used. Run `medhorizon init` to set one up.",
      )
    }
    prompts.outro("Done")
  },
})
