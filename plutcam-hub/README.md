# plutcam-hub

Tiny camera hub for Pluto.

## Run (dev)

```bash
cd /home/anri/.openclaw/workspace/plutcam-hub
PORT=1212 HOST=127.0.0.1 node server.mjs
```

Open: http://127.0.0.1:1212

## Camera upload API

`POST /api/cams/:camId/frame`

- `Content-Type: image/jpeg`
- `X-Pluto-Key: <per-camera secret>`
- Body: raw JPEG bytes

Latest frame served at: `GET /cams/:camId.jpg` (no-store)

Keys are generated on first run and stored at `./data/keys.json` (chmod 600).

Cams configured:
- home (Pluto's Home)
- yard (Pluto's Yard)
- backyard (Pluto's Backyard)
- top (Top)
