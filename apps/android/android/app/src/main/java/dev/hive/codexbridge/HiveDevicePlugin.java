package dev.hive.codexbridge;

import android.Manifest;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "HiveDevice", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class HiveDevicePlugin extends Plugin {
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        boolean alreadyRequested = getContext().getSharedPreferences("hive-notifications", 0)
            .getBoolean("permission-requested", false);
        if (alreadyRequested) {
            call.resolve();
            return;
        }
        getContext().getSharedPreferences("hive-notifications", 0)
            .edit()
            .putBoolean("permission-requested", true)
            .apply();
        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        call.resolve();
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
}
