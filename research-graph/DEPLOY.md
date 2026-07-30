# Deployment (optional)

MedHorizon continues to deploy as before. This module deploys independently.

## API (Fly.io / Railway)

```bash
cd research-graph
# set secrets: SUPABASE_*, OPENAI_API_KEY, SUPABASE_JWT_SECRET, APP_ENV=production
fly deploy   # uses fly.toml + Dockerfile
# or: railway up
```

Production binds `0.0.0.0` only inside the platform network; put auth (JWT) in front. Local scripts still refuse non-loopback.

## Frontend (Vercel)

```bash
cd research-graph/frontend
vercel --prod
# set VITE_API_URL to the deployed API origin
```

## Sync recovery

Outbox retries via `POST /api/sync/outbox/{id}/retry` or plugin `atlas_sync`. Identical artifact bytes dedupe by `content_hash` so reconnect does not create duplicate nodes/artifacts.
