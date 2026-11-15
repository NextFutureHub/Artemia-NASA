/**
 * Artemia USB pulse bridge: ESP32 + MAX30102 over Serial (no Wi-Fi / no web server).
 * Baud: 115200. JSON Lines protocol_version "1".
 *
 * Library: SparkFun MAX3010x (MAX30105.h) — works with MAX30102 breakouts.
 * I2C: SDA=GPIO8, SCL=GPIO9 @ 3.3V.
 */
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"

static const char *FIRMWARE_VERSION = "0.1.0";
static const char *PROTOCOL_VERSION = "1";
static const uint32_t BAUD = 115200;
static const uint16_t IR_CONTACT_MIN = 20000;
static const uint8_t SAMPLE_HZ = 25;
static const int PIN_SDA = 8;
static const int PIN_SCL = 9;

MAX30105 particle;
String deviceId;
String activeSession;
bool streaming = false;
uint32_t seq = 0;
uint32_t lastSampleMs = 0;
String lineBuf;

const byte RATE_SIZE = 8;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute = 0;
int beatAvg = 0;

String makeDeviceId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[32];
  snprintf(
      buf,
      sizeof(buf),
      "esp32.%02x%02x%02x%02x%02x%02x",
      (unsigned)(mac) & 0xff,
      (unsigned)(mac >> 8) & 0xff,
      (unsigned)(mac >> 16) & 0xff,
      (unsigned)(mac >> 24) & 0xff,
      (unsigned)(mac >> 32) & 0xff,
      (unsigned)(mac >> 40) & 0xff);
  return String(buf);
}

void emitHello() {
  Serial.print(F("{\"protocol_version\":\""));
  Serial.print(PROTOCOL_VERSION);
  Serial.print(F("\",\"type\":\"hello\",\"device_id\":\""));
  Serial.print(deviceId);
  Serial.print(F("\",\"firmware_version\":\""));
  Serial.print(FIRMWARE_VERSION);
  Serial.print(F("\",\"uptime_ms\":"));
  Serial.print(millis());
  Serial.println(F("}"));
}

void emitError(const char *code) {
  Serial.print(F("{\"protocol_version\":\""));
  Serial.print(PROTOCOL_VERSION);
  Serial.print(F("\",\"type\":\"error\",\"device_id\":\""));
  Serial.print(deviceId);
  Serial.print(F("\",\"firmware_version\":\""));
  Serial.print(FIRMWARE_VERSION);
  Serial.print(F("\",\"code\":\""));
  Serial.print(code);
  Serial.print(F("\",\"uptime_ms\":"));
  Serial.print(millis());
  Serial.println(F("}"));
}

void emitSample(uint32_t ir, uint32_t red, bool contact, bool saturation) {
  seq += 1;
  Serial.print(F("{\"protocol_version\":\""));
  Serial.print(PROTOCOL_VERSION);
  Serial.print(F("\",\"type\":\"sample\",\"device_id\":\""));
  Serial.print(deviceId);
  Serial.print(F("\",\"firmware_version\":\""));
  Serial.print(FIRMWARE_VERSION);
  Serial.print(F("\",\"session_id\":\""));
  Serial.print(activeSession);
  Serial.print(F("\",\"seq\":"));
  Serial.print(seq);
  Serial.print(F(",\"uptime_ms\":"));
  Serial.print(millis());
  Serial.print(F(",\"contact_detected\":"));
  Serial.print(contact ? F("true") : F("false"));
  Serial.print(F(",\"raw_ir\":"));
  Serial.print(ir);
  Serial.print(F(",\"raw_red\":"));
  Serial.print(red);
  Serial.print(F(",\"hr_bpm\":"));
  if (contact && beatAvg >= 20 && beatAvg <= 250) {
    Serial.print(beatAvg);
  } else {
    Serial.print(F("null"));
  }
  Serial.print(F(",\"quality_flags\":["));
  bool first = true;
  if (!contact) {
    Serial.print(F("\"no_contact\""));
    first = false;
  }
  if (saturation) {
    if (!first) Serial.print(',');
    Serial.print(F("\"saturation\""));
  }
  Serial.println(F("]}"));
}

String extractJsonString(const String &src, const char *key) {
  String pattern = String("\"") + key + "\"";
  int at = src.indexOf(pattern);
  if (at < 0) return "";
  int colon = src.indexOf(':', at + pattern.length());
  if (colon < 0) return "";
  int q1 = src.indexOf('"', colon + 1);
  if (q1 < 0) return "";
  int q2 = src.indexOf('"', q1 + 1);
  if (q2 < 0) return "";
  return src.substring(q1 + 1, q2);
}

void handleCommand(const String &raw) {
  String line = raw;
  line.trim();
  if (line.length() == 0) return;

  if (line.indexOf("\"ping\"") >= 0) {
    emitHello();
    return;
  }
  if (line.indexOf("\"stop\"") >= 0) {
    streaming = false;
    activeSession = "";
    emitHello();
    return;
  }
  if (line.indexOf("\"start\"") >= 0) {
    String sid = extractJsonString(line, "session_id");
    if (sid.length() < 8) {
      emitError("bad_session");
      return;
    }
    activeSession = sid;
    streaming = true;
    seq = 0;
    rateSpot = 0;
    beatsPerMinute = 0;
    beatAvg = 0;
    lastBeat = 0;
    for (byte i = 0; i < RATE_SIZE; i++) rates[i] = 0;
    lastSampleMs = 0;
    emitHello();
    return;
  }
  emitError("unknown_cmd");
}

void updateHeartRate(uint32_t ir) {
  if (checkForBeat(ir)) {
    long delta = millis() - lastBeat;
    lastBeat = millis();
    beatsPerMinute = 60.0 / (delta / 1000.0);
    if (beatsPerMinute < 20 || beatsPerMinute > 250) return;
    rates[rateSpot++] = (byte)beatsPerMinute;
    rateSpot %= RATE_SIZE;
    long total = 0;
    for (byte i = 0; i < RATE_SIZE; i++) total += rates[i];
    beatAvg = total / RATE_SIZE;
  }
}

void setup() {
  Serial.begin(BAUD);
  delay(200);
  deviceId = makeDeviceId();

  Wire.begin(PIN_SDA, PIN_SCL);
  if (!particle.begin(Wire, I2C_SPEED_FAST)) {
    emitError("sensor_missing");
  } else {
    particle.setup();
    particle.setPulseAmplitudeRed(0x1F);
    particle.setPulseAmplitudeIR(0x1F);
    particle.setPulseAmplitudeGreen(0);
    emitHello();
  }
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineBuf.length() > 0) {
        handleCommand(lineBuf);
        lineBuf = "";
      }
    } else if (lineBuf.length() < 4000) {
      lineBuf += c;
    } else {
      lineBuf = "";
      emitError("line_too_long");
    }
  }

  if (!streaming) return;

  uint32_t now = millis();
  if (now - lastSampleMs < (1000UL / SAMPLE_HZ)) return;
  lastSampleMs = now;

  uint32_t ir = particle.getIR();
  uint32_t red = particle.getRed();
  bool contact = ir >= IR_CONTACT_MIN;
  bool saturation = ir > 260000 || red > 260000;

  if (contact) {
    updateHeartRate(ir);
  } else {
    beatAvg = 0;
    beatsPerMinute = 0;
  }

  emitSample(ir, red, contact, saturation);
}
