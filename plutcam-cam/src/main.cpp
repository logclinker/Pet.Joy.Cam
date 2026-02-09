#include <Arduino.h>
#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <esp_task_wdt.h>

// ====== CONFIG (per-camera) ======
// Wi-Fi credentials (do NOT commit real credentials)
// For now, set these before flashing. Future versions should use captive-portal provisioning.
static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Camera identity (must match hub CAMS list + API paths)
static const char* CAM_ID = "home";
// Hub endpoint (recommended): LAN HTTP to avoid ESP32 TLS flakiness
static const char* PLUTO_LAN_HOST = "10.0.0.79";
static const uint16_t PLUTO_LAN_PORT = 1212;
static const bool USE_LAN_HTTP = true;

// Optional fallback: public HTTPS (keep for debugging; set USE_LAN_HTTP=false to use)
static const char* PLUTO_HOST = "yourpet.joy.cam";
static const uint16_t PLUTO_PORT = 443;

static const char* PLUTO_PATH = "/api/cams/home/frame";
static const char* PLUTO_HELLO_PATH = "/api/cams/home/hello";
// Per-camera shared secret. The hub generates keys.json on first run.
// Copy the corresponding key for CAM_ID from hub data/keys.json.
static const char* PLUTO_KEY = "REPLACE_WITH_KEY_FROM_HUB_KEYS_JSON";
static const uint32_t POST_INTERVAL_MS = 1200;
static const uint32_t HELLO_INTERVAL_MS = 15000;
static const char* FW_VERSION = "plutcam/0.4-lan";

// ====== Reliability policy ======
// If we can't post a frame successfully for this long, reboot.
static const uint32_t STALL_REBOOT_MS = 60000;      // 60s
// If Wi-Fi stays disconnected this long (despite reconnect attempts), reboot.
static const uint32_t WIFI_REBOOT_MS  = 45000;      // 45s
// If capture fails N times in a row, re-init camera.
static const uint8_t  CAPTURE_REINIT_N = 5;
// If post fails N times in a row, reboot (usually a stuck TLS/WiFi state).
static const uint8_t  POST_REBOOT_N    = 20;
// Periodic reboot to avoid long-run drift (0 disables).
static const uint32_t PERIODIC_REBOOT_MS = 12UL * 60UL * 60UL * 1000UL; // 12h

// Network timeouts
static const uint32_t CONNECT_TIMEOUT_MS = 5000;
static const uint32_t IO_TIMEOUT_MS      = 5000;

// Insecure TLS (accept any cert). OK for quick bringup; tighten later with pinning.
static const bool INSECURE_TLS = true;

static WebServer web(80);

// AI Thinker ESP32-CAM flash LED is typically GPIO4.
#ifndef FLASH_LED_PIN
#define FLASH_LED_PIN 4
#endif
static bool flashOn = false;
static uint32_t flashOffAtMs = 0;
static const uint32_t FLASH_AUTO_OFF_MS = 10000;

// ====== AI Thinker ESP32-CAM pin map ======
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

static uint32_t lastOkFrameMs = 0;
static uint32_t lastWifiOkMs = 0;
static uint32_t bootMs = 0;
static uint8_t consecCaptureFail = 0;
static uint8_t consecPostFail = 0;

static void reboot_now(const char* why) {
  Serial.printf("REBOOT: %s\n", why);
  delay(200);
  ESP.restart();
}

static bool init_camera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Balanced defaults for ~1fps uploads
  config.frame_size = FRAMESIZE_VGA;   // 640x480
  config.jpeg_quality = 12;            // 0-63 (lower is better)
  config.fb_count = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_framesize(s, FRAMESIZE_VGA);
    s->set_quality(s, 12);
  }
  return true;
}

