package app.amethyst.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "AmethystSpike";

    private final BroadcastReceiver spikeReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String testId = intent.getStringExtra("test");
            Log.d(TAG, "Received broadcast to run spike: " + testId);
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.post(() -> {
                    String js = "window.__runSpikeTest && window.__runSpikeTest('" + (testId != null ? testId : "ALL") + "');";
                    webView.evaluateJavascript(js, value -> {
                        Log.d(TAG, "evaluateJavascript returned: " + value);
                    });
                });
            }
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatesPlugin.class);
        registerPlugin(PairingPlugin.class);
        registerPlugin(ShareTargetPlugin.class);
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);

        IntentFilter filter = new IntentFilter("app.amethyst.companion.RUN_SPIKE");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(spikeReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(spikeReceiver, filter);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        try {
            unregisterReceiver(spikeReceiver);
        } catch (Exception e) {}
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    public void onStart() {
        super.onStart();
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
        }
    }
}
