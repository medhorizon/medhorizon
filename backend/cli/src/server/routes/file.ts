import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { File } from "../../file"
import { ScienceFile } from "../../file/science"
import { ProjectFile } from "../../file/resolve"
import { HTTPException } from "hono/http-exception"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"

/** Map resolver/inspect errors to HTTP errors without leaking absolute paths
 * or internal stacks. Any unexpected error is re-thrown to the server-wide
 * onError handler. */
function mapError(err: unknown): HTTPException {
  if (err instanceof ProjectFile.NotContained || err instanceof ProjectFile.CrossDrive) {
    return new HTTPException(403, { message: "access denied: path is outside the project" })
  }
  if (err instanceof ProjectFile.NotFound) return new HTTPException(404, { message: "file not found" })
  if (err instanceof ProjectFile.IsDirectory) return new HTTPException(400, { message: "path is a directory" })
  if (err instanceof ScienceFile.DeadlineExceeded) return new HTTPException(503, { message: "inspection timed out" })
  if (err instanceof HTTPException) return err
  throw err
}

/** Parse an HTTP `Range` header (bytes=start-end / suffix) against a size.
 * Returns undefined for malformed or unsatisfiable ranges. */
function parseRange(range: string, size: number): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match) return undefined
  const [, startPart, endPart] = match
  if (startPart === "" && endPart === "") return undefined
  if (startPart === "") {
    const n = Number(endPart)
    if (Number.isNaN(n) || n <= 0) return undefined
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(startPart)
  if (Number.isNaN(start) || start < 0 || start >= size) return undefined
  const end = endPart === "" ? size - 1 : Math.min(Number(endPart), size - 1)
  if (Number.isNaN(end) || start > end) return undefined
  return { start, end }
}

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        description: "Search for text patterns across files in the project using ripgrep.",
        operationId: "find.text",
        responses: {
          200: {
            description: "Matches",
            content: {
              "application/json": {
                schema: resolver(Ripgrep.Match.shape.data.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          pattern: z.string(),
        }),
      ),
      async (c) => {
        const pattern = c.req.valid("query").pattern
        const result = await Ripgrep.search({
          cwd: Instance.directory,
          pattern,
          limit: 10,
        })
        return c.json(result)
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
        operationId: "find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          dirs: z.enum(["true", "false"]).optional(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        const dirs = c.req.valid("query").dirs
        const type = c.req.valid("query").type
        const limit = c.req.valid("query").limit
        const results = await File.search({
          query,
          limit: limit ?? 10,
          dirs: dirs !== "false",
          type,
        })
        return c.json(results)
      },
    )
    .get(
      "/find/symbol",
      describeRoute({
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
        operationId: "find.symbols",
        responses: {
          200: {
            description: "Symbols",
            content: {
              "application/json": {
                schema: resolver(LSP.Symbol.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
        }),
      ),
      async (c) => {
        /*
      const query = c.req.valid("query").query
      const result = await LSP.workspaceSymbol(query)
      return c.json(result)
      */
        return c.json([])
      },
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        description: "List files and directories in a specified path.",
        operationId: "file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.list(path)
        return c.json(content)
      },
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        description: "Read the content of a specified file.",
        operationId: "file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await File.read(path)
        return c.json(content)
      },
    )
    .put(
      "/file/content",
      describeRoute({
        summary: "Write file",
        description: "Write the content of a specified file.",
        operationId: "file.write",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
          content: z.string(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const content = await File.write(body.path, body.content)
        return c.json(content)
      },
    )
    .get(
      "/file/inspect",
      describeRoute({
        summary: "Inspect file",
        description:
          "Bounded, project-scoped classification of a project file. Reads only the frozen head/tail byte windows (never the full file), resolves .gz/.bgz by decompressing the inspected window, and returns detection plus a fixed-cap text preview (binary files are metadata-only).",
        operationId: "file.inspect",
        responses: {
          200: {
            description: "Science file inspection",
            content: {
              "application/json": {
                schema: resolver(ScienceFile.Inspect),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        try {
          return c.json(await ScienceFile.inspect({ path }))
        } catch (err) {
          throw mapError(err)
        }
      },
    )
    .get(
      "/file/preview",
      describeRoute({
        summary: "Preview file",
        description:
          "Bounded text preview of a project file with fixed byte/line caps and totalBytes/truncated. Binary files return metadata only. Reads at most a PREVIEW_BYTES window, never the full file.",
        operationId: "file.preview",
        responses: {
          200: {
            description: "Science file preview",
            content: {
              "application/json": {
                schema: resolver(ScienceFile.Preview),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        try {
          return c.json(await ScienceFile.preview({ path }))
        } catch (err) {
          throw mapError(err)
        }
      },
    )
    .get(
      "/file/raw",
      describeRoute({
        summary: "Download file",
        description:
          "Same-origin, path-safe byte stream of a project file. Streams from disk (never base64/JSON/data-URL) and supports HTTP Range for partial downloads. Each request re-resolves the path against the project boundary.",
        operationId: "file.raw",
        responses: {
          200: {
            description: "Raw file stream",
            content: {
              "application/octet-stream": {
                schema: resolver(z.string()),
              },
            },
          },
          206: {
            description: "Partial content (Range)",
            content: {
              "application/octet-stream": {
                schema: resolver(z.string()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        try {
          const { absolute, size } = await ProjectFile.requireFile({ path })
          const file = Bun.file(absolute)
          const contentType = file.type || "application/octet-stream"
          const range = c.req.header("range")
          if (range) {
            const parsed = parseRange(range, size)
            if (!parsed) throw new HTTPException(416, { message: "requested range not satisfiable" })
            // Stream the sliced range from disk. A ReadableStream body (rather
            // than a raw BunFile) survives hono's Response re-wrap in the cors
            // middleware, which would otherwise re-materialize the full file.
            const sliced = file.slice(parsed.start, parsed.end + 1)
            return new Response(sliced.stream(), {
              status: 206,
              headers: {
                "content-type": contentType,
                "content-range": `bytes ${parsed.start}-${parsed.end}/${size}`,
                "accept-ranges": "bytes",
                "content-length": String(parsed.end - parsed.start + 1),
              },
            })
          }
          return new Response(file.stream(), {
            status: 200,
            headers: {
              "content-type": contentType,
              "accept-ranges": "bytes",
              "content-length": String(size),
            },
          })
        } catch (err) {
          throw mapError(err)
        }
      },
    )
    .get(
      "/file/status",
      describeRoute({
        summary: "Get file status",
        description: "Get the git status of all files in the project.",
        operationId: "file.status",
        responses: {
          200: {
            description: "File status",
            content: {
              "application/json": {
                schema: resolver(File.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const content = await File.status()
        return c.json(content)
      },
    ),
)
