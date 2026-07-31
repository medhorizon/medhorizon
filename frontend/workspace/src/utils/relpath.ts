/**
 * Strip `dir` from `file` when `file` is under that directory.
 * Handles Windows `\` and POSIX `/`, and case-insensitive drive/prefix match.
 * Returns the original `file` when it is not under `dir` (already relative, or outside).
 */
export function relpath(dir: string, file: string) {
  if (!dir || !file) return file
  const root = dir.replaceAll("\\", "/").replace(/\/+$/, "")
  const target = file.replaceAll("\\", "/")
  if (!root) return file
  const a = root.toLowerCase()
  const b = target.toLowerCase()
  if (b === a) return "."
  if (b.startsWith(a + "/")) return target.slice(root.length + 1)
  return file
}
