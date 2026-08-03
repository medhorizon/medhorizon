/**
 * Session artifact catalog API.
 *
 * Mounted additively under the session namespace (see server.ts). Every route
 * reads the local RLMArtifacts catalog only — no Research Graph, Atlas bridge,
 * or external network. Public responses never include the on-disk `path`;
 * browsers download via the same-origin relative `downloadPath`.
 *
 * Route schemas are declared with hono-openapi (describeRoute + validator +
 * resolver + Zod) so the repository SDK generator can pick them up.
 */

import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { RLMArtifacts } from "@/session/rlm/artifacts"
import { Log } from "@/util/log"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

// Frozen preview budget (server-fixed, not client-configurable). Preview
// always reads a bounded slice of the payload and reports truncated/totalBytes.
export const PREVIEW_CAP = 32 * 1024 // 32 KiB conservative default slice
export const PREVIEW_MAX = 256 * 1024 // 256 KiB absolute ceiling (reserved headroom)

// Stable error codes. Error bodies never include absolute paths or raw
// internal exceptions.
const ERROR_CODES = {
  sessionNotFound: "session_artifacts.session_not_found",
  artifactNotFound: "session_artifacts.artifact_not_found",
  invalidCursor: "session_artifacts.invalid_cursor",
  invalidID: "session_artifacts.invalid_artifact_id",
} as const

const ErrorBody = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  })
  .meta({ ref: "SessionArtifactsError" })

const ArtifactMeta = z
  .object({
    id: z.string(),
    type: z.string(),
    summary: z.string(),
    size: z.number().int().nonnegative(),
    createdAt: z.string(),
  })
  .meta({ ref: "SessionArtifactMeta" })

const ArtifactItem = ArtifactMeta.extend({
  downloadPath: z.string(),
}).meta({ ref: "SessionArtifactItem" })

const ListResponse = z
  .object({
    items: ArtifactItem.array(),
    nextCursor: z.string().optional(),
  })
  .meta({ ref: "SessionArtifactList" })

const PreviewResponse = z
  .object({
    metadata: ArtifactMeta,
    content: z.string(),
    totalBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .meta({ ref: "SessionArtifactPreview" })

// Fixed-format boundary validation. Both patterns reject `..`, encoded
// traversal, path separators, and anything that could escape the session's
// artifact directory; they never pass a raw filesystem path.
const SessionIDParam = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, "invalid session id")
  .meta({ description: "Session ID" })

const ArtifactIDParam = z
  .string()
  .regex(/^art-[A-Za-z0-9_-]{1,80}$/, "invalid artifact id")
  .meta({ description: "Artifact ID" })

function errorResponse(code: string, message: string) {
  return { error: { code, message } }
}

// Cursor encodes the stable (createdAt, id) sort key of the boundary item, so
// pagination never exposes directory structure. Base64url keeps it opaque to
// casual inspection but stable across requests.
function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url")
}

function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "number" &&
      Number.isFinite(parsed[0]) &&
      typeof parsed[1] === "string"
    ) {
      return { createdAt: parsed[0], id: parsed[1] }
    }
    return null
  } catch {
    return null
  }
}

