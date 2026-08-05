import z from "zod"
import { Tool } from "./tool"
import path from "path"
import { realpathSync } from "fs"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { fileURLToPath } from "url"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { OpenScience } from "@/openscience"
import { Sandbox } from "@/sandbox/sandbox"
import { Config } from "@/config/config"
import { ProcessSupervisor } from "@/process/supervisor"
import { CapabilityPolicy } from "@/process/policy"

const ExecutionInput = z.object({ skill: z.string().optional(), capabilities: z.array(z.string()).optional() })

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async (initCtx) => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })
  const grants = initCtx?.agent?.subprocessCapabilities ?? {}

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      execution: ExecutionInput
        .optional()
        .describe("Optional, explicitly declared subprocess capability request"),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const input = params as {
        command: string
        timeout?: number
        execution?: { skill?: string; capabilities?: string[] }
        workdir?: string
        description: string
      }
      const cwd = input.workdir || Instance.directory
      const tree = await parser().then((p) => p.parse(input.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue
        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const candidate = path.resolve(cwd, arg)
            const resolved = (() => {
              try {
                return realpathSync(candidate)
              } catch {
                return candidate
              }
            })()
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              if (!Instance.containsPath(resolved)) directories.add(resolved)
            }
          }
        }

        // cd covered by above check
        if (command.length && command[0] !== "cd") {
          patterns.add(command.join(" "))
          always.add(BashArity.prefix(command).join(" ") + "*")
        }
      }

      if (directories.size > 0) {
        await ctx.ask({
          permission: "external_directory",
          patterns: Array.from(directories),
          always: Array.from(directories).map((x) => path.dirname(x) + "*"),
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      // Permission checks above are intentionally the last operation before
      // process/filesystem side effects. In particular, a denied call must not
      // create a missing cwd or a spill file.
      const capability = CapabilityPolicy.resolve({
        sessionID: ctx.sessionID,
        turnID: ctx.messageID,
        agent: ctx.agent,
        grants,
        execution: input.execution,
      })
      try {
        const { existsSync, mkdirSync } = await import("fs")
        if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true })
      } catch (error) {
        throw new Error(`Unable to prepare working directory: ${error instanceof Error ? error.message : String(error)}`)
      }

      // Seed the BYOK secret cache so redact() below masks the user's own
      // provider keys (auth.json + shell env), not just synced managed ones.
      await OpenScience.refreshByokSecrets(process.env).catch(() => {})

      // Wrap the command in an OS sandbox when configured. The permission checks
      // above decide *whether* to run; this decides *with what authority*. When
      // sandbox is off (default) `plan` returns the raw command unchanged.
      const sandbox = Sandbox.plan({
        command: input.command,
        shell,
        cwd,
        workspace: [Instance.directory, Instance.worktree],
        options: await Config.trustedSandbox(),
      })

      const runtime = ProcessSupervisor.isScientificCommand(input.command)
        ? /(?:^|[\s;&|])Rscript(?=\s|$)/.test(input.command)
          ? "r" as const
          : "python" as const
        : "bash" as const
      const result = await ProcessSupervisor.run({
        file: sandbox.file,
        args: sandbox.sandboxed ? sandbox.args : undefined,
        shell: sandbox.sandboxed ? false : sandbox.useShell,
        cwd,
        env: OpenScience.scopedSubprocessEnv(process.env, capability.env),
        runtime,
        mode: "ephemeral",
        lane: runtime === "bash" ? "general" : "scientific",
        timeout: input.timeout,
        signal: ctx.abort,
        sessionID: ctx.sessionID,
        callID: ctx.callID,
        description: input.description,
        capabilities: capability.capabilities,
        secrets: OpenScience.subprocessSecrets(),
        sandbox,
        metadata: ({ output }) => {
          ctx.metadata({ metadata: { output, description: input.description } })
        },
      })
      return {
        title: input.description,
        metadata: result.metadata,
        output: result.output,
      }
    },
  }
})
