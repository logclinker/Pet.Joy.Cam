# Architecture (MVP)

## Components

- **ESP32-CAM firmware** (`plutcam-cam/`)
  - Captures JPEG frames
  - Periodically POSTs:
    - `POST /api/cams/:camId/hello` (JSON metadata)
    - `POST /api/cams/:camId/frame` (JPEG)
  - Exposes local camera control:
    - `POST /flash?on=1|0`
    - `GET /flash` state

- **Hub** (`plutcam-hub/`)
  - Receives frames and writes latest frame per camera to disk
  - Maintains in-memory metadata (last seen, IP, etc.)
  - Serves dashboard UI
  - Can relay flash requests to camera local IP

## Trust boundaries

- Camera-to-hub auth uses a per-camera key (`X-Pluto-Key`) stored in hub `data/keys.json`.
- Flash control is protected by `FLASH_PASS` and/or `ADMIN_TOKEN`.

## Data

- Latest frames: `plutcam-hub/data/frames/<camId>.jpg`
- Keys: `plutcam-hub/data/keys.json` (secret)

## Future directions

- Captive portal provisioning on the ESP32
- Persist metadata to disk
- Cloud multi-tenant version (accounts + subdomains)
- Optional relay / tunneling for remote viewing
