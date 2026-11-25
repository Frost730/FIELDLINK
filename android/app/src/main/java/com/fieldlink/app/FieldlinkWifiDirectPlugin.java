package com.fieldlink.app;

import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.wifi.p2p.WifiP2pConfig;
import android.net.wifi.p2p.WifiP2pDevice;
import android.net.wifi.p2p.WifiP2pDeviceList;
import android.net.wifi.p2p.WifiP2pInfo;
import android.net.wifi.p2p.WifiP2pManager;
import android.os.Build;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FieldlinkWifiDirect")
public class FieldlinkWifiDirectPlugin extends Plugin {

    private static final String TAG = "FieldlinkWifiDirect";
    private static final int TACTICAL_SOCKET_PORT = 8988;

    private WifiP2pManager p2pManager;
    private WifiP2pManager.Channel channel;
    private BroadcastReceiver p2pReceiver;
    private final ExecutorService socketExecutor = Executors.newCachedThreadPool();
    private final List<Socket> activeSockets = new CopyOnWriteArrayList<>();
    private ServerSocket serverSocket;
    private volatile boolean isRunning = false;
    private volatile boolean clientConnecting = false;

    @Override
    public void load() {
        p2pManager = (WifiP2pManager) getContext().getSystemService(Context.WIFI_P2P_SERVICE);
        if (p2pManager != null) {
            channel = p2pManager.initialize(getContext(), Looper.getMainLooper(), () -> {
                closeAllSockets();
                notifyListeners("wifiDirectDisconnected", new JSObject());
            });
            registerP2pReceiver();
        }
    }

