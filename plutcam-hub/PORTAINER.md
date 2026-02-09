# plutcam-hub — Portainer Stack install

## What you get
- `plutcam-hub` listening on **port 1212**
- Persistent data in `./data`:
  - `data/keys.json` (camera keys)
  - `data/frames/` (latest frames)

## Option A — Portainer Stack (Git repository)
1) Push this folder (`plutcam-hub/`) to a git repo.
2) In Portainer → **Stacks** → **Add stack** → **Repository**:
   - Repository URL: `<your repo>`
   - Compose path: `plutcam-hub/docker-compose.yml`
3) Set an environment variable (optional):
   - `ADMIN_TOKEN` (used to enable admin-only UI actions)
4) Deploy.

## Option B — Portainer Stack (Web editor)
1) In Portainer → **Stacks** → **Add stack** → **Web editor**
2) Paste this compose file:

```yaml
services:
  plutcam-hub:
    image: ghcr.io/YOURORG/plutcam-hub:latest
    container_name: plutcam-hub
    restart: unless-stopped
    ports:
      - "1212:1212"
    environment:
      HOST: "0.0.0.0"
      PORT: "1212"
      DATA_DIR: "/app/data"
      ADMIN_TOKEN: "${ADMIN_TOKEN:-}"
    volumes:
      - plutcam_data:/app/data

volumes:
  plutcam_data:
```

3) Deploy.

> Note: Option B requires you to provide a built image (e.g., GHCR). If you want, I can also add GitHub Actions to build/push the image.

## Health checks
- Hub UI: `http://<docker-host>:1212/`
- Frames should start appearing in `data/frames/` after cameras POST.

## Reverse proxy
If you already have nginx on the host proxying your domain (example: `yourpet.joy.cam`) → `127.0.0.1:1212`, you can keep it.
If you want the container to be private, bind ports to localhost only:

```yaml
ports:
  - "127.0.0.1:1212:1212"
```
