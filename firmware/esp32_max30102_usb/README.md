# ESP32 + MAX30102 → USB Serial (no web server)

Wired pulse sensor for Artemia. The board streams **JSON Lines** over USB Serial at **115200** baud. Chrome/Edge talks to it with **Web Serial** — there is no Wi‑Fi and no HTTP server on the ESP32.

## Wiring (3.3 V)

| MAX30102 | ESP32 |
|---|---|
| VIN / VCC | 3.3 V |
| GND | GND |
| SDA | GPIO 8 |
| SCL | GPIO 9 |

Do **not** power the sensor from 5 V.

## Arduino IDE

1. Board: **ESP32 Dev Module** (Espressif package).
2. Library: **SparkFun MAX3010x Pulse and Proximity Sensor Library** (`MAX30105.h`).
3. Open `esp32_max30102_usb.ino`, upload.
4. Serial Monitor is optional; the app owns the port while measuring.

## Protocol (one JSON object per line, UTF-8)

Host → device:

```json
{"cmd":"ping"}
{"cmd":"start","session_id":"<uuid>"}
{"cmd":"stop"}
```

Device → host (hello / sample):

```json
{"protocol_version":"1","type":"hello","device_id":"esp32.aabbccddeeff","firmware_version":"0.1.0","uptime_ms":1234}
{"protocol_version":"1","type":"sample","device_id":"esp32.aabbccddeeff","firmware_version":"0.1.0","session_id":"...","seq":1,"uptime_ms":1500,"contact_detected":true,"raw_ir":51234,"raw_red":48012,"hr_bpm":72,"quality_flags":[]}
```

- `hr_bpm` may be `null` while the finger is settling.
- SpO₂ is **not** claimed as a clinical result in this prototype.
- PPG chart in the app uses `raw_ir` (optical signal, **not** ECG).

## App

Chrome/Edge on desktop, `http://localhost:5173` (secure context). Open **Measurements → USB sensor → Connect**.