    private void registerP2pReceiver() {
        if (p2pReceiver != null) return;
        p2pReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                String action = intent.getAction();
                if (WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION.equals(action)) {
                    requestConnectionInfoAndStartSocket();
                } else if (WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION.equals(action)) {
                    int state = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1);
                    if (state != WifiP2pManager.WIFI_P2P_STATE_ENABLED) {
                        closeAllSockets();
                    }
                }
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION);
        filter.addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(p2pReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(p2pReceiver, filter);
        }
    }

    @PluginMethod
    public void checkStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", p2pManager != null);
        ret.put("initialized", channel != null);
        ret.put("activeConnections", activeSockets.size());
        call.resolve(ret);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void discoverPeers(PluginCall call) {
        if (p2pManager == null || channel == null) {
            call.reject("Wi-Fi Direct not supported or initialized");
            return;
        }

        p2pManager.discoverPeers(channel, new WifiP2pManager.ActionListener() {
            @Override
            public void onSuccess() {
                JSObject ret = new JSObject();
                ret.put("status", "discovery_started");
                call.resolve(ret);
            }

            @Override
            public void onFailure(int reasonCode) {
                call.reject("Wi-Fi Direct peer discovery failed with code: " + reasonCode);
            }
        });
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getPeerList(PluginCall call) {
        if (p2pManager == null || channel == null) {
            call.reject("Wi-Fi Direct not supported");
            return;
        }

        p2pManager.requestPeers(channel, (WifiP2pDeviceList peers) -> {
            JSArray peerArray = new JSArray();
            if (peers != null) {
                for (WifiP2pDevice dev : peers.getDeviceList()) {
                    JSObject d = new JSObject();
                    d.put("deviceName", dev.deviceName);
                    d.put("deviceAddress", dev.deviceAddress);
                    d.put("status", dev.status);
                    peerArray.put(d);
                }
            }
            JSObject ret = new JSObject();
            ret.put("peers", peerArray);
            call.resolve(ret);
        });
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connectToDevice(PluginCall call) {
        String deviceAddress = call.getString("deviceAddress");
        if (deviceAddress == null || deviceAddress.isEmpty()) {
            call.reject("deviceAddress is required");
            return;
        }
        if (p2pManager == null || channel == null) {
            call.reject("Wi-Fi Direct not supported");
            return;
        }

        WifiP2pConfig config = new WifiP2pConfig();
        config.deviceAddress = deviceAddress;
        p2pManager.connect(channel, config, new WifiP2pManager.ActionListener() {
            @Override
            public void onSuccess() {
                requestConnectionInfoAndStartSocket();
                JSObject ret = new JSObject();
                ret.put("status", "connecting");
                ret.put("deviceAddress", deviceAddress);
                call.resolve(ret);
            }

            @Override
            public void onFailure(int reasonCode) {
                call.reject("Wi-Fi Direct connect failed with code: " + reasonCode);
            }
        });
    }

    @PluginMethod
    public void sendPayload(PluginCall call) {
        String payload = call.getString("data");
        if (payload == null || payload.isEmpty()) {
            call.reject("Missing payload data");
            return;
        }
        socketExecutor.execute(() -> {
            int sent = 0;
            byte[] frameBytes;
            try {
                byte[] encrypted = FieldlinkNearbyPlugin.encryptWithActiveKey(
                    getContext(),
                    payload.getBytes(StandardCharsets.UTF_8)
                );
                String encodedFrame = "FLW1:" + Base64.encodeToString(encrypted, Base64.NO_WRAP) + "\n";
                frameBytes = encodedFrame.getBytes(StandardCharsets.UTF_8);
            } catch (Exception encErr) {
                call.reject("Wi-Fi Direct encryption failed: " + encErr.getMessage());
                return;
            }
            for (Socket sock : activeSockets) {
                try {
                    if (!sock.isClosed() && sock.isConnected()) {
                        synchronized (sock) {
                            OutputStream os = sock.getOutputStream();
                            os.write(frameBytes);
                            os.flush();
                        }
                        sent++;
                    }
                } catch (Exception e) {
                    activeSockets.remove(sock);
                }
            }
            JSObject ret = new JSObject();
            ret.put("sentCount", sent);
            call.resolve(ret);
        });
    }

    private void requestConnectionInfoAndStartSocket() {
        if (p2pManager == null || channel == null) return;
        p2pManager.requestConnectionInfo(channel, (WifiP2pInfo info) -> {
            if (info == null || !info.groupFormed) {
                if (isRunning) {
                    closeAllSockets();
                    notifyListeners("wifiDirectDisconnected", new JSObject());
                }
                return;
            }
            isRunning = true;
            if (info.isGroupOwner) {
                startGroupOwnerServer();
            } else if (info.groupOwnerAddress != null && activeSockets.isEmpty() && !clientConnecting) {
                connectClientSocket(info.groupOwnerAddress.getHostAddress());
            }
            JSObject obj = new JSObject();
            obj.put("groupFormed", true);
            obj.put("isGroupOwner", info.isGroupOwner);
            obj.put("host", info.groupOwnerAddress != null ? info.groupOwnerAddress.getHostAddress() : "");
            notifyListeners("wifiDirectConnected", obj);
        });
    }

    private void startGroupOwnerServer() {
        socketExecutor.execute(() -> {
            try {
                if (serverSocket != null && !serverSocket.isClosed()) return;
                serverSocket = new ServerSocket(TACTICAL_SOCKET_PORT);
                while (isRunning && !serverSocket.isClosed()) {
                    Socket client = serverSocket.accept();
                    activeSockets.add(client);
                    readSocketLoop(client);
                }
            } catch (Exception e) {
                Log.w(TAG, "Wi-Fi Direct server socket stopped: " + e.getMessage());
            }
        });
    }

    private void connectClientSocket(String host) {
        clientConnecting = true;
        socketExecutor.execute(() -> {
            try {
                Socket client = new Socket();
                client.connect(new InetSocketAddress(host, TACTICAL_SOCKET_PORT), 5000);
                activeSockets.add(client);
                readSocketLoop(client);
            } catch (Exception e) {
                Log.w(TAG, "Wi-Fi Direct client connect error: " + e.getMessage());
            } finally {
                clientConnecting = false;
            }
        });
    }

    private void readSocketLoop(Socket socket) {
        socketExecutor.execute(() -> {
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8)
            )) {
                String line;
                while (isRunning && (line = reader.readLine()) != null) {
                    if (!line.startsWith("FLW1:")) {
                        Log.w(TAG, "Dropped unauthenticated Wi-Fi Direct frame");
                        continue;
                    }
                    try {
                        byte[] cipherPacket = Base64.decode(line.substring(5), Base64.NO_WRAP);
                        byte[] plaintext = FieldlinkNearbyPlugin.decryptWithActiveKey(getContext(), cipherPacket);
                        JSObject obj = new JSObject();
                        obj.put("data", new String(plaintext, StandardCharsets.UTF_8));
                        notifyListeners("wifiDirectPayloadReceived", obj);
                    } catch (Exception decErr) {
                        Log.w(TAG, "Dropped Wi-Fi Direct frame failing Mission Key GCM verification: " + decErr.getMessage());
                    }
                }
            } catch (Exception ignored) {
            } finally {
                activeSockets.remove(socket);
                try { socket.close(); } catch (Exception ignored) {}
            }
        });
    }

    @PluginMethod
    public void stopPeerDiscovery(PluginCall call) {
        if (p2pManager != null && channel != null) {
            p2pManager.stopPeerDiscovery(channel, null);
        }
        closeAllSockets();
        JSObject ret = new JSObject();
        ret.put("status", "stopped");
        call.resolve(ret);
    }

    private void closeAllSockets() {
        isRunning = false;
        clientConnecting = false;
        for (Socket s : activeSockets) {
            try { s.close(); } catch (Exception ignored) {}
        }
        activeSockets.clear();
        if (serverSocket != null) {
            try { serverSocket.close(); } catch (Exception ignored) {}
            serverSocket = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (p2pReceiver != null) {
            try {
                getContext().unregisterReceiver(p2pReceiver);
            } catch (Exception ignored) {}
            p2pReceiver = null;
        }
        closeAllSockets();
        socketExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
