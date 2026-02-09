# Pet.Joy.Cam (YourPet Cams)

<img width="1904" height="1239" alt="image" src="https://github.com/user-attachments/assets/2e64b694-27fd-4af2-81f0-2c64ea371d54" />

Self-hosted ESP32-CAM snapshot hub + live-updating dashboard.

This repo contains two parts:

- `plutcam-hub/` — Fastify server + web dashboard + flash relay (Docker-friendly)
- `plutcam-cam/` — ESP32-CAM firmware (PlatformIO)

> Status: prototype / MVP. Designed for 1fps-ish JPEG snapshots (not full video streaming).

## What you get

- A dashboard that shows multiple camera tiles with 1s refresh.
- Cameras push JPEG frames to your hub over LAN HTTP (reliable).
- Optional flash control per camera (password-protected; stored in browser session).

## Architecture (MVP)

```
ESP32-CAM  --->  LAN HTTP  --->  Hub (Docker)  --->  Dashboard
   |                    (stores latest frame per cam)
   +-- local web UI (/flash) for testing
```

## Quickstart (Hub)

### 1) Run with Docker Compose

On the machine that will receive snapshots:

```bash
cd plutcam-hub
cp .env.example .env
# (optional) set FLASH_PASS and/or ADMIN_TOKEN in .env

docker compose up -d --build
```

Then open:

- `http://<hub-ip>:1212/`

### Data directory (secrets)

The hub creates `plutcam-hub/data/keys.json` on first run. **Do not commit it.**

## Firmware (ESP32-CAM)

### 1) Configure firmware

Edit `plutcam-cam/src/main.cpp` and set:

- `WIFI_SSID` / `WIFI_PASS`
- `CAM_ID` (must match a camera id in `plutcam-hub/server.mjs`)
- `PLUTO_LAN_HOST` / `PLUTO_LAN_PORT` (hub address)
- `PLUTO_PATH` / `PLUTO_HELLO_PATH`
- `PLUTO_KEY` (copy the per-camera key from `plutcam-hub/data/keys.json`)

### 2) Build + flash

```bash
cd plutcam-cam
pio run -e esp32cam
pio run -t upload -e esp32cam --upload-port /dev/ttyUSB0
```

If you see `Failed to connect to ESP32: No serial data received`, put the board into bootloader mode (IO0/BOOT held while reset).

## Flash control

- Hub dashboard provides a per-tile Flash button.
- Flash calls are authenticated by either:
  - `FLASH_PASS` via `x-flash-pass` header (prompted in UI), or
  - `ADMIN_TOKEN` via `?token=...`

If you do not set `FLASH_PASS` and do not set `ADMIN_TOKEN`, flash requests will be rejected.

## Security notes

This is a DIY / self-host project. Minimum recommendations:

- Keep hub on LAN only.
- Do not expose the hub dashboard publicly without HTTPS + authentication.
- Treat `data/keys.json` as a secret.

## License

See `LICENSE`.
