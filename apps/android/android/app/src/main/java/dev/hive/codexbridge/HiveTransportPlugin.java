package dev.hive.codexbridge;

import android.graphics.Color;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.concurrent.TimeUnit;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import javax.net.ssl.SSLContext;
import javax.net.ssl.X509TrustManager;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

@CapacitorPlugin(name = "HiveTransport")
public class HiveTransportPlugin extends Plugin {
    private final Map<String, WebSocket> sockets = new HashMap<>();
    private final Map<String, OkHttpClient> clients = new HashMap<>();
    private final Set<String> keepAliveConnections = new HashSet<>();

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
        if (sockets.containsKey(connectionId)) {
            call.reject("A Hive connection is already open");
            return;
        }

        final byte[] expectedFingerprint;
        try {
            expectedFingerprint = parseFingerprint(fingerprint);
        } catch (Exception exception) {
            call.reject("Enter the 64-character SHA-256 fingerprint printed by the Hive daemon");
            return;
        }

        try {
            PinnedTrustManager trustManager = new PinnedTrustManager(expectedFingerprint);
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, new X509TrustManager[] { trustManager }, new SecureRandom());
            OkHttpClient nextClient = new OkHttpClient.Builder()
                .sslSocketFactory(sslContext.getSocketFactory(), trustManager)
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(30, TimeUnit.SECONDS)
                .build();
            URI uri = URI.create(endpoint);
            if (!"wss".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || !"/rpc".equals(uri.getPath())) {
                call.reject("The endpoint must be wss://host[:port]/rpc");
                nextClient.dispatcher().executorService().shutdown();
                return;
            }
            Request request = new Request.Builder().url(endpoint).build();
            clients.put(connectionId, nextClient);
            final boolean[] opened = { false };
            WebSocket nextSocket = nextClient.newWebSocket(request, new WebSocketListener() {
                @Override
                public synchronized void onOpen(WebSocket webSocket, Response response) {
                    if (!isActiveConnection(webSocket, nextClient, connectionId)) return;
                    opened[0] = true;
                    call.resolve();
                }

                @Override
                public synchronized void onMessage(WebSocket webSocket, String text) {
                    if (!isActiveConnection(webSocket, nextClient, connectionId)) return;
                    JSObject event = new JSObject();
                    event.put("connectionId", connectionId);
                    event.put("data", text);
                    notifyListeners("message", event);
                }

                @Override
                public synchronized void onFailure(WebSocket webSocket, Throwable error, Response response) {
                    if (!clearActiveConnection(webSocket, nextClient, connectionId)) return;
                    String message = error.getMessage() == null ? "WebSocket connection failed" : error.getMessage();
                    if (!opened[0]) call.reject(message);
                    JSObject event = new JSObject();
                    event.put("connectionId", connectionId);
                    event.put("message", message);
                    notifyListeners("error", event);
                }

                @Override
                public synchronized void onClosed(WebSocket webSocket, int code, String reason) {
                    if (!clearActiveConnection(webSocket, nextClient, connectionId)) return;
                    JSObject event = new JSObject();
                    event.put("connectionId", connectionId);
                    event.put("code", code);
                    event.put("reason", reason);
                    notifyListeners("close", event);
                }
            });
            sockets.put(connectionId, nextSocket);
        } catch (Exception exception) {
            sockets.remove(connectionId);
            closeClient(clients.remove(connectionId));
            call.reject("Could not start the pinned TLS connection: " + exception.getMessage(), exception);
        }
    }

    @PluginMethod
    public synchronized void send(PluginCall call) {
        String data = call.getString("data");
        String connectionId = call.getString("connectionId");
        WebSocket active = sockets.get(connectionId);
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
            if (Boolean.TRUE.equals(enabled)) keepAliveConnections.add(connectionId);
            else keepAliveConnections.remove(connectionId);
            if (!keepAliveConnections.isEmpty()) HiveConnectionService.start(getContext());
            else HiveConnectionService.stop(getContext());
            call.resolve();
        } catch (Exception exception) {
            call.reject("Could not update the Android background connection service: " + exception.getMessage(), exception);
        }
    }

    @PluginMethod
    public void setStatusBarAppearance(PluginCall call) {
        boolean light = call.getBoolean("light", true);
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            window.setStatusBarColor(light ? Color.WHITE : Color.BLACK);
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(light);
            call.resolve();
        });
    }

    @PluginMethod
    public synchronized void disconnect(PluginCall call) {
        String requestedConnectionId = call.getString("connectionId");
        if (requestedConnectionId == null) {
            for (WebSocket active : sockets.values()) active.close(1000, "Client disconnected");
            sockets.clear();
            for (OkHttpClient active : clients.values()) closeClient(active);
            clients.clear();
        } else {
            WebSocket active = sockets.remove(requestedConnectionId);
            if (active != null) active.close(1000, "Client disconnected");
            closeClient(clients.remove(requestedConnectionId));
        }
        call.resolve();
    }

    @Override
    protected synchronized void handleOnDestroy() {
        for (WebSocket active : sockets.values()) active.cancel();
        sockets.clear();
        for (OkHttpClient active : clients.values()) closeClient(active);
        clients.clear();
        keepAliveConnections.clear();
        HiveConnectionService.stop(getContext());
    }

    @Override
    protected void handleOnResume() {
        notifyListeners("resume", new JSObject());
    }

    private void closeClient(OkHttpClient active) {
        if (active == null) return;
        active.dispatcher().cancelAll();
        active.connectionPool().evictAll();
        active.dispatcher().executorService().shutdown();
    }

    private synchronized boolean isActiveConnection(WebSocket expectedSocket, OkHttpClient expectedClient, String connectionId) {
        return sockets.get(connectionId) == expectedSocket && clients.get(connectionId) == expectedClient;
    }

    private synchronized boolean clearActiveConnection(WebSocket expectedSocket, OkHttpClient expectedClient, String connectionId) {
        if (!isActiveConnection(expectedSocket, expectedClient, connectionId)) return false;
        sockets.remove(connectionId);
        clients.remove(connectionId);
        closeClient(expectedClient);
        return true;
    }

    private static byte[] parseFingerprint(String value) {
        if (value == null) throw new IllegalArgumentException("Missing fingerprint");
        String compact = value.replace(":", "").replace(" ", "").trim();
        if (!compact.matches("(?i)[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid SHA-256 fingerprint");
        byte[] result = new byte[32];
        for (int index = 0; index < result.length; index++) {
            result[index] = (byte) Integer.parseInt(compact.substring(index * 2, index * 2 + 2), 16);
        }
        return result;
    }

    private static final class PinnedTrustManager implements X509TrustManager {
        private final byte[] expectedFingerprint;

        PinnedTrustManager(byte[] expectedFingerprint) {
            this.expectedFingerprint = expectedFingerprint;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            throw new CertificateException("Client certificates are not used");
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            if (chain == null || chain.length == 0) throw new CertificateException("The daemon sent no certificate");
            X509Certificate certificate = chain[0];
            certificate.checkValidity();
            try {
                byte[] actual = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
                if (!MessageDigest.isEqual(expectedFingerprint, actual)) {
                    throw new CertificateException("The daemon certificate fingerprint does not match");
                }
            } catch (CertificateException exception) {
                throw exception;
            } catch (Exception exception) {
                throw new CertificateException("Could not verify the daemon certificate", exception);
            }
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }
}
