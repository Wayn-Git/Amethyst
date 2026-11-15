package app.amethyst.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
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

    private void setupEdgeToEdgeAndSystemBars() {
        Window window = getWindow();
        int screenBg = Color.parseColor("#F2F2F7");

        window.getDecorView().setBackgroundColor(screenBg);
        window.setStatusBarColor(screenBg);
        window.setNavigationBarColor(screenBg);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(true);
            controller.setAppearanceLightNavigationBars(true);
        }

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(screenBg);
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatesPlugin.class);
        registerPlugin(PairingPlugin.class);
        registerPlugin(ShareTargetPlugin.class);
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);

        setupEdgeToEdgeAndSystemBars();

        IntentFilter filter = new IntentFilter("app.amethyst.companion.RUN_SPIKE");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(spikeReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(spikeReceiver, filter);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        setupEdgeToEdgeAndSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            setupEdgeToEdgeAndSystemBars();
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
