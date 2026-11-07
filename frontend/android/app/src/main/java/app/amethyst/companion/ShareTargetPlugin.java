package app.amethyst.companion;

import android.content.Intent;
import android.net.Uri;
import java.util.ArrayList;
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

        if (Intent.ACTION_SEND.equals(action)) {
            CharSequence csText = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            String sharedText = csText != null ? csText.toString() : null;
            String sharedSubject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            String sharedTitle = intent.getStringExtra(Intent.EXTRA_TITLE);

            // Handle image or file URI stream
            Uri streamUri = null;
            try {
                streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            } catch (Exception ignored) {}

            if (sharedText == null && intent.getData() != null) {
                sharedText = intent.getData().toString();
            }

            if ((sharedText != null && !sharedText.trim().isEmpty()) || streamUri != null) {
                JSObject item = new JSObject();
                item.put("text", sharedText != null ? sharedText : (streamUri != null ? streamUri.toString() : ""));
                item.put("subject", sharedSubject != null ? sharedSubject : "");
                item.put("title", sharedTitle != null ? sharedTitle : "");
                item.put("mediaUri", streamUri != null ? streamUri.toString() : "");
                item.put("mimeType", type != null ? type : "");
                item.put("timestamp", System.currentTimeMillis());

                lastSharedItem = item;
                notifyListeners("shareReceived", item, true);
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            try {
                ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (uris != null && !uris.isEmpty()) {
                    JSObject item = new JSObject();
                    item.put("text", uris.get(0).toString());
                    item.put("mediaUri", uris.get(0).toString());
                    item.put("mimeType", type != null ? type : "");
                    item.put("timestamp", System.currentTimeMillis());

                    lastSharedItem = item;
                    notifyListeners("shareReceived", item, true);
                }
            } catch (Exception ignored) {}
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
