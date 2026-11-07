package app.amethyst.companion;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    private JSObject lastSharedItem = null;

    @Override
    public void load() {
        super.load();
        if (getActivity() != null) {
            handleIntent(getActivity().getIntent());
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && type != null && (type.startsWith("text/") || "text/plain".equals(type))) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            String sharedSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            String sharedTitle = intent.getStringExtra(Intent.EXTRA_TITLE);

            if (sharedText != null && !sharedText.trim().isEmpty()) {
                JSObject item = new JSObject();
                item.put("text", sharedText);
                item.put("subject", sharedSubject != null ? sharedSubject : "");
                item.put("title", sharedTitle != null ? sharedTitle : "");
                item.put("timestamp", System.currentTimeMillis());

                lastSharedItem = item;
                notifyListeners("shareReceived", item, true);
            }
        }
    }

    @PluginMethod
    public void getSharedItem(PluginCall call) {
        if (lastSharedItem != null) {
            call.resolve(lastSharedItem);
        } else {
            if (getActivity() != null) {
                handleIntent(getActivity().getIntent());
            }
            if (lastSharedItem != null) {
                call.resolve(lastSharedItem);
            } else {
                call.resolve(new JSObject());
            }
        }
    }

    @PluginMethod
    public void clearSharedItem(PluginCall call) {
        lastSharedItem = null;
        if (getActivity() != null && getActivity().getIntent() != null) {
            Intent intent = getActivity().getIntent();
            if (Intent.ACTION_SEND.equals(intent.getAction())) {
                intent.removeExtra(Intent.EXTRA_TEXT);
                intent.setAction(null);
            }
        }
        call.resolve();
    }
}
