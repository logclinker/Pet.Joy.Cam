# Deploy plutcam-hub

## Service

Installs a user systemd service listening on 127.0.0.1:1212.

```bash
mkdir -p ~/.config/systemd/user
cp /home/anri/.openclaw/workspace/plutcam-hub/plutcam-hub.service ~/.config/systemd/user/plutcam-hub.service
systemctl --user daemon-reload
systemctl --user enable --now plutcam-hub.service
systemctl --user status plutcam-hub.service --no-pager -n 50
```

Logs:

```bash
journalctl --user -u plutcam-hub -f
```

## Nginx

Assumes nginx terminates HTTPS for your chosen domain (example: `https://yourpet.joy.cam`) and proxies to:

- `http://127.0.0.1:1212`

## Camera upload

Example (raw JPEG):

```bash
curl -X POST \
  -H 'Content-Type: image/jpeg' \
  -H 'X-Pluto-Key: <key>' \
  --data-binary @frame.jpg \
  https://yourpet.joy.cam/api/cams/home/frame
```

## Secrets

Per-camera keys are stored at:

- `/home/anri/.openclaw/workspace/plutcam-hub/data/keys.json`

Do not expose this file.

Optional: set `ADMIN_TOKEN` to enable:

- `GET /admin/keys?token=...`

Only use over localhost/SSH tunnel.
