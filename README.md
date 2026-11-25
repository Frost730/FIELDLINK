# FIELDLINK

Off-grid Android tactical situational awareness and peer-to-peer multi-hop squad mesh map powered by **Nearby Connections (`P2P_CLUSTER`)**, **Wi-Fi Direct fallback**, **PBKDF2 + AES-256-GCM cryptography**, **MapLibre GL**, and **hardware GNSS/IMU anti-teleport sensor fusion**.

---

## Key Capabilities

- **Off-Grid Multi-Hop P2P Mesh (`Nearby Connections` + `Wi-Fi Direct`)**
  - Hands-free peer discovery, asymmetric initiator selection, and automatic `5s` cluster link reconciliation across 3+ devices with `TTL=4` multi-hop gossip relay.
  - Wi-Fi Direct TCP socket fallback (`port 8988`) encrypted with the same `FLW1:` AES-256-GCM Mission Key envelope.
- **Zero-Trust Passkey Gating & Encryption**
  - Devices advertise a 12-hex-char `HMAC-SHA256` passkey proof token derived from the PBKDF2-stretched **Mission Key** (`10,000` rounds) without broadcasting the passphrase.
  - Peers with missing, invalid, or mismatched Mission Keys are blocked at discovery and rejected in `onConnectionInitiated` before any RF socket connects.
  - Local state persistence uses authenticated **ChaCha20-MAC** (`FLK_V3_`) and per-device ChaCha20 offline tile encryption (`FTK1`), while Android secures the Mission Key with **AndroidKeyStore**.
- **Anti-Teleport Location & Compass Sensor Fusion**
  - Instant startup positioning from multi-source Android caches and `SharedPreferences` GNSS anchors.
  - IMU stationary lock (`ZUPT`), coarse cell/Wi-Fi bounce suppression, velocity envelope checks, and 2-hit jump confirmation hysteresis.
  - Tilt-compensated Rotation Vector compass with True/Magnetic North declination and manual device trim.
- **Tactical HUD & Squad Collaboration**
  - MapLibre Satellite Hybrid and Topo layers with offline 5 km sector tile caching (`z14–z17`), MGRS grid overlay, and MGRS / DMS / DECIMAL coordinate switching.
  - Real-time synced waypoints, multi-hop route drawings, deletion tombstones, Squad Leader authority controls, SOS distress beacon, recon screenshot export (`Pictures/FIELDLINK`), and foreground background service (`stopWithTask="true"`).

---

## Download & Install (Android)

1. Open the [**Releases**](https://github.com/Frost730/FIELDLINK/releases) page and download the latest `.apk` asset (for example `app-debug.apk` / `FIELDLINK-v1.0.0.apk`).
2. Install the APK on each Android device (Android 7.0+ / API 24+, target SDK 36; allow installs from unknown sources if prompted).
3. Grant **Location**, **Bluetooth / Nearby Devices**, **Nearby Wi-Fi Devices**, and **Notifications** permissions when prompted.

### Connecting Devices in a Cluster
1. Install the same build on every phone in your group.
2. On all phones, open **Settings → Network** (or **Squad Management → Mesh Security**) and set the **exact same Mission Key**.
3. Keep Bluetooth, Wi-Fi, and Location turned on — devices sharing the same Mission Key automatically discover each other, verify their passkey proofs before connecting, and sync positions, waypoints, drawings, and leadership state.
   - Devices with a different or invalid Mission Key appear as `KEY BLOCKED` in the Squad/Nearby modal and will not connect.

---

## Build From Source

### Prerequisites
- **Node.js** 20+ and **npm**
- **JDK 17+** and **Android SDK** (for building the Android APK)

### Commands
```bash
# Install dependencies
npm install

# Run unit tests & linter
npm test
npm run lint

# Build web bundle & sync Capacitor Android project
npm run build
npx cap sync android

# Build debug APK (Windows PowerShell)
cd android
.\gradlew.bat assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Project Structure

- `src/` — React + TypeScript UI, Zustand tactical store (`useTacticalStore.ts`), ChaCha20 storage vault (`crypto.ts`), coordinate/MGRS utilities, offline IndexedDB tile cache (`TileCacheManager.ts`), and native Capacitor bridges.
- `android/app/src/main/java/com/fieldlink/app/` — Native Android plugins:
  - `FieldlinkNearbyPlugin.java` — Nearby Connections `P2P_CLUSTER`, pre-connect passkey gate, AES-256-GCM transport, AndroidKeyStore wrapping, and multi-hop relay.
  - `FieldlinkWifiDirectPlugin.java` — Authenticated/encrypted Wi-Fi Direct TCP socket transport.
  - `FieldlinkLocationPlugin.java` — Fused + GNSS + IMU anti-teleport positioning.
  - `FieldlinkCompassPlugin.java` — Rotation vector + WMM declination compass.
  - `FieldlinkBackgroundPlugin.java` & `FieldlinkBackgroundService.java` — Foreground tracking service & MediaStore recon screenshots.

---

## License

This project is licensed under the terms of the [LICENSE](LICENSE) file in this repository.
