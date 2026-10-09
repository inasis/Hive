package dev.hive.codexbridge;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "HiveTransport")
public class HiveTransportPlugin extends Plugin {
    private final Map<String, HiveDaemonWebSocketSession> connections = new HashMap<>();
    private final HiveConnectionKeepAlive keepAlive = new HiveConnectionKeepAlive();
    private volatile boolean appInForeground;

    @PluginMethod
    public synchronized void connect(PluginCall call) {
        String endpoint = call.getString("url");
        String fingerprint = call.getString("fingerprint");
        String connectionId = call.getString("connectionId");
        if (connectionId == null || connectionId.isEmpty()) {
            call.reject("Missing Hive connection identifier");
            return;
        }
        if (endpoint == null || !endpoint.startsWith("wss://")) {
            call.reject("Android requires a wss:// endpoint");
            return;
        }
        if (connections.containsKey(connectionId)) {
            call.reject("A Hive connection is already open");
            return;
        }

        final byte[] expectedFingerprint;
        try {
            expectedFingerprint = HivePinnedCertificateTrustManager.parseFingerprint(fingerprint);
        } catch (Exception exception) {
            call.reject("Enter the 64-character SHA-256 fingerprint printed by the Hive daemon");
            return;
        }

        try {
            URI uri = URI.create(endpoint);
            if (!"wss".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || !"/rpc".equals(uri.getPath())) {
                call.reject("The endpoint must be wss://host[:port]/rpc");
                return;
            }
            HiveDaemonWebSocketSession nextConnection = new HiveDaemonWebSocketSession(endpoint, expectedFingerprint, new HiveDaemonWebSocketSession.Listener() {
                @Override
                public void onOpen(HiveDaemonWebSocketSession session) {
                    if (!isActiveConnection(session, connectionId)) return;
                    call.resolve();
                }

                @Override
                public void onMessage(HiveDaemonWebSocketSession session, String text) {
                    if (!isActiveConnection(session, connectionId)) return;
                    HiveSessionCompletionNotifier.notifyIfCompleted(getContext(), text, appInForeground);
                    JSObject event = new JSObject();
                    event.put("connectionId", connectionId);
                    event.put("data", text);
                    notifyListeners("message", event);
                }

                @Override
                public void onFailure(HiveDaemonWebSocketSession session, Throwable error) {
                    if (!clearActiveConnection(session, connectionId)) return;
                    String message = error.getMessage() == null ? "WebSocket connection failed" : error.getMessage();
                    if (!session.wasOpened()) call.reject(message);
                    JSObject event = new JSObject();
                    event.put("connectionId", connectionId);
                    event.put("message", message);
                    notifyListeners("error", event);
                }

                @Override
                public void onClosed(HiveDaemonWebSocketSession session, int code, String reason) {
                    if (!clearActiveConnection(session, connectionId)) return;
                    JSObject event = new JSObject();
                    event.put("connectionId", connectionId);
                    event.put("code", code);
                    event.put("reason", reason);
                    notifyListeners("close", event);
                }
            });
            connections.put(connectionId, nextConnection);
            nextConnection.start();
        } catch (Exception exception) {
            HiveDaemonWebSocketSession connection = connections.remove(connectionId);
            if (connection != null) connection.shutdownClient();
            call.reject("Could not start the pinned TLS connection: " + exception.getMessage(), exception);
        }
    }

    @PluginMethod
    public synchronized void send(PluginCall call) {
        String data = call.getString("data");
        String connectionId = call.getString("connectionId");
        HiveDaemonWebSocketSession active = connections.get(connectionId);
        if (active == null || data == null || connectionId == null) {
            call.reject("Hive WebSocket is not connected");
            return;
        }
        if (!active.send(data)) {
            call.reject("Could not send data to the Hive daemon");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public synchronized void setKeepAlive(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);
        try {
            String connectionId = call.getString("connectionId", "default");
            keepAlive.setEnabled(getContext(), connectionId, Boolean.TRUE.equals(enabled));
            call.resolve();
        } catch (Exception exception) {
            call.reject("Could not update the Android background connection service: " + exception.getMessage(), exception);
        }
    }

    @PluginMethod
    public synchronized void disconnect(PluginCall call) {
        String requestedConnectionId = call.getString("connectionId");
        if (requestedConnectionId == null) {
            for (HiveDaemonWebSocketSession active : connections.values()) active.close();
            connections.clear();
        } else {
            HiveDaemonWebSocketSession active = connections.remove(requestedConnectionId);
            if (active != null) active.close();
        }
        call.resolve();
    }

    @Override
    protected synchronized void handleOnDestroy() {
        for (HiveDaemonWebSocketSession active : connections.values()) active.cancel();
        connections.clear();
        keepAlive.stop(getContext());
    }

    @Override
    protected void handleOnResume() {
        appInForeground = true;
        notifyListeners("resume", new JSObject());
    }

    @Override
    protected void handleOnPause() {
        appInForeground = false;
    }

    private synchronized boolean isActiveConnection(HiveDaemonWebSocketSession expectedConnection, String connectionId) {
        return connections.get(connectionId) == expectedConnection && expectedConnection.isStarted();
    }

    private synchronized boolean clearActiveConnection(HiveDaemonWebSocketSession expectedConnection, String connectionId) {
        if (!isActiveConnection(expectedConnection, connectionId)) return false;
        connections.remove(connectionId);
        expectedConnection.shutdownClient();
        return true;
    }

}
