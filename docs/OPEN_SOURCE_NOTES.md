# Open-source sanitization notes

This repository intentionally does **not** ship:

- Real Wi-Fi credentials
- Real camera keys (`data/keys.json`)
- Real `FLASH_PASS` / `ADMIN_TOKEN`

To run:

- Copy `plutcam-hub/.env.example` to `.env` and set values.
- Run the hub once to generate `data/keys.json`.
- Copy keys into the firmware configuration before flashing.
