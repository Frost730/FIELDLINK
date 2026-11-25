package com.fieldlink.app;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(FieldlinkLocationPlugin.class);
        registerPlugin(FieldlinkCompassPlugin.class);
        registerPlugin(FieldlinkNearbyPlugin.class);
        registerPlugin(FieldlinkWifiDirectPlugin.class);
        registerPlugin(FieldlinkBackgroundPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
