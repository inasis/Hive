package dev.hive.codexbridge;

import java.security.SecureRandom;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.X509TrustManager;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/** Owns one certificate-pinned daemon WebSocket and its OkHttp resources. */
final class HiveDaemonWebSocketSession {
    interface Listener {
        void onOpen(HiveDaemonWebSocketSession session);
        void onMessage(HiveDaemonWebSocketSession session, String text);
        void onFailure(HiveDaemonWebSocketSession session, Throwable error);
        void onClosed(HiveDaemonWebSocketSession session, int code, String reason);
    }

    private final OkHttpClient client;
    private final Request request;
    private final Listener listener;
    private volatile WebSocket socket;
    private volatile boolean opened;

    HiveDaemonWebSocketSession(String endpoint, byte[] expectedFingerprint, Listener listener) throws Exception {
        this.listener = listener;
        request = new Request.Builder().url(endpoint).build();
        HivePinnedCertificateTrustManager trustManager = new HivePinnedCertificateTrustManager(expectedFingerprint);
        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, new X509TrustManager[] { trustManager }, new SecureRandom());
        client = new OkHttpClient.Builder()
            .sslSocketFactory(sslContext.getSocketFactory(), trustManager)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .build();
    }

    void start() {
        socket = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public synchronized void onOpen(WebSocket webSocket, Response response) {
                opened = true;
                listener.onOpen(HiveDaemonWebSocketSession.this);
            }

            @Override
            public synchronized void onMessage(WebSocket webSocket, String text) {
                listener.onMessage(HiveDaemonWebSocketSession.this, text);
            }

            @Override
            public synchronized void onFailure(WebSocket webSocket, Throwable error, Response response) {
                listener.onFailure(HiveDaemonWebSocketSession.this, error);
            }

            @Override
            public synchronized void onClosed(WebSocket webSocket, int code, String reason) {
                listener.onClosed(HiveDaemonWebSocketSession.this, code, reason);
            }
        });
    }

    boolean send(String data) {
        WebSocket active = socket;
        return active != null && active.send(data);
    }

    boolean wasOpened() {
        return opened;
    }

    boolean isStarted() {
        return socket != null;
    }

    void close() {
        WebSocket active = socket;
        if (active != null) active.close(1000, "Client disconnected");
        shutdownClient();
    }

    void cancel() {
        WebSocket active = socket;
        if (active != null) active.cancel();
        shutdownClient();
    }

    void shutdownClient() {
        client.dispatcher().cancelAll();
        client.connectionPool().evictAll();
        client.dispatcher().executorService().shutdown();
    }
}
