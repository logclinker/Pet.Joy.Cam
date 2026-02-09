# Deploy behind nginx (HTTPS)

If you want to access the dashboard remotely, use HTTPS and auth.

## Example nginx location

```nginx
location / {
  proxy_pass http://127.0.0.1:1212;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  # WebSocket (if ever added)
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
}
```

Add authentication (basic auth or SSO) and consider IP allowlisting.
