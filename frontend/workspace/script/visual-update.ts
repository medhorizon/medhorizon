if (process.platform !== "linux") throw new Error("Visual baselines may only be generated on Linux Chromium")
if (process.env.VISUAL_BASELINE_UPDATE !== "1") {
  throw new Error("Set VISUAL_BASELINE_UPDATE=1 in the dedicated baseline workflow")
}

const child = Bun.spawn(
  ["bun", "script/e2e-local.ts", "--project=visual-a11y", "--update-snapshots", ...Bun.argv.slice(2)],
  { stdout: "inherit", stderr: "inherit" },
)

process.exit(await child.exited)