static void wifi_connect() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.printf("Connecting to WiFi SSID=%s ...\n", WIFI_SSID);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print('.');

    // keep watchdog alive during connect loop
    esp_task_wdt_reset();

    if (millis() - start > 20000) {
      Serial.println("\nWiFi connect timeout; will keep retrying (reboot policy handled in loop)");
      break;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    lastWifiOkMs = millis();
    Serial.printf("\nWiFi connected. IP=%s RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }
}

static bool post_frame(camera_fb_t* fb) {
  if (WiFi.status() != WL_CONNECTED) return false;

  const bool useLan = USE_LAN_HTTP;

  if (useLan) {
    WiFiClient client;
    client.setTimeout(IO_TIMEOUT_MS);
    if (!client.connect(PLUTO_LAN_HOST, PLUTO_LAN_PORT)) {
      Serial.println("HTTP connect failed (lan)");
      return false;
    }

    // Build HTTP request
    String req;
    req.reserve(256);
    req += "POST ";
    req += PLUTO_PATH;
    req += " HTTP/1.1\r\n";
    req += "Host: "; req += PLUTO_LAN_HOST; req += ":"; req += String(PLUTO_LAN_PORT); req += "\r\n";
    req += "User-Agent: "; req += FW_VERSION; req += " ("; req += CAM_ID; req += ")\r\n";
    req += "Connection: close\r\n";
    req += "Content-Type: image/jpeg\r\n";
    req += "X-Pluto-Key: "; req += PLUTO_KEY; req += "\r\n";
    req += "Content-Length: "; req += String(fb->len); req += "\r\n\r\n";

    client.print(req);
    size_t sent = client.write(fb->buf, fb->len);
    if (sent != fb->len) {
      Serial.printf("Short write: %u/%u\n", (unsigned)sent, (unsigned)fb->len);
      return false;
    }

    String status = client.readStringUntil('\n');
    status.trim();
    Serial.printf("HTTP(frame/lan): %s\n", status.c_str());

    uint32_t t0 = millis();
    while (client.connected() && millis() - t0 < 2000) {
      while (client.available()) (void)client.read();
      delay(5);
    }

    return status.startsWith("HTTP/1.1 200") || status.startsWith("HTTP/1.1 201") || status.startsWith("HTTP/1.1 204");
  }

  // Fallback: HTTPS (public)
  WiFiClientSecure client;
  if (INSECURE_TLS) client.setInsecure();

  client.setTimeout(IO_TIMEOUT_MS);
#if defined(ARDUINO)
  client.setHandshakeTimeout((uint32_t)(CONNECT_TIMEOUT_MS / 1000));
#endif

  if (!client.connect(PLUTO_HOST, PLUTO_PORT)) {
    Serial.println("TLS connect failed");
    return false;
  }

  // Build HTTP request
  String req;
  req.reserve(256);
  req += "POST ";
  req += PLUTO_PATH;
  req += " HTTP/1.1\r\n";
  req += "Host: "; req += PLUTO_HOST; req += "\r\n";
  req += "User-Agent: "; req += FW_VERSION; req += " ("; req += CAM_ID; req += ")\r\n";
  req += "Connection: close\r\n";
  req += "Content-Type: image/jpeg\r\n";
  req += "X-Pluto-Key: "; req += PLUTO_KEY; req += "\r\n";
  req += "Content-Length: "; req += String(fb->len); req += "\r\n\r\n";

  client.print(req);

  // Send JPEG body
  size_t sent = client.write(fb->buf, fb->len);
  if (sent != fb->len) {
    Serial.printf("Short write: %u/%u\n", (unsigned)sent, (unsigned)fb->len);
    return false;
  }

  // Read response status line (bounded by client timeout)
  String status = client.readStringUntil('\n');
  status.trim();
  Serial.printf("HTTP(frame): %s\n", status.c_str());

  // Drain
  uint32_t t0 = millis();
  while (client.connected() && millis() - t0 < 2000) {
    while (client.available()) (void)client.read();
    delay(10);
  }

  const bool ok = status.startsWith("HTTP/1.1 200") || status.startsWith("HTTP/1.1 201") || status.startsWith("HTTP/1.1 204");
  return ok;
}

static bool post_hello() {
  if (WiFi.status() != WL_CONNECTED) return false;

  const bool useLan = USE_LAN_HTTP;

  // body
  String body;
  body.reserve(200);
  body += "{\"ip\":\"";
  body += WiFi.localIP().toString();
  body += "\",\"rssi\":";
  body += String(WiFi.RSSI());
  body += ",\"heap\":";
  body += String(ESP.getFreeHeap());
  body += ",\"version\":\"";
  body += FW_VERSION;
  body += "\"}";

  if (useLan) {
    WiFiClient client;
    client.setTimeout(IO_TIMEOUT_MS);
    if (!client.connect(PLUTO_LAN_HOST, PLUTO_LAN_PORT)) {
      Serial.println("HTTP connect failed (hello/lan)");
      return false;
    }

    String req;
    req.reserve(320);
    req += "POST ";
    req += PLUTO_HELLO_PATH;
    req += " HTTP/1.1\r\n";
    req += "Host: "; req += PLUTO_LAN_HOST; req += ":"; req += String(PLUTO_LAN_PORT); req += "\r\n";
    req += "User-Agent: "; req += FW_VERSION; req += " ("; req += CAM_ID; req += ")\r\n";
    req += "Connection: close\r\n";
    req += "Content-Type: application/json\r\n";
    req += "X-Pluto-Key: "; req += PLUTO_KEY; req += "\r\n";
    req += "Content-Length: "; req += String(body.length()); req += "\r\n\r\n";
    req += body;

    client.print(req);

    String status = client.readStringUntil('\n');
    status.trim();
    Serial.printf("HTTP(hello/lan): %s\n", status.c_str());

    uint32_t t0 = millis();
    while (client.connected() && millis() - t0 < 1500) {
      while (client.available()) (void)client.read();
      delay(5);
    }

    return status.startsWith("HTTP/1.1 200");
  }

  // Fallback: HTTPS (public)
  WiFiClientSecure client;
  if (INSECURE_TLS) client.setInsecure();
  client.setTimeout(IO_TIMEOUT_MS);
#if defined(ARDUINO)
  client.setHandshakeTimeout((uint32_t)(CONNECT_TIMEOUT_MS / 1000));
#endif

  if (!client.connect(PLUTO_HOST, PLUTO_PORT)) {
    Serial.println("TLS connect failed (hello)");
    return false;
  }

  // (body is already built above)

  String req;
  req.reserve(300);
  req += "POST ";
  req += PLUTO_HELLO_PATH;
  req += " HTTP/1.1\r\n";
  req += "Host: "; req += PLUTO_HOST; req += "\r\n";
  req += "User-Agent: "; req += FW_VERSION; req += " ("; req += CAM_ID; req += ")\r\n";
  req += "Connection: close\r\n";
  req += "Content-Type: application/json\r\n";
  req += "X-Pluto-Key: "; req += PLUTO_KEY; req += "\r\n";
  req += "Content-Length: "; req += String(body.length()); req += "\r\n\r\n";
  req += body;

  client.print(req);

  String status = client.readStringUntil('\n');
  status.trim();
  Serial.printf("HTTP(hello): %s\n", status.c_str());

  uint32_t t0 = millis();
  while (client.connected() && millis() - t0 < 1500) {
    while (client.available()) (void)client.read();
    delay(10);
  }

  return status.startsWith("HTTP/1.1 200");
}

static void handle_root() {
  String html;
  html.reserve(1200);
  html += "<!doctype html><html><head><meta charset='utf-8'/><meta name='viewport' content='width=device-width,initial-scale=1'/>";
  html += "<title>PlutoCam - "; html += CAM_ID; html += "</title>";
  html += "<style>body{font-family:system-ui;background:#0b1220;color:#e5e7eb;margin:0;padding:14px}"
          ".card{max-width:820px;margin:0 auto;background:#111827cc;border:1px solid #ffffff1a;border-radius:14px;overflow:hidden}"
          ".hd{padding:12px 14px;display:flex;justify-content:space-between;align-items:center}"
          ".mut{color:#9ca3af;font-size:12px} img{width:100%;height:auto;display:block}"
          ".grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 14px 14px}"
          ".kv{background:#0b1220;border:1px solid #ffffff14;border-radius:12px;padding:10px}"
          ".k{font-size:11px;color:#9ca3af} .v{font-weight:700}</style></head><body>";

  html += "<div class='card'>";
  html += "<div class='hd'><div><div style='font-weight:800'>PlutoCam • "; html += CAM_ID; html += "</div>";
  html += "<div class='mut'>"; html += FW_VERSION; html += "</div></div>";
  html += "<div class='mut'>"; html += WiFi.localIP().toString(); html += "</div></div>";

  html += "<div style='position:relative'>";
  html += "<img src='/jpg?t='"; html += String(millis()); html += " alt='cam'/>";
  html += "<button id='flashbtn' style='position:absolute;right:12px;bottom:12px;z-index:10;border:1px solid rgba(255,255,255,.2);background:rgba(17,24,39,.6);color:#e5e7eb;padding:10px 12px;border-radius:999px;font-weight:800;backdrop-filter:blur(6px)'>FLASH</button>";
  html += "</div>";

  html += "<div class='grid'>";
  html += "<div class='kv'><div class='k'>Uptime (s)</div><div class='v'>"; html += String(millis()/1000); html += "</div></div>";
  html += "<div class='kv'><div class='k'>RSSI</div><div class='v'>"; html += String(WiFi.RSSI()); html += "</div></div>";
  html += "<div class='kv'><div class='k'>Free heap</div><div class='v'>"; html += String(ESP.getFreeHeap()); html += "</div></div>";
  html += "<div class='kv'><div class='k'>PSRAM</div><div class='v'>"; html += String(ESP.getPsramSize()); html += "</div></div>";
  html += "</div>";

  html += "<div class='mut' style='padding:0 14px 14px'>Auto-refresh: 1s • <a style='color:#93c5fd' href='/'>reload</a></div>";
  html += "</div>";

  html += "<script>\n"
          "let flashOn=false;\n"
          "const btn=document.getElementById('flashbtn');\n"
          "function render(){btn.textContent=flashOn?'FLASH ON':'FLASH OFF';btn.style.background=flashOn?'rgba(245,158,11,.55)':'rgba(17,24,39,.6)';}\n"
          "async function refreshFlash(){try{const r=await fetch('/flash',{cache:'no-store'});if(!r.ok) return; const j=await r.json(); if(typeof j.flash==='boolean'){flashOn=j.flash;render();}}catch(e){/*ignore*/}}\n"
          "async function setFlash(on){btn.disabled=true;try{const r=await fetch('/flash?on='+(on?1:0),{method:'POST',cache:'no-store'});if(r.ok){const j=await r.json(); if(typeof j.flash==='boolean') flashOn=j.flash; else flashOn=on; render();}}finally{btn.disabled=false;}}\n"
          "btn.addEventListener('click',()=>setFlash(!flashOn));\n"
          "render();\n"
          "setInterval(refreshFlash,1000);\n"
          "setTimeout(()=>location.replace('/?r='+Date.now()),1000);\n"
          "</script>";
  html += "</body></html>";
  web.send(200, "text/html", html);
}

static void handle_jpg() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    web.send(500, "text/plain", "capture failed");
    return;
  }
  web.sendHeader("Cache-Control", "no-store");
  web.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