export const SessionArtifactRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID/artifacts",
      describeRoute({
        summary: "List session artifacts",
        description:
          "Paginated, newest-first list of the session's registered artifacts. The cursor is a stable created-time + id ordering; responses never expose server paths.",
        tags: ["Session"],
        operationId: "session.artifacts.list",
        responses: {
          200: {
            description: "List of artifacts",
            content: {
              "application/json": {
                schema: resolver(ListResponse),
              },
            },
          },
          400: {
            description: "Invalid limit or cursor",
            content: {
              "application/json": {
                schema: resolver(ErrorBody),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionIDParam,
        }),
      ),
      validator(
        "query",
        z.object({
          limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .meta({ description: "Maximum items to return (default 50, max 200)" }),
          cursor: z.string().optional().meta({ description: "Opaque pagination cursor from a previous page" }),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const query = c.req.valid("query")
        const limit = query.limit ?? 50

        let cursor: { createdAt: number; id: string } | undefined
        if (query.cursor !== undefined) {
          const decoded = decodeCursor(query.cursor)
          if (!decoded) {
            return c.json(errorResponse(ERROR_CODES.invalidCursor, "cursor is not a valid artifact cursor"), 400)
          }
          cursor = decoded
        }

        const entries = await RLMArtifacts.list(sessionID) // newest-first
        let start = 0
        if (cursor) {
          const index = entries.findIndex((e) => e.createdAt === cursor.createdAt && e.id === cursor.id)
          if (index === -1) {
            return c.json(errorResponse(ERROR_CODES.invalidCursor, "cursor references an unknown artifact"), 400)
          }
          start = index + 1
        }

        const page = entries.slice(start, start + limit)
        const items = page.map((e) => ({
          id: e.id,
          type: e.type,
          summary: e.summary,
          size: e.size,
          createdAt: new Date(e.createdAt).toISOString(),
          downloadPath: `/session/${sessionID}/artifacts/${e.id}/content`,
        }))
        const last = page[page.length - 1]
        const nextCursor = last && start + limit < entries.length ? encodeCursor(last.createdAt, last.id) : undefined
        return c.json({ items, nextCursor })
      },
    )
    .get(
      "/:sessionID/artifacts/:artifactID/preview",
      describeRoute({
        summary: "Preview session artifact",
        description:
          "Bounded UTF-8 preview of an artifact's payload. Reads a fixed slice only, never the full file; `truncated` reports whether content was cut.",
        tags: ["Session"],
        operationId: "session.artifact.preview",
        responses: {
          200: {
            description: "Bounded preview",
            content: {
              "application/json": {
                schema: resolver(PreviewResponse),
              },
            },
          },
          400: {
            description: "Invalid artifact id",
            content: {
              "application/json": {
                schema: resolver(ErrorBody),
              },
            },
          },
          404: {
            description: "Session or artifact not found",
            content: {
              "application/json": {
                schema: resolver(ErrorBody),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionIDParam,
          artifactID: ArtifactIDParam,
        }),
      ),
      async (c) => {
        const { sessionID, artifactID } = c.req.valid("param")
        const preview = await RLMArtifacts.readPreview(sessionID, artifactID, PREVIEW_CAP)
        if (!preview) {
          const missingSession = !(await RLMArtifacts.sessionExists(sessionID))
          return c.json(
            errorResponse(missingSession ? ERROR_CODES.sessionNotFound : ERROR_CODES.artifactNotFound, "not found"),
            404,
          )
        }
        // Defense-in-depth: the resolved payload must stay inside this session's
        // artifact directory (already guaranteed by boundary validation).
        if (!RLMArtifacts.isWithin(sessionID, preview.entry.path)) {
          return c.json(errorResponse(ERROR_CODES.invalidID, "invalid artifact id"), 400)
        }
        return c.json({
          metadata: {
            id: preview.entry.id,
            type: preview.entry.type,
            summary: preview.entry.summary,
            size: preview.entry.size,
            createdAt: new Date(preview.entry.createdAt).toISOString(),
          },
          content: preview.content,
          totalBytes: preview.totalBytes,
          truncated: preview.truncated,
        })
      },
    )
    .get(
      "/:sessionID/artifacts/:artifactID/content",
      describeRoute({
        summary: "Download session artifact",
        description:
          "Stream the raw artifact payload as an explicit download with safe filename/content headers. Never requested implicitly.",
        tags: ["Session"],
        operationId: "session.artifact.content",
        responses: {
          200: {
            description: "Raw artifact payload",
            content: {
              "application/octet-stream": {
                schema: resolver(z.string()),
              },
            },
          },
          400: {
            description: "Invalid artifact id",
            content: {
              "application/json": {
                schema: resolver(ErrorBody),
              },
            },
          },
          404: {
            description: "Session or artifact not found",
            content: {
              "application/json": {
                schema: resolver(ErrorBody),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionIDParam,
          artifactID: ArtifactIDParam,
        }),
      ),
      async (c) => {
        const { sessionID, artifactID } = c.req.valid("param")
        const entry = await RLMArtifacts.get(sessionID, artifactID)
        if (!entry) {
          const missingSession = !(await RLMArtifacts.sessionExists(sessionID))
          return c.json(
            errorResponse(missingSession ? ERROR_CODES.sessionNotFound : ERROR_CODES.artifactNotFound, "not found"),
            404,
          )
        }
        if (!RLMArtifacts.isWithin(sessionID, entry.path)) {
          return c.json(errorResponse(ERROR_CODES.invalidID, "invalid artifact id"), 400)
        }
        log.info("artifact download", { sessionID, artifactID, size: entry.size })
        // Stream the payload lazily from disk with safe filename/content headers.
        // Explicit download only — never requested implicitly on module load.
        return new Response(Bun.file(entry.path), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${entry.id}.dat"`,
            "Content-Length": String(entry.size),
          },
        })
      },
    ),
)
