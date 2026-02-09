# Pluto Cam Project — KEEP IN MIND

## Core goals
- Modern, fun **pet cam** dashboard at https://yourpet.joy.cam (example domain)
- Nginx already reverse-proxies to this host/port **1212**; service must stay up (systemd)
- Live snapshots only (no history)

## Camera UI requirements
- Default view: **4 cams** in a clean **2×2 split** inside the page (no gaps/padding inside grid)
- Keep pet-page header/branding (turtle icon, colors, background)
- Overlay text on images (name + status) with shadow/gradient so it’s readable
- Refresh ~1s; offline indicator after ~12s

## View modes (must keep)
- Support switching views for current/future cams:
  - **1 / 2 / 4 / 6 / 10** cameras
  - Prefer unobtrusive UI controls (or URL param `?view=` + keyboard shortcuts) but keep it accessible
  - For 4: 2×2; for 2: 2×1; for 6: 3×2; for 10: 5×2

## Ingest API requirements
- Cameras can post to your hub over LAN HTTP (recommended), or to a public HTTPS endpoint (example: `https://yourpet.joy.cam/...`).
- Endpoint: `POST /api/cams/:camId/frame` with raw JPEG
- Auth: `X-Pluto-Key` per camera (stored server-side)
- Latest image: `GET /cams/:camId.jpg` (no-store)

## ESP32-CAM requirements
- 4 cameras planned: home / yard / backyard / top
- Upload cadence: ~1–2 seconds per frame
- ESP32-CAM-MB (CH341) flashing failed (no bootloader connect)
- Fallback flashing plan: **FT232RL USB-TTL** direct wiring
  - Prefer 5V power + safe UART logic level

## Ops / reliability
- Service managed by `systemctl --user` as `plutcam-hub.service`
- Keep changes audited; avoid breaking prod when iterating UI
- Avoid nested template literals inside server-side template strings (caused prior crashes)