static void flash_set(bool on) {
  flashOn = on;
  if (on) {
    digitalWrite(FLASH_LED_PIN, HIGH);
    flashOffAtMs = millis() + FLASH_AUTO_OFF_MS;
  } else {
    digitalWrite(FLASH_LED_PIN, LOW);
    flashOffAtMs = 0;
  }
}

static void handle_flash() {
  // Accept GET or POST.
  // - If on is provided: set state.
  // - If on is missing: return current state.
  const String on = web.arg("on");
  if (on.length()) {
    if (on == "1" || on == "true" || on == "on") {
      flash_set(true);
    } else {
      flash_set(false);
    }
  }

  const uint32_t now = millis();
  int32_t autoOffMsLeft = 0;
  if (flashOn && flashOffAtMs) {
    autoOffMsLeft = (int32_t)(flashOffAtMs - now);
    if (autoOffMsLeft < 0) autoOffMsLeft = 0;
  }

  String body;
  body.reserve(120);
  body += "{\"ok\":true,\"flash\":";
  body += (flashOn ? "true" : "false");
  body += ",\"autoOffMsLeft\":";
  body += String(autoOffMsLeft);
  body += "}";

  web.send(200, "application/json", body);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();

  bootMs = millis();
  lastOkFrameMs = bootMs;
  lastWifiOkMs = bootMs;

  // Watchdog: 10s. If loop stalls, reboot.
  esp_task_wdt_init(10, true);
  esp_task_wdt_add(NULL);

  Serial.printf("plutcam boot camId=%s\n", CAM_ID);

  wifi_connect();

  if (!init_camera()) {
    Serial.println("Camera init failed; restarting...\n");
    delay(2000);
    ESP.restart();
  }

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  // Boot indicator: blink flash LED twice so we know the board has power.
  for (int i = 0; i < 2; i++) {
    digitalWrite(FLASH_LED_PIN, HIGH);
    delay(120);
    digitalWrite(FLASH_LED_PIN, LOW);
    delay(120);
  }

  web.on("/", handle_root);
  web.on("/jpg", handle_jpg);
  web.on("/flash", HTTP_ANY, handle_flash);
  web.begin();
  Serial.println("Local web server started on :80");

  // initial hello
  post_hello();
}

