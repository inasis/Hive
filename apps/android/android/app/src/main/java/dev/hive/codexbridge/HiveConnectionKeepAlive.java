package dev.hive.codexbridge;

import android.content.Context;

import java.util.HashSet;
import java.util.Set;

/** Tracks bridge clients that require the daemon connection service to stay active. */
final class HiveConnectionKeepAlive {
    private final Set<String> connectionIds = new HashSet<>();

    synchronized void setEnabled(Context context, String connectionId, boolean enabled) {
        if (enabled) connectionIds.add(connectionId);
        else connectionIds.remove(connectionId);

        if (connectionIds.isEmpty()) HiveConnectionService.stop(context);
        else HiveConnectionService.start(context);
    }

    synchronized void stop(Context context) {
        connectionIds.clear();
        HiveConnectionService.stop(context);
    }
}
