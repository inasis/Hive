package dev.hive.codexbridge;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(HiveTransportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