void loop() {
  esp_task_wdt_reset();
  web.handleClient();

  static uint32_t lastPost = 0;
  static uint32_t lastHello = 0;
  const uint32_t now = millis();

  if (flashOn && flashOffAtMs && (int32_t)(now - flashOffAtMs) >= 0) {
    flash_set(false);
  }

  // Periodic reboot to avoid long-run drift
  if (PERIODIC_REBOOT_MS && (now - bootMs > PERIODIC_REBOOT_MS)) {
    reboot_now("periodic");
  }

  // Wi-Fi health
  if (WiFi.status() == WL_CONNECTED) {
    lastWifiOkMs = now;
  } else {
    // attempt reconnect (non-blocking-ish)
    if ((now - lastWifiOkMs) > 2000) {
      Serial.println("WiFi lost; reconnecting...");
      wifi_connect();
    }
    if ((now - lastWifiOkMs) > WIFI_REBOOT_MS) {
      reboot_now("wifi_stuck");
    }
  }

  // If we haven't posted a good frame for too long, reboot.
  if ((now - lastOkFrameMs) > STALL_REBOOT_MS) {
    reboot_now("frame_stall");
  }

  if (now - lastHello > HELLO_INTERVAL_MS) {
    lastHello = now;
    (void)post_hello();
  }

  if (now - lastPost < POST_INTERVAL_MS) {
    delay(5);
    return;
  }
  lastPost = now;

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    consecCaptureFail++;
    Serial.printf("Camera capture failed (%u/%u)\n", consecCaptureFail, CAPTURE_REINIT_N);
    if (consecCaptureFail >= CAPTURE_REINIT_N) {
      Serial.println("Reinitializing camera...");
      esp_camera_deinit();
      delay(200);
      if (!init_camera()) {
        reboot_now("camera_reinit_failed");
      }
      consecCaptureFail = 0;
    }
    delay(50);
    return;
  }

  consecCaptureFail = 0;

  Serial.printf("Captured %u bytes\n", (unsigned)fb->len);
  const bool ok = post_frame(fb);
  esp_camera_fb_return(fb);

  if (ok) {
    consecPostFail = 0;
    lastOkFrameMs = now;
  } else {
    consecPostFail++;
    Serial.printf("Post(frame) FAIL (%u/%u)\n", consecPostFail, POST_REBOOT_N);
    if (consecPostFail >= POST_REBOOT_N) {
      reboot_now("post_stuck");
    }
  }

  // Feed watchdog again after network activity
  esp_task_wdt_reset();
}
