package dev.hive.codexbridge;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

final class HiveSessionCompletionNotifier {
    private static final String CHANNEL_ID = "hive-session-completion";

    private HiveSessionCompletionNotifier() {}

    static void notifyIfCompleted(Context context, String packetJson, boolean appInForeground) {
        if (appInForeground || !hasNotificationPermission(context)) return;

        try {
            JSONObject packet = new JSONObject(packetJson);
            if (!"event".equals(packet.optString("type"))) return;

            JSONObject event = packet.optJSONObject("event");
            if (event == null || !"turn/completed".equals(event.optString("method"))) return;

            JSONObject params = event.optJSONObject("params");
            String threadId = event.optString("threadId", "");
            if (params == null || threadId.isEmpty()) return;

            JSONObject turn = params.optJSONObject("turn");
            String turnId = turn == null ? "" : turn.optString("id", "");
            String target = event.optString("target", "");
            showNotification(context, target, threadId, turnId);
        } catch (JSONException | SecurityException ignored) {
            // Malformed daemon events and revoked notification permissions are ignored.
        }
    }

    private static boolean hasNotificationPermission(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private static void showNotification(Context context, String target, String threadId, String turnId) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        createChannel(context, manager);

        Intent openApp = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId(target, threadId, turnId),
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, CHANNEL_ID)
            : new Notification.Builder(context);
        Notification notification = builder
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(context.getString(R.string.session_completion_notification_title))
            .setContentText(context.getString(R.string.session_completion_notification_body))
            .setContentIntent(contentIntent)
            .setCategory(Notification.CATEGORY_STATUS)
            .setAutoCancel(true)
            .build();
        manager.notify(target + ":" + threadId + ":" + turnId, 0, notification);
    }

    private static void createChannel(Context context, NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.session_completion_channel),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription(context.getString(R.string.session_completion_channel_description));
        manager.createNotificationChannel(channel);
    }

    private static int notificationId(String target, String threadId, String turnId) {
        return (target + "\u0000" + threadId + "\u0000" + turnId).hashCode();
    }
}
