package com.fieldlink.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

@CapacitorPlugin(
    name = "FieldlinkNearby",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        ),
        @Permission(
            alias = "bluetooth_s",
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT
            }
        ),
        @Permission(
            alias = "nearby_t",
            strings = {
                Manifest.permission.NEARBY_WIFI_DEVICES,
                Manifest.permission.POST_NOTIFICATIONS
            }
        )
    }
)
public class FieldlinkNearbyPlugin extends Plugin {

    private static final String TAG = "FieldlinkNearby";
    private static volatile FieldlinkNearbyPlugin activeInstance;
    private static final String SERVICE_ID = "com.fieldlink.app.tactical.mesh";
    private static final Strategy STRATEGY = Strategy.P2P_CLUSTER;
    private static final int MAX_AUTO_DIRECT_LINKS = 3;
    private static final int MAX_HARD_DIRECT_LINKS = 5;

    private ConnectionsClient connectionsClient;
    private final Set<String> connectedEndpoints = ConcurrentHashMap.newKeySet();
    private final Set<String> pendingConnections = ConcurrentHashMap.newKeySet();
    private final Set<String> mismatchedEndpoints = ConcurrentHashMap.newKeySet();
    private final Map<String, String> endpointCallsigns = new ConcurrentHashMap<>();
    private final Map<String, String> endpointNodeIds = new ConcurrentHashMap<>();
    private final Map<String, DiscoveredEndpointInfo> discoveredPeers = new ConcurrentHashMap<>();
    private final Map<String, Long> peerDiscoveredAtMs = new ConcurrentHashMap<>();
    private final Map<String, Long> peerRetryAfterMs = new ConcurrentHashMap<>();
    private final Map<String, Integer> peerRetryCount = new ConcurrentHashMap<>();
    private final Map<String, Long> cryptoNotifyLastMs = new ConcurrentHashMap<>();
    private final Map<String, Long> seenMessageIds = Collections.synchronizedMap(
        new LinkedHashMap<String, Long>(512, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
                return size() > 512;
            }
        }
    );

    private String localCallsign = "OPERATOR-1";
    private String localNodeId = "";
    private final Map<String, String> callsignToNodeId = new ConcurrentHashMap<>();
    private final Map<String, String> nodeIdToCallsign = new ConcurrentHashMap<>();
    private volatile boolean isAdvertising = false;
    private volatile boolean isDiscovering = false;

    // Non-blocking send queue & multi-peer reconciler scheduler
    private final ExecutorService sendExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService burstScheduler = Executors.newScheduledThreadPool(2);
    private ScheduledFuture<?> reconcileFuture = null;

    // Tactical AES-256-GCM Mission Mesh Cryptography
    private static final String KEYSTORE_ALIAS = "fieldlink_mission_key_wrap";
    private static final String PREF_KEY_ENC = "mission_key_enc";
    private static final byte[] MAGIC_HEADER = new byte[]{(byte) 0x46, (byte) 0x4C, (byte) 0x01}; // 'F', 'L', v1
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128; // bits
    private static final SecureRandom secureRandom = new SecureRandom();
    private String missionKey = "FIELDLINK-MISSION-ALPHA-2026";
    private SecretKeySpec derivedKeySpec = null;

    private static final byte[] KDF_SALT = "FIELDLINK_TACTICAL_SALT_v1".getBytes(StandardCharsets.UTF_8);
    private static final int KDF_ITERATIONS = 10000;

    private SecretKey getOrCreateKeystoreWrappingKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
            KeyGenerator keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
            keyGen.init(spec);
            return keyGen.generateKey();
        }
        return (SecretKey) keyStore.getKey(KEYSTORE_ALIAS, null);
    }

    private String wrapMissionKeyForStorage(String plainKey) throws Exception {
        SecretKey wrappingKey = getOrCreateKeystoreWrappingKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey);
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(plainKey.getBytes(StandardCharsets.UTF_8));
        byte[] combined = new byte[1 + iv.length + encrypted.length];
        combined[0] = (byte) iv.length;
        System.arraycopy(iv, 0, combined, 1, iv.length);
        System.arraycopy(encrypted, 0, combined, 1 + iv.length, encrypted.length);
        return Base64.encodeToString(combined, Base64.NO_WRAP);
    }

    private String unwrapMissionKeyFromStorage(String wrappedBase64) throws Exception {
        byte[] combined = Base64.decode(wrappedBase64, Base64.NO_WRAP);
        if (combined.length < 14) throw new IllegalArgumentException("Corrupt wrapped key");
        int ivLen = combined[0] & 0xFF;
        byte[] iv = new byte[ivLen];
        System.arraycopy(combined, 1, iv, 0, ivLen);
        byte[] encrypted = new byte[combined.length - 1 - ivLen];
        System.arraycopy(combined, 1 + ivLen, encrypted, 0, encrypted.length);
        SecretKey wrappingKey = getOrCreateKeystoreWrappingKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, wrappingKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private String maskMissionKey(String key) {
        if (key == null || key.isEmpty()) return "••••••";
        if (key.length() <= 3) return "••••••";
        return key.substring(0, 3) + "••••••";
    }

    private String parseCallsign(String raw) {
        if (raw == null || raw.isEmpty()) return "OPERATOR";
        String[] parts = raw.split("\\|", -1);
        return parts.length >= 1 && !parts[0].isEmpty() ? parts[0] : "OPERATOR";
    }

    private String parseNodeId(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        String[] parts = raw.split("\\|", -1);
        return parts.length >= 2 ? parts[1] : "";
    }

    private String parseKeyProof(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        String[] parts = raw.split("\\|", -1);
        return parts.length >= 3 ? parts[2] : "";
    }

    private boolean isValidMissionKey() {
        return missionKey != null && !missionKey.trim().isEmpty() && getMeshKey() != null;
    }

    private String getKeyProofToken() {
        SecretKeySpec meshKey = getMeshKey();
        if (meshKey == null || missionKey == null || missionKey.trim().isEmpty()) {
            return "";
        }
        try {
            Mac hmac = Mac.getInstance("HmacSHA256");
            hmac.init(new SecretKeySpec(meshKey.getEncoded(), "HmacSHA256"));
            byte[] macBytes = hmac.doFinal("FIELDLINK_PRECONNECT_GATE_v1".getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder("K");
            for (int i = 0; i < 6 && i < macBytes.length; i++) {
                sb.append(String.format("%02X", macBytes[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private boolean isPeerKeyAuthorized(String endpointName) {
        if (!isValidMissionKey()) {
            return false;
        }
        String peerProof = parseKeyProof(endpointName);
        String expectedProof = getKeyProofToken();
        if (peerProof.isEmpty() || expectedProof.isEmpty()) {
            return false;
        }
        return MessageDigest.isEqual(
            peerProof.getBytes(StandardCharsets.UTF_8),
            expectedProof.getBytes(StandardCharsets.UTF_8)
        );
    }

    private String buildAdvertisedEndpointName() {
        return localCallsign + "|" + localNodeId + "|" + getKeyProofToken();
    }

    private synchronized SecretKeySpec getMeshKey() {
        if (derivedKeySpec == null) {
            try {
                try {
                    KeySpec spec = new PBEKeySpec(missionKey.toCharArray(), KDF_SALT, KDF_ITERATIONS, 256);
                    SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
                    byte[] keyBytes = factory.generateSecret(spec).getEncoded();
                    derivedKeySpec = new SecretKeySpec(keyBytes, "AES");
                } catch (Exception pbkdfFallback) {
                    MessageDigest sha = MessageDigest.getInstance("SHA-256");
                    sha.update(KDF_SALT);
                    byte[] keyBytes = sha.digest(missionKey.getBytes(StandardCharsets.UTF_8));
                    derivedKeySpec = new SecretKeySpec(keyBytes, "AES");
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to derive AES-256 key: " + e.getMessage());
            }
        }
        return derivedKeySpec;
    }

    public synchronized void updateMissionKey(String key) {
        if (key != null && !key.trim().isEmpty()) {
            this.missionKey = key.trim();
            this.derivedKeySpec = null;
            getMeshKey();
            try {
                SharedPreferences prefs = getContext().getSharedPreferences("fieldlink_security", Context.MODE_PRIVATE);
                SharedPreferences.Editor editor = prefs.edit();
                try {
                    String wrapped = wrapMissionKeyForStorage(this.missionKey);
                    editor.putString(PREF_KEY_ENC, wrapped).remove("mission_key");
                } catch (Exception ksErr) {
                    Log.w(TAG, "Keystore wrap fallback: " + ksErr.getMessage());
                    editor.putString("mission_key", this.missionKey);
                }
                editor.apply();
            } catch (Exception ignored) {}
            Log.d(TAG, "Tactical mesh mission key updated and secured");
        }
    }

    private void loadPersistedSecurityState() {
        try {
            SharedPreferences prefs = getContext().getSharedPreferences("fieldlink_security", Context.MODE_PRIVATE);
            String wrappedKey = prefs.getString(PREF_KEY_ENC, null);
            String legacyPlainKey = prefs.getString("mission_key", null);
            if (wrappedKey != null && !wrappedKey.isEmpty()) {
                try {
                    String restored = unwrapMissionKeyFromStorage(wrappedKey);
                    if (!restored.trim().isEmpty()) {
                        this.missionKey = restored.trim();
                        this.derivedKeySpec = null;
                    }
                } catch (Exception ksErr) {
                    Log.w(TAG, "Failed to unwrap Keystore mission key: " + ksErr.getMessage());
                }
            } else if (legacyPlainKey != null && !legacyPlainKey.trim().isEmpty()) {
                // Migrate legacy plaintext mission key into AndroidKeyStore encryption at rest
                this.missionKey = legacyPlainKey.trim();
                this.derivedKeySpec = null;
                try {
                    String wrapped = wrapMissionKeyForStorage(this.missionKey);
                    prefs.edit().putString(PREF_KEY_ENC, wrapped).remove("mission_key").apply();
                } catch (Exception ignored) {}
            }
            String id = prefs.getString("node_id", null);
            if (id == null || id.isEmpty()) {
                id = "NODE-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
                prefs.edit().putString("node_id", id).apply();
            }
            this.localNodeId = id;
            String savedCallsign = prefs.getString("callsign", null);
            if (savedCallsign != null && !savedCallsign.trim().isEmpty()) {
                this.localCallsign = savedCallsign.trim().toUpperCase();
            }
            Log.d(TAG, "Loaded security profile: Callsign=" + localCallsign + ", NodeId=" + localNodeId + ", CustomKey=" + !isDefaultMissionKey());
        } catch (Exception e) {
            this.localNodeId = "NODE-" + System.currentTimeMillis();
        }
    }

    private void persistCallsign(String callsign) {
        try {
            if (callsign == null || callsign.trim().isEmpty()) return;
            SharedPreferences prefs = getContext().getSharedPreferences("fieldlink_security", Context.MODE_PRIVATE);
            prefs.edit().putString("callsign", callsign.trim().toUpperCase()).apply();
        } catch (Exception ignored) {}
    }

    static byte[] encryptWithActiveKey(Context ctx, byte[] plaintext) throws Exception {
        FieldlinkNearbyPlugin inst = activeInstance;
        if (inst != null) {
            return inst.encryptTacticalPayload(plaintext);
        }
        throw new IllegalStateException("Nearby security context not initialized");
    }

    static byte[] decryptWithActiveKey(Context ctx, byte[] packet) throws Exception {
        FieldlinkNearbyPlugin inst = activeInstance;
        if (inst != null) {
            return inst.decryptTacticalPayload(packet);
        }
        throw new IllegalStateException("Nearby security context not initialized");
    }

    private boolean isDefaultMissionKey() {
        return "FIELDLINK-MISSION-ALPHA-2026".equals(missionKey);
    }

    private void sendEncryptedToSinglePeer(String endpointId, JSONObject msg) {
        try {
            byte[] plaintext = msg.toString().getBytes(StandardCharsets.UTF_8);
            byte[] encrypted = encryptTacticalPayload(plaintext);
            sendExecutor.execute(() -> {
                try {
                    connectionsClient.sendPayload(endpointId, Payload.fromBytes(encrypted));
                } catch (Exception e) {
                    Log.w(TAG, "Failed to send encrypted packet to peer " + endpointId + ": " + e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "Failed to encrypt packet for peer " + endpointId + ": " + e.getMessage());
        }
    }

    private byte[] encryptTacticalPayload(byte[] plaintext) throws Exception {
        byte[] iv = new byte[GCM_IV_LENGTH];
        secureRandom.nextBytes(iv);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
        cipher.init(Cipher.ENCRYPT_MODE, getMeshKey(), spec);
        byte[] ciphertext = cipher.doFinal(plaintext);

        byte[] packet = new byte[MAGIC_HEADER.length + iv.length + ciphertext.length];
        System.arraycopy(MAGIC_HEADER, 0, packet, 0, MAGIC_HEADER.length);
        System.arraycopy(iv, 0, packet, MAGIC_HEADER.length, iv.length);
        System.arraycopy(ciphertext, 0, packet, MAGIC_HEADER.length + iv.length, ciphertext.length);
        return packet;
    }

    private byte[] decryptTacticalPayload(byte[] packet) throws Exception {
        if (packet == null || packet.length < MAGIC_HEADER.length + GCM_IV_LENGTH + 16) {
            throw new IllegalArgumentException("Packet too short for authenticated tactical envelope");
        }

        if (packet[0] == MAGIC_HEADER[0] && packet[1] == MAGIC_HEADER[1] && packet[2] == MAGIC_HEADER[2]) {
            byte[] iv = new byte[GCM_IV_LENGTH];
            System.arraycopy(packet, MAGIC_HEADER.length, iv, 0, GCM_IV_LENGTH);

            int cipherOffset = MAGIC_HEADER.length + GCM_IV_LENGTH;
            int cipherLen = packet.length - cipherOffset;

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
            cipher.init(Cipher.DECRYPT_MODE, getMeshKey(), spec);
            return cipher.doFinal(packet, cipherOffset, cipherLen);
        }

        throw new SecurityException("Unauthenticated packet: missing valid tactical cipher header");
    }

    private String generateAuthoritySig(String type, String id, long timestamp) {
        try {
            Mac hmac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKey = new SecretKeySpec(missionKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            hmac.init(secretKey);
            String data = type + ":" + id + ":" + timestamp;
            byte[] hash = hmac.doFinal(data.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return "sig_error";
        }
    }

    /**
     * Unified non-blocking encrypted transmitter supporting targeted direct sync
     * and optional single RF-resilient retry for discrete control/marker packets.
     */
    private int dispatchEncrypted(JSONObject msg, String targetEndpointId, boolean withRetry) throws Exception {
        if (connectedEndpoints.isEmpty()) {
            return 0;
        }
        byte[] plaintext = msg.toString().getBytes(StandardCharsets.UTF_8);
        byte[] encrypted = encryptTacticalPayload(plaintext);

        if (targetEndpointId != null && !targetEndpointId.isEmpty()) {
            if (!connectedEndpoints.contains(targetEndpointId)) {
                return 0;
            }
            sendExecutor.execute(() -> {
                try {
                    connectionsClient.sendPayload(targetEndpointId, Payload.fromBytes(encrypted));
                } catch (Exception ignored) {}
            });
            if (withRetry && !burstScheduler.isShutdown()) {
                burstScheduler.schedule(() -> {
                    if (!connectedEndpoints.contains(targetEndpointId)) return;
                    sendExecutor.execute(() -> {
                        try {
                            connectionsClient.sendPayload(targetEndpointId, Payload.fromBytes(encrypted));
                        } catch (Exception ignored) {}
                    });
                }, 140, TimeUnit.MILLISECONDS);
            }
            return 1;
        }

        List<String> endpoints = new ArrayList<>(connectedEndpoints);
        sendExecutor.execute(() -> {
            try {
                connectionsClient.sendPayload(endpoints, Payload.fromBytes(encrypted));
            } catch (Exception ignored) {}
        });

        if (withRetry && !burstScheduler.isShutdown()) {
            burstScheduler.schedule(() -> {
                List<String> retryEndpoints = new ArrayList<>(connectedEndpoints);
                if (retryEndpoints.isEmpty()) return;
                sendExecutor.execute(() -> {
                    try {
                        connectionsClient.sendPayload(retryEndpoints, Payload.fromBytes(encrypted));
                    } catch (Exception ignored) {}
                });
            }, 140, TimeUnit.MILLISECONDS);
        }
        return endpoints.size();
    }

    private void sendAuthHelloToEndpoint(String endpointId) {
        try {
            long now = System.currentTimeMillis();
            JSONObject hello = new JSONObject();
            hello.put("msgId", "hello_" + localNodeId + "_" + now);
            hello.put("ttl", 1);
            hello.put("type", "MESH_AUTH_HELLO");
            hello.put("callsign", localCallsign);
            hello.put("nodeId", localNodeId);
            hello.put("timestamp", now);
            hello.put("sig", generateAuthoritySig("MESH_AUTH_HELLO", localNodeId, now));
            sendEncryptedToSinglePeer(endpointId, hello);
        } catch (Exception ignored) {}
    }

    private boolean isDuplicateAndMark(String msgId) {
        if (msgId == null || msgId.isEmpty()) return false;
        long now = System.currentTimeMillis();
        synchronized (seenMessageIds) {
            if (seenMessageIds.containsKey(msgId)) {
                return true;
            }
            seenMessageIds.put(msgId, now);
            return false;
        }
    }

    @Override
    public void load() {
        activeInstance = this;
        connectionsClient = Nearby.getConnectionsClient(getContext());
        loadPersistedSecurityState();
        if (reconcileFuture == null || reconcileFuture.isCancelled()) {
            reconcileFuture = burstScheduler.scheduleAtFixedRate(
                this::reconcileClusterLinks,
                5,
                5,
                TimeUnit.SECONDS
            );
        }
    }

    private boolean hasLocationPermissions() {
        return ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            boolean scan = ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
            boolean advertise = ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED;
            boolean connect = ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
            return scan && advertise && connect;
        }
        return true;
    }

    private boolean hasAllMeshPermissions() {
        boolean nearbyWifi = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED;
        return hasLocationPermissions() && hasBluetoothPermissions() && nearbyWifi;
    }

    private void attemptPeerConnection(String endpointId, DiscoveredEndpointInfo info, boolean isManualLink) {
        if (connectionsClient == null || endpointId == null || info == null) return;
        if (connectedEndpoints.contains(endpointId) || pendingConnections.contains(endpointId)) return;

        // Pre-connect Mission Key check: never auto-connect or handshake with invalid/mismatched peers
        if (!isPeerKeyAuthorized(info.getEndpointName())) {
            Log.w(TAG, "Blocked connection attempt to " + parseCallsign(info.getEndpointName()) + " (" + endpointId + "): invalid or mismatched passkey");
            return;
        }

        int maxCap = isManualLink ? MAX_HARD_DIRECT_LINKS : MAX_AUTO_DIRECT_LINKS;
        if (connectedEndpoints.size() + pendingConnections.size() >= maxCap) {
            return;
        }

        long now = System.currentTimeMillis();
        if (!isManualLink) {
            Long retryAfter = peerRetryAfterMs.get(endpointId);
            if (retryAfter != null && now < retryAfter) {
                return;
            }
        }

        pendingConnections.add(endpointId);
        String advertisedName = buildAdvertisedEndpointName();
        connectionsClient.requestConnection(advertisedName, endpointId, connectionLifecycleCallback)
            .addOnSuccessListener(aVoid -> {
                peerRetryCount.remove(endpointId);
                peerRetryAfterMs.remove(endpointId);
            })
            .addOnFailureListener(e -> {
                pendingConnections.remove(endpointId);
                if (e instanceof ApiException && ((ApiException) e).getStatusCode() == ConnectionsStatusCodes.STATUS_ALREADY_CONNECTED_TO_ENDPOINT) {
                    return;
                }
                int attempts = peerRetryCount.getOrDefault(endpointId, 0) + 1;
                peerRetryCount.put(endpointId, attempts);
                long backoffMs = Math.min(30000L, 3000L * (1L << Math.min(attempts - 1, 3)));
                peerRetryAfterMs.put(endpointId, System.currentTimeMillis() + backoffMs);
                Log.w(TAG, "Nearby requestConnection failed (" + endpointId + "), backoff " + backoffMs + "ms: " + e.getMessage());
            });
    }

    private void reconcileClusterLinks() {
        try {
            if (connectionsClient == null || !isDiscovering || discoveredPeers.isEmpty() || !isValidMissionKey()) {
                return;
            }
            if ((connectedEndpoints.size() + pendingConnections.size()) >= MAX_AUTO_DIRECT_LINKS) {
                return;
            }
            long now = System.currentTimeMillis();
            for (Map.Entry<String, DiscoveredEndpointInfo> entry : discoveredPeers.entrySet()) {
                if ((connectedEndpoints.size() + pendingConnections.size()) >= MAX_AUTO_DIRECT_LINKS) {
                    break;
                }
                String endpointId = entry.getKey();
                if (connectedEndpoints.contains(endpointId) || pendingConnections.contains(endpointId)) {
                    continue;
                }
                DiscoveredEndpointInfo info = entry.getValue();
                if (!isPeerKeyAuthorized(info.getEndpointName())) {
                    continue;
                }
                Long retryAfter = peerRetryAfterMs.get(endpointId);
                if (retryAfter != null && now < retryAfter) {
                    continue;
                }
                String peerNode = parseNodeId(info.getEndpointName());
                long foundAt = peerDiscoveredAtMs.getOrDefault(endpointId, now);
                boolean isPrimaryInitiator = peerNode.isEmpty() || localNodeId.compareTo(peerNode) > 0;
                // Fallback: if asymmetry stalled > 16s without connecting, allow either side to initiate
                boolean timedOutWaitingForPeer = (now - foundAt) > 16000L;
                if (isPrimaryInitiator || timedOutWaitingForPeer) {
                    attemptPeerConnection(endpointId, info, false);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Cluster link reconciler warning: " + e.getMessage());
        }
    }

    @PluginMethod
    public void requestMeshPermissions(PluginCall call) {
        if (hasAllMeshPermissions()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }

        List<String> aliases = new ArrayList<>();
        aliases.add("location");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            aliases.add("bluetooth_s");
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            aliases.add("nearby_t");
        }
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "meshPermCallback");
    }

    @PermissionCallback
    private void meshPermCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasAllMeshPermissions());
        call.resolve(ret);
    }

    @PluginMethod
    public void setMissionKey(PluginCall call) {
        String key = call.getString("key");
        if (key != null && !key.trim().isEmpty()) {
            updateMissionKey(key);

            // Immediately sever links established under the previous key so unauthorized nodes stay disconnected
            List<String> oldEndpoints = new ArrayList<>(connectedEndpoints);
            if (connectionsClient != null) {
                for (String endpointId : oldEndpoints) {
                    try {
                        connectionsClient.disconnectFromEndpoint(endpointId);
                    } catch (Exception ignored) {}
                }
            }
            connectedEndpoints.clear();
            pendingConnections.clear();
            mismatchedEndpoints.clear();
            endpointCallsigns.clear();
            endpointNodeIds.clear();
            peerRetryCount.clear();
            peerRetryAfterMs.clear();
            cryptoNotifyLastMs.clear();

            // Re-advertise under the updated passkey proof token and reconcile matching discovered peers
            if (connectionsClient != null && isAdvertising) {
                connectionsClient.stopAdvertising();
                isAdvertising = false;
                AdvertisingOptions options = new AdvertisingOptions.Builder().setStrategy(STRATEGY).build();
                connectionsClient.startAdvertising(buildAdvertisedEndpointName(), SERVICE_ID, connectionLifecycleCallback, options)
                    .addOnSuccessListener(aVoid -> isAdvertising = true);
            }

            if (!burstScheduler.isShutdown()) {
                burstScheduler.schedule(this::reconcileClusterLinks, 250, TimeUnit.MILLISECONDS);
            }

            JSObject rotated = new JSObject();
            rotated.put("isDefaultMissionKey", isDefaultMissionKey());
            notifyListeners("missionKeyRotated", rotated);

            JSObject ret = new JSObject();
            ret.put("status", "updated");
            ret.put("isDefaultMissionKey", isDefaultMissionKey());
            call.resolve(ret);
        } else {
            call.reject("Mission key cannot be empty");
        }
    }

    @PluginMethod
    public void updateCallsign(PluginCall call) {
        String newCallsign = call.getString("callsign");
        if (newCallsign == null || newCallsign.trim().isEmpty()) {
            call.reject("Callsign cannot be empty");
            return;
        }
        String oldCallsign = this.localCallsign;
        this.localCallsign = newCallsign.trim().toUpperCase();
        persistCallsign(this.localCallsign);

        // Broadcast CALLSIGN_UPDATE across mesh so connected peers seamlessly rename node
        try {
            long now = System.currentTimeMillis();
            String msgId = "cs_" + localNodeId + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 4);
            msg.put("type", "CALLSIGN_UPDATE");
            msg.put("callsign", this.localCallsign);
            msg.put("oldCallsign", oldCallsign);
            msg.put("nodeId", localNodeId);
            msg.put("timestamp", now);
            dispatchEncrypted(msg, null, true);
        } catch (Exception ignored) {}

        // Restart advertising under updated callsign for new peer discoveries
        if (connectionsClient != null && isAdvertising) {
            connectionsClient.stopAdvertising();
            isAdvertising = false;
            AdvertisingOptions options = new AdvertisingOptions.Builder().setStrategy(STRATEGY).build();
            String advertisedName = buildAdvertisedEndpointName();
            connectionsClient.startAdvertising(advertisedName, SERVICE_ID, connectionLifecycleCallback, options)
                .addOnSuccessListener(aVoid -> isAdvertising = true);
        }

        JSObject ret = new JSObject();
        ret.put("callsign", this.localCallsign);
        ret.put("oldCallsign", oldCallsign);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkMeshStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isAdvertising", isAdvertising);
        ret.put("isDiscovering", isDiscovering);
        ret.put("connectedCount", connectedEndpoints.size());
        ret.put("pendingCount", pendingConnections.size());
        ret.put("mismatchedCount", mismatchedEndpoints.size());
        ret.put("hasPermissions", hasAllMeshPermissions());
        ret.put("callsign", localCallsign);
        ret.put("nodeId", localNodeId);
        ret.put("isDefaultMissionKey", isDefaultMissionKey());
        ret.put("hasCustomMissionKey", !isDefaultMissionKey());
        ret.put("missionKey", isDefaultMissionKey() ? "DEFAULT (Alpha 2026)" : maskMissionKey(missionKey));

        JSArray pendingArray = new JSArray();
        for (String pendingId : pendingConnections) {
            pendingArray.put(pendingId);
        }
        ret.put("pendingEndpoints", pendingArray);

        JSArray connectedDetails = new JSArray();
        for (String epId : connectedEndpoints) {
            JSObject ep = new JSObject();
            ep.put("endpointId", epId);
            ep.put("callsign", endpointCallsigns.getOrDefault(epId, "OPERATOR"));
            ep.put("nodeId", endpointNodeIds.getOrDefault(epId, ""));
            ep.put("keyMismatch", mismatchedEndpoints.contains(epId));
            connectedDetails.put(ep);
        }
        ret.put("connectedEndpoints", connectedDetails);

        JSArray peerArray = new JSArray();
        for (Map.Entry<String, DiscoveredEndpointInfo> entry : discoveredPeers.entrySet()) {
            if (connectedEndpoints.contains(entry.getKey())) {
                continue;
            }
            JSObject p = new JSObject();
            p.put("endpointId", entry.getKey());
            p.put("callsign", parseCallsign(entry.getValue().getEndpointName()));
            p.put("nodeId", parseNodeId(entry.getValue().getEndpointName()));
            p.put("isPending", pendingConnections.contains(entry.getKey()));
            p.put("keyMismatch", !isPeerKeyAuthorized(entry.getValue().getEndpointName()));
            peerArray.put(p);
        }
        ret.put("discoveredPeers", peerArray);

        call.resolve(ret);
    }

    @PluginMethod
    public void startAdvertising(PluginCall call) {
        if (!isValidMissionKey()) {
            call.reject("Invalid Mission Key; cannot advertise cluster node.");
            return;
        }
        String callsign = call.getString("callsign", localCallsign);
        localCallsign = callsign.trim().isEmpty() ? localCallsign : callsign.trim().toUpperCase();
        persistCallsign(localCallsign);

        AdvertisingOptions options = new AdvertisingOptions.Builder().setStrategy(STRATEGY).build();
        String advertisedName = buildAdvertisedEndpointName();

        connectionsClient.startAdvertising(advertisedName, SERVICE_ID, connectionLifecycleCallback, options)
            .addOnSuccessListener(aVoid -> {
                isAdvertising = true;
                Log.d(TAG, "Started Nearby advertising with callsign: " + localCallsign);
                JSObject ret = new JSObject();
                ret.put("status", "advertising");
                ret.put("callsign", localCallsign);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> {
                if (e instanceof ApiException && ((ApiException) e).getStatusCode() == ConnectionsStatusCodes.STATUS_ALREADY_ADVERTISING) {
                    isAdvertising = true;
                    Log.d(TAG, "Nearby advertising already active with callsign: " + localCallsign);
                    JSObject ret = new JSObject();
                    ret.put("status", "advertising");
                    ret.put("callsign", localCallsign);
                    call.resolve(ret);
                    return;
                }
                Log.w(TAG, "Failed Nearby advertising: " + e.getMessage());
                call.reject("Advertising failed: " + e.getMessage());
            });
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        DiscoveryOptions options = new DiscoveryOptions.Builder().setStrategy(STRATEGY).build();

        connectionsClient.startDiscovery(SERVICE_ID, endpointDiscoveryCallback, options)
            .addOnSuccessListener(aVoid -> {
                isDiscovering = true;
                Log.d(TAG, "Started Nearby discovery for FIELDLINK mesh peers");
                JSObject ret = new JSObject();
                ret.put("status", "discovering");
                call.resolve(ret);
            })
            .addOnFailureListener(e -> {
                if (e instanceof ApiException && ((ApiException) e).getStatusCode() == ConnectionsStatusCodes.STATUS_ALREADY_DISCOVERING) {
                    isDiscovering = true;
                    Log.d(TAG, "Nearby discovery already active for FIELDLINK mesh peers");
                    JSObject ret = new JSObject();
                    ret.put("status", "discovering");
                    call.resolve(ret);
                    return;
                }
                Log.w(TAG, "Failed Nearby discovery: " + e.getMessage());
                call.reject("Discovery failed: " + e.getMessage());
            });
    }

    @PluginMethod
    public void connectToPeer(PluginCall call) {
        if (!isValidMissionKey()) {
            call.reject("Invalid Mission Key; cannot connect to peer.");
            return;
        }
        String endpointId = call.getString("endpointId");
        if (endpointId == null) {
            call.reject("Missing endpointId");
            return;
        }
        DiscoveredEndpointInfo discoveredInfo = discoveredPeers.get(endpointId);
        if (discoveredInfo == null || !isPeerKeyAuthorized(discoveredInfo.getEndpointName())) {
            String targetName = discoveredInfo != null ? parseCallsign(discoveredInfo.getEndpointName()) : endpointId;
            call.reject("Mission Key does not match peer " + targetName + "; connection blocked.");
            return;
        }
        if (connectedEndpoints.contains(endpointId)) {
            JSObject ret = new JSObject();
            ret.put("status", "connected");
            ret.put("endpointId", endpointId);
            call.resolve(ret);
            return;
        }
        if (pendingConnections.contains(endpointId)) {
            JSObject ret = new JSObject();
            ret.put("status", "pending");
            ret.put("endpointId", endpointId);
            call.resolve(ret);
            return;
        }
        if (connectedEndpoints.size() + pendingConnections.size() >= MAX_HARD_DIRECT_LINKS) {
            call.reject("Direct radio link limit reached (" + MAX_HARD_DIRECT_LINKS + "); peer traffic will route via cluster relays.");
            return;
        }

        pendingConnections.add(endpointId);
        peerRetryAfterMs.remove(endpointId);
        String advertisedName = buildAdvertisedEndpointName();
        connectionsClient.requestConnection(advertisedName, endpointId, connectionLifecycleCallback)
            .addOnSuccessListener(aVoid -> {
                peerRetryCount.remove(endpointId);
                JSObject ret = new JSObject();
                ret.put("status", "requested");
                ret.put("endpointId", endpointId);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> {
                pendingConnections.remove(endpointId);
                call.reject("Failed to request peer connection: " + e.getMessage());
            });
    }

    @PluginMethod
    public void broadcastSquadTelemetry(PluginCall call) {
        try {
            String callsign = call.getString("callsign", localCallsign);
            String targetEndpointId = call.getString("targetEndpointId", null);
            long now = System.currentTimeMillis();
            String msgId = "telem_" + localNodeId + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 4);
            msg.put("type", "SQUAD_TELEMETRY");
            msg.put("callsign", callsign);
            msg.put("nodeId", localNodeId);
            msg.put("lat", call.getDouble("lat", 0.0));
            msg.put("lon", call.getDouble("lon", 0.0));
            msg.put("alt", call.getDouble("alt", 0.0));
            msg.put("heading", call.getDouble("heading", 0.0));
            msg.put("speed", call.getDouble("speed", 0.0));
            msg.put("status", call.getString("status", "CONNECTED"));
            msg.put("accuracy", call.getDouble("accuracy", 0.0));
            msg.put("fixType", call.getString("fixType", "GNSS_3D"));
            msg.put("isLeader", call.getBoolean("isLeader", false));
            msg.put("clusterLeader", call.getString("clusterLeader", ""));
            msg.put("timestamp", now);

            // Periodic telemetry uses single non-burst transmit to keep multi-node airtime clear
            int sent = dispatchEncrypted(msg, targetEndpointId, false);

            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error broadcasting telemetry: " + e.getMessage());
        }
    }

    @PluginMethod
    public void broadcastLeaderClaim(PluginCall call) {
        try {
            String callsign = call.getString("callsign", localCallsign);
            String targetEndpointId = call.getString("targetEndpointId", null);
            boolean isLeader = call.getBoolean("isLeader", false);
            String leaderCallsign = call.getString("clusterLeader", isLeader ? callsign : "");
            long now = System.currentTimeMillis();
            String type = isLeader ? "LEADER_CLAIM" : "LEADER_ABDICATE";
            String msgId = (isLeader ? "claim_" : "abdicate_") + localNodeId + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 5);
            msg.put("type", type);
            msg.put("callsign", callsign);
            msg.put("nodeId", localNodeId);
            msg.put("isLeader", isLeader);
            msg.put("clusterLeader", leaderCallsign);
            msg.put("timestamp", now);
            msg.put("sig", generateAuthoritySig(type, leaderCallsign, now));

            int sent = dispatchEncrypted(msg, targetEndpointId, true);

            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            ret.put("type", type);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error broadcasting leader claim: " + e.getMessage());
        }
    }

    @PluginMethod
    public void broadcastWaypoint(PluginCall call) {
        try {
            String callsign = call.getString("callsign", localCallsign);
            String targetEndpointId = call.getString("targetEndpointId", null);
            long now = System.currentTimeMillis();
            String wpId = call.getString("id", "wp-" + now);
            String msgId = "wp_" + wpId + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 4);
            msg.put("type", "WAYPOINT_BROADCAST");
            msg.put("callsign", callsign);
            msg.put("createdBy", call.getString("createdBy", callsign));
            msg.put("nodeId", localNodeId);
            msg.put("id", wpId);
            msg.put("name", call.getString("name", "POI"));
            msg.put("category", call.getString("category", "RP"));
            msg.put("lat", call.getDouble("lat", 0.0));
            msg.put("lon", call.getDouble("lon", 0.0));
            msg.put("description", call.getString("description", ""));
            msg.put("timestamp", now);

            int sent = dispatchEncrypted(msg, targetEndpointId, targetEndpointId == null);

            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error broadcasting waypoint: " + e.getMessage());
        }
    }

    @PluginMethod
    public void broadcastDeleteWaypoint(PluginCall call) {
        try {
            String callsign = call.getString("callsign", localCallsign);
            String id = call.getString("id", "");
            long now = System.currentTimeMillis();
            String msgId = "del_wp_" + id + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 4);
            msg.put("type", "DELETE_WAYPOINT");
            msg.put("id", id);
            msg.put("callsign", callsign);
            msg.put("deletedBy", callsign);
            msg.put("nodeId", localNodeId);
            msg.put("timestamp", now);
            msg.put("sig", generateAuthoritySig("DELETE_WAYPOINT", id, now));

            int sent = dispatchEncrypted(msg, null, true);

            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error broadcasting delete waypoint: " + e.getMessage());
        }
    }

    @PluginMethod
    public void broadcastDrawing(PluginCall call) {
        try {
            String callsign = call.getString("callsign", localCallsign);
            String targetEndpointId = call.getString("targetEndpointId", null);
            String id = call.getString("id", "draw-" + System.currentTimeMillis());
            long now = System.currentTimeMillis();
            String msgId = "draw_" + id + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 4);
            msg.put("type", "DRAWING_BROADCAST");
            msg.put("id", id);
            msg.put("callsign", callsign);
            msg.put("createdBy", callsign);
            msg.put("nodeId", localNodeId);
            msg.put("points", call.getString("points", "[]"));
            msg.put("color", call.getString("color", "#35D5D9"));
            msg.put("timestamp", now);

            int sent = dispatchEncrypted(msg, targetEndpointId, targetEndpointId == null);

            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error broadcasting drawing: " + e.getMessage());
        }
    }

    @PluginMethod
    public void broadcastDeleteDrawing(PluginCall call) {
        try {
            String callsign = call.getString("callsign", localCallsign);
            String id = call.getString("id", "");
            long now = System.currentTimeMillis();
            String msgId = "del_draw_" + id + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 4);
            msg.put("type", "DELETE_DRAWING");
            msg.put("id", id);
            msg.put("callsign", callsign);
            msg.put("deletedBy", callsign);
            msg.put("nodeId", localNodeId);
            msg.put("timestamp", now);
            msg.put("sig", generateAuthoritySig("DELETE_DRAWING", id, now));

            int sent = dispatchEncrypted(msg, null, true);

            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error broadcasting delete drawing: " + e.getMessage());
        }
    }

    @PluginMethod
    public void broadcastClearAllDrawings(PluginCall call) {
        try {
            String callsign = call.getString("callsign", localCallsign);
            long now = System.currentTimeMillis();
            String msgId = "clear_draws_" + localNodeId + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 4);
            msg.put("type", "CLEAR_ALL_DRAWINGS");
            msg.put("callsign", callsign);
            msg.put("deletedBy", callsign);
            msg.put("nodeId", localNodeId);
            msg.put("timestamp", now);
            msg.put("sig", generateAuthoritySig("CLEAR_ALL_DRAWINGS", "ALL", now));

            int sent = dispatchEncrypted(msg, null, true);

            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error broadcasting clear all drawings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void broadcastTombstones(PluginCall call) {
        try {
            String targetEndpointId = call.getString("targetEndpointId", null);
            JSArray wpIds = call.getArray("waypointIds");
            JSArray drawIds = call.getArray("drawingIds");
            JSONArray wpJson = wpIds != null ? wpIds : new JSONArray();
            JSONArray drJson = drawIds != null ? drawIds : new JSONArray();
            if (wpJson.length() == 0 && drJson.length() == 0) {
                JSObject emptyRet = new JSObject();
                emptyRet.put("sentCount", 0);
                call.resolve(emptyRet);
                return;
            }

            long now = System.currentTimeMillis();
            String msgId = "tomb_" + localNodeId + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 4);
            msg.put("type", "SYNC_TOMBSTONES");
            msg.put("callsign", localCallsign);
            msg.put("nodeId", localNodeId);
            msg.put("waypointIds", wpJson);
            msg.put("drawingIds", drJson);
            msg.put("timestamp", now);
            msg.put("sig", generateAuthoritySig("SYNC_TOMBSTONES", localNodeId, now));

            int sent = dispatchEncrypted(msg, targetEndpointId, false);
            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error broadcasting tombstones: " + e.getMessage());
        }
    }

    @PluginMethod
    public void broadcastRoute(PluginCall call) {
        try {
            String callsign = call.getString("callsign", localCallsign);
            long now = System.currentTimeMillis();
            String msgId = "route_" + localNodeId + "_" + now;
            seenMessageIds.put(msgId, now);

            JSONObject msg = new JSONObject();
            msg.put("msgId", msgId);
            msg.put("ttl", 4);
            msg.put("type", "ROUTE_BROADCAST");
            msg.put("callsign", callsign);
            msg.put("nodeId", localNodeId);
            msg.put("points", call.getString("points", "[]"));
            msg.put("timestamp", now);

            int sent = dispatchEncrypted(msg, null, true);

            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error broadcasting route: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopNearby(PluginCall call) {
        if (connectionsClient != null) {
            connectionsClient.stopAdvertising();
            connectionsClient.stopDiscovery();
            connectionsClient.stopAllEndpoints();
            connectedEndpoints.clear();
            pendingConnections.clear();
            mismatchedEndpoints.clear();
            endpointCallsigns.clear();
            endpointNodeIds.clear();
            discoveredPeers.clear();
            peerDiscoveredAtMs.clear();
            peerRetryAfterMs.clear();
            peerRetryCount.clear();
            isAdvertising = false;
            isDiscovering = false;
        }
        JSObject ret = new JSObject();
        ret.put("status", "stopped");
        call.resolve(ret);
    }

    // Callbacks
    private final ConnectionLifecycleCallback connectionLifecycleCallback = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(@NonNull String endpointId, @NonNull ConnectionInfo info) {
            String peerCallsign = parseCallsign(info.getEndpointName());
            String peerNode = parseNodeId(info.getEndpointName());

            // Pre-connection Mission Key Gate: reject mismatched/invalid passkey peers before any connection is accepted
            if (!isPeerKeyAuthorized(info.getEndpointName())) {
                Log.w(TAG, "Rejected cluster connection from " + peerCallsign + " (" + endpointId + "): passkey invalid or mismatch");
                connectionsClient.rejectConnection(endpointId);
                pendingConnections.remove(endpointId);
                emitCryptoErrorThrottled(
                    endpointId,
                    peerCallsign,
                    peerNode,
                    "PRECONNECT_KEY_MISMATCH",
                    "Blocked connection from " + peerCallsign + ": Mission Key does not match."
                );
                return;
            }

            endpointCallsigns.put(endpointId, peerCallsign);
            if (!peerNode.isEmpty()) {
                endpointNodeIds.put(endpointId, peerNode);
            }
            // Tactical Auto-Accept for squad operators (within hard socket limit)
            if (connectedEndpoints.size() >= MAX_HARD_DIRECT_LINKS) {
                connectionsClient.rejectConnection(endpointId);
                pendingConnections.remove(endpointId);
                return;
            }
            connectionsClient.acceptConnection(endpointId, payloadCallback);

            String authDigits = info.getAuthenticationDigits();
            JSObject obj = new JSObject();
            obj.put("endpointId", endpointId);
            obj.put("callsign", peerCallsign);
            obj.put("nodeId", peerNode);
            obj.put("authDigits", authDigits != null ? authDigits : "");
            notifyListeners("connectionInitiated", obj);
        }

        @Override
        public void onConnectionResult(@NonNull String endpointId, @NonNull ConnectionResolution resolution) {
            pendingConnections.remove(endpointId);
            if (resolution.getStatus().isSuccess()) {
                connectedEndpoints.add(endpointId);
                discoveredPeers.remove(endpointId);
                peerDiscoveredAtMs.remove(endpointId);
                peerRetryAfterMs.remove(endpointId);
                peerRetryCount.remove(endpointId);
                mismatchedEndpoints.remove(endpointId);

                String name = endpointCallsigns.getOrDefault(endpointId, "OPERATOR");
                String peerNode = endpointNodeIds.getOrDefault(endpointId, "");

                // Transmit MESH_AUTH_HELLO handshake challenge-response
                sendAuthHelloToEndpoint(endpointId);

                JSObject obj = new JSObject();
                obj.put("endpointId", endpointId);
                obj.put("callsign", name);
                obj.put("nodeId", peerNode);
                obj.put("status", "CONNECTED");
                notifyListeners("peerConnected", obj);
            } else {
                connectedEndpoints.remove(endpointId);
                int attempts = peerRetryCount.getOrDefault(endpointId, 0) + 1;
                peerRetryCount.put(endpointId, attempts);
                long backoffMs = Math.min(30000L, 3000L * (1L << Math.min(attempts - 1, 3)));
                peerRetryAfterMs.put(endpointId, System.currentTimeMillis() + backoffMs);

                JSObject obj = new JSObject();
                obj.put("endpointId", endpointId);
                obj.put("callsign", endpointCallsigns.getOrDefault(endpointId, "OPERATOR"));
                obj.put("status", "FAILED");
                notifyListeners("peerConnectionFailed", obj);
            }
        }

        @Override
        public void onDisconnected(@NonNull String endpointId) {
            pendingConnections.remove(endpointId);
            connectedEndpoints.remove(endpointId);
            mismatchedEndpoints.remove(endpointId);
            String name = endpointCallsigns.remove(endpointId);
            String peerNode = endpointNodeIds.remove(endpointId);
            if (name != null && (peerNode == null || peerNode.equals(callsignToNodeId.get(name)))) {
                callsignToNodeId.remove(name);
            }

            JSObject obj = new JSObject();
            obj.put("endpointId", endpointId);
            obj.put("callsign", name != null ? name : "OPERATOR");
            obj.put("nodeId", peerNode != null ? peerNode : "");
            obj.put("remainingConnectedCount", connectedEndpoints.size());
            obj.put("status", "DISCONNECTED");
            notifyListeners("peerDisconnected", obj);
        }
    };

    private final EndpointDiscoveryCallback endpointDiscoveryCallback = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(@NonNull String endpointId, @NonNull DiscoveredEndpointInfo info) {
            discoveredPeers.put(endpointId, info);
            peerDiscoveredAtMs.putIfAbsent(endpointId, System.currentTimeMillis());
            String rawName = info.getEndpointName();
            String peerCallsign = parseCallsign(rawName);
            String peerNode = parseNodeId(rawName);
            boolean keyAuthorized = isPeerKeyAuthorized(rawName);
            if (keyAuthorized && !peerNode.isEmpty()) {
                endpointNodeIds.put(endpointId, peerNode);
            }

            JSObject obj = new JSObject();
            obj.put("endpointId", endpointId);
            obj.put("callsign", peerCallsign);
            obj.put("nodeId", peerNode);
            obj.put("keyMismatch", !keyAuthorized);
            notifyListeners("peerDiscovered", obj);

            if (!keyAuthorized) {
                Log.w(TAG, "Blocked auto-connect to discovered peer " + peerCallsign + " (" + endpointId + "): passkey invalid or mismatch");
                return;
            }

            // Asymmetric Initiator Rule with bounded direct-link cap (reconciler handles multi-hop/retries)
            boolean isInitiator = peerNode.isEmpty() || localNodeId.compareTo(peerNode) > 0;
            if (isInitiator) {
                attemptPeerConnection(endpointId, info, false);
            }
        }

        @Override
        public void onEndpointLost(@NonNull String endpointId) {
            discoveredPeers.remove(endpointId);
            peerDiscoveredAtMs.remove(endpointId);
            peerRetryAfterMs.remove(endpointId);
            peerRetryCount.remove(endpointId);
            pendingConnections.remove(endpointId);
            JSObject obj = new JSObject();
            obj.put("endpointId", endpointId);
            notifyListeners("peerLost", obj);
        }
    };

    private final PayloadCallback payloadCallback = new PayloadCallback() {
        @Override
        public void onPayloadReceived(@NonNull String endpointId, @NonNull Payload payload) {
            if (payload.getType() == Payload.Type.BYTES && payload.asBytes() != null) {
                try {
                    byte[] decryptedBytes = decryptTacticalPayload(payload.asBytes());
                    mismatchedEndpoints.remove(endpointId);
                    String jsonStr = new String(decryptedBytes, StandardCharsets.UTF_8);
                    JSONObject json = new JSONObject(jsonStr);

                    String msgId = json.optString("msgId", "");
                    if (msgId.isEmpty()) {
                        msgId = json.optString("callsign", "") + "_" + json.optLong("timestamp", System.currentTimeMillis());
                    }

                    // Check deduplication ring buffer: drop if already seen
                    if (isDuplicateAndMark(msgId)) {
                        return;
                    }

                    String type = json.optString("type", "UNKNOWN");
                    String peerNodeId = json.optString("nodeId", endpointNodeIds.getOrDefault(endpointId, ""));
                    String rawOriginCallsign = json.optString("callsign", "");
                    if (rawOriginCallsign.isEmpty()) {
                        rawOriginCallsign = json.optString("createdBy", "");
                    }
                    if (rawOriginCallsign.isEmpty()) {
                        rawOriginCallsign = json.optString("deletedBy", "");
                    }
                    if (rawOriginCallsign.isEmpty() && !peerNodeId.isEmpty()) {
                        rawOriginCallsign = nodeIdToCallsign.getOrDefault(peerNodeId, "");
                    }
                    if (rawOriginCallsign.isEmpty()) {
                        rawOriginCallsign = endpointCallsigns.getOrDefault(endpointId, "OPERATOR");
                    }
                    String effectiveCallsign = rawOriginCallsign;

                    // Node Identity Verification (SEC-02) with safe callsign rename + duplicate-callsign disambiguation
                    if (!peerNodeId.isEmpty()) {
                        String oldBoundCallsign = nodeIdToCallsign.get(peerNodeId);
                        if ("CALLSIGN_UPDATE".equals(type) && oldBoundCallsign != null && !oldBoundCallsign.equals(rawOriginCallsign)) {
                            if (peerNodeId.equals(callsignToNodeId.get(oldBoundCallsign))) {
                                callsignToNodeId.remove(oldBoundCallsign);
                            }
                        }
                        String boundNode = callsignToNodeId.putIfAbsent(rawOriginCallsign, peerNodeId);
                        if (boundNode != null && !boundNode.equals(peerNodeId)) {
                            // Two distinct nodes currently share the same callsign: disambiguate cleanly by nodeId suffix
                            String suffix = peerNodeId.length() > 4 ? peerNodeId.substring(peerNodeId.length() - 4) : peerNodeId;
                            effectiveCallsign = rawOriginCallsign + "-" + suffix;
                            Log.w(TAG, "Callsign collision detected for " + rawOriginCallsign + "; separating node " + peerNodeId + " as " + effectiveCallsign);
                        }
                        nodeIdToCallsign.put(peerNodeId, rawOriginCallsign);
                        // Only update direct neighbor mapping when the packet originated on that link (not relayed)
                        String directNodeId = endpointNodeIds.get(endpointId);
                        if (directNodeId == null || directNodeId.isEmpty() || directNodeId.equals(peerNodeId)) {
                            endpointCallsigns.put(endpointId, effectiveCallsign);
                            endpointNodeIds.put(endpointId, peerNodeId);
                        }
                    }

                    // Multi-Hop Mesh Gossip Relay (non-blocking forward to sibling links)
                    int ttl = json.optInt("ttl", 1);
                    if (ttl > 1 && connectedEndpoints.size() > 1) {
                        List<String> fwdEndpoints = new ArrayList<>(connectedEndpoints.size() - 1);
                        for (String otherEndpoint : connectedEndpoints) {
                            if (!otherEndpoint.equals(endpointId) && !mismatchedEndpoints.contains(otherEndpoint)) {
                                fwdEndpoints.add(otherEndpoint);
                            }
                        }
                        if (!fwdEndpoints.isEmpty()) {
                            json.put("ttl", ttl - 1);
                            byte[] fwdPlaintext = json.toString().getBytes(StandardCharsets.UTF_8);
                            byte[] fwdEncrypted = encryptTacticalPayload(fwdPlaintext);
                            sendExecutor.execute(() -> {
                                try {
                                    connectionsClient.sendPayload(fwdEndpoints, Payload.fromBytes(fwdEncrypted));
                                } catch (Exception ignored) {}
                            });
                        }
                    }

                    if ("MESH_AUTH_HELLO".equals(type)) {
                        Log.d(TAG, "Authenticated peer via MESH_AUTH_HELLO: " + effectiveCallsign + " [" + peerNodeId + "]");
                        return;
                    }

                    // Administrative Authority & Freshness Verification (Anti-Replay)
                    if ("DELETE_WAYPOINT".equals(type) || "DELETE_DRAWING".equals(type) || "CLEAR_ALL_DRAWINGS".equals(type)
                        || "LEADER_CLAIM".equals(type) || "LEADER_ABDICATE".equals(type) || "SYNC_TOMBSTONES".equals(type)) {
                        String sig = json.optString("sig", "");
                        String id = "CLEAR_ALL_DRAWINGS".equals(type) ? "ALL"
                                  : ("LEADER_CLAIM".equals(type) || "LEADER_ABDICATE".equals(type)) ? json.optString("clusterLeader", rawOriginCallsign)
                                  : "SYNC_TOMBSTONES".equals(type) ? peerNodeId
                                  : json.optString("id", "ALL");
                        long ts = json.optLong("timestamp", 0);
                        long age = Math.abs(System.currentTimeMillis() - ts);
                        if (age > 300000) {
                            Log.w(TAG, "Rejected stale administrative command: age > 5m");
                            return;
                        }
                        String expectedSig = generateAuthoritySig(type, id, ts);
                        if (!sig.equals(expectedSig)) {
                            Log.w(TAG, "Rejected unauthorized cluster command: invalid cryptographic signature for " + type);
                            return;
                        }
                    }

                    JSObject obj = new JSObject();
                    obj.put("endpointId", endpointId);
                    obj.put("type", type);
                    obj.put("callsign", effectiveCallsign);
                    obj.put("nodeId", peerNodeId);
                    obj.put("timestamp", json.optLong("timestamp", System.currentTimeMillis()));

                    if ("LEADER_CLAIM".equals(type) || "LEADER_ABDICATE".equals(type)) {
                        boolean isLeader = json.optBoolean("isLeader", "LEADER_CLAIM".equals(type));
                        String clusterLeader = json.optString("clusterLeader", isLeader ? effectiveCallsign : "");
                        obj.put("isLeader", isLeader);
                        obj.put("clusterLeader", clusterLeader);
                        notifyListeners("leaderClaimReceived", obj);

                        obj.put("lat", 0.0);
                        obj.put("lon", 0.0);
                        obj.put("alt", 0.0);
                        obj.put("heading", 0.0);
                        obj.put("speed", 0.0);
                        obj.put("status", "CONNECTED");
                        notifyListeners("squadTelemetryReceived", obj);
                    } else if ("WAYPOINT_BROADCAST".equals(type)) {
                        obj.put("id", json.optString("id", "wp-" + System.currentTimeMillis()));
                        obj.put("name", json.optString("name", "POI"));
                        obj.put("category", json.optString("category", "RP"));
                        obj.put("lat", json.optDouble("lat", 0.0));
                        obj.put("lon", json.optDouble("lon", 0.0));
                        obj.put("description", json.optString("description", ""));
                        obj.put("createdBy", json.optString("createdBy", effectiveCallsign));
                        notifyListeners("waypointReceived", obj);
                    } else if ("DELETE_WAYPOINT".equals(type)) {
                        obj.put("id", json.optString("id", ""));
                        obj.put("deletedBy", json.optString("deletedBy", "LEADER"));
                        notifyListeners("waypointDeleted", obj);
                    } else if ("DRAWING_BROADCAST".equals(type)) {
                        obj.put("id", json.optString("id", "draw-" + System.currentTimeMillis()));
                        obj.put("createdBy", json.optString("createdBy", effectiveCallsign));
                        obj.put("points", json.optString("points", "[]"));
                        obj.put("color", json.optString("color", "#35D5D9"));
                        notifyListeners("drawingReceived", obj);
                    } else if ("DELETE_DRAWING".equals(type)) {
                        obj.put("id", json.optString("id", ""));
                        obj.put("deletedBy", json.optString("deletedBy", "LEADER"));
                        notifyListeners("drawingDeleted", obj);
                    } else if ("CLEAR_ALL_DRAWINGS".equals(type)) {
                        obj.put("deletedBy", json.optString("deletedBy", "LEADER"));
                        notifyListeners("drawingsCleared", obj);
                    } else if ("SYNC_TOMBSTONES".equals(type)) {
                        obj.put("waypointIds", json.optJSONArray("waypointIds") != null ? json.optJSONArray("waypointIds").toString() : "[]");
                        obj.put("drawingIds", json.optJSONArray("drawingIds") != null ? json.optJSONArray("drawingIds").toString() : "[]");
                        notifyListeners("tombstonesReceived", obj);
                    } else if ("ROUTE_BROADCAST".equals(type)) {
                        obj.put("points", json.optString("points", "[]"));
                        notifyListeners("routeReceived", obj);
                    } else if ("CALLSIGN_UPDATE".equals(type)) {
                        obj.put("oldCallsign", json.optString("oldCallsign", ""));
                        notifyListeners("callsignUpdated", obj);
                    } else {
                        obj.put("lat", json.optDouble("lat", 0.0));
                        obj.put("lon", json.optDouble("lon", 0.0));
                        obj.put("alt", json.optDouble("alt", 0.0));
                        obj.put("heading", json.optDouble("heading", 0.0));
                        obj.put("speed", json.optDouble("speed", 0.0));
                        obj.put("status", json.optString("status", "CONNECTED"));
                        obj.put("accuracy", json.optDouble("accuracy", 0.0));
                        obj.put("fixType", json.optString("fixType", "GNSS_3D"));
                        obj.put("isLeader", json.optBoolean("isLeader", false));
                        obj.put("clusterLeader", json.optString("clusterLeader", ""));
                        notifyListeners("squadTelemetryReceived", obj);
                    }
                } catch (Exception e) {
                    mismatchedEndpoints.add(endpointId);
                    Log.w(TAG, "Dropped unauthenticated or invalid tactical packet: " + e.getMessage());
                    try {
                        String originCallsign = endpointCallsigns.getOrDefault(endpointId, "OPERATOR");
                        emitCryptoErrorThrottled(
                            endpointId,
                            originCallsign,
                            endpointNodeIds.getOrDefault(endpointId, ""),
                            "CRYPTO_KEY_MISMATCH",
                            "Cipher decryption failed. Mission Key mismatch with peer " + originCallsign + "."
                        );
                    } catch (Exception ignored) {}
                }
            }
        }

        @Override
        public void onPayloadTransferUpdate(@NonNull String endpointId, @NonNull PayloadTransferUpdate update) {}
    };

    private void emitCryptoErrorThrottled(String endpointId, String callsign, String nodeId, String type, String message) {
        long now = System.currentTimeMillis();
        String throttleKey = (nodeId != null && !nodeId.isEmpty() ? nodeId : endpointId) + "|" + type;
        Long lastSent = cryptoNotifyLastMs.get(throttleKey);
        if (lastSent != null && (now - lastSent) < 60000L) {
            return;
        }
        cryptoNotifyLastMs.put(throttleKey, now);
        JSObject errObj = new JSObject();
        errObj.put("endpointId", endpointId);
        errObj.put("callsign", callsign);
        errObj.put("nodeId", nodeId != null ? nodeId : "");
        errObj.put("type", type);
        errObj.put("message", message);
        notifyListeners("cryptoError", errObj);
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        if (reconcileFuture != null) {
            reconcileFuture.cancel(true);
            reconcileFuture = null;
        }
        if (connectionsClient != null) {
            connectionsClient.stopAllEndpoints();
        }
        sendExecutor.shutdownNow();
        burstScheduler.shutdownNow();
        super.handleOnDestroy();
    }
}
