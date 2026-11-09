package app.amethyst.companion;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdates")
public class AppUpdatesPlugin extends Plugin {
    private final AtomicBoolean busy = new AtomicBoolean(false);

    @PluginMethod
    public void install(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("An update is already being prepared"); return; }
        getBridge().execute(() -> {
            File partial = null;
            HttpURLConnection connection = null;
            try {
                String digest = call.getString("sha256", "");
                String token = call.getString("token", "");
                URL url = new URL(call.getString("url", ""));
                if (!digest.matches("[0-9a-f]{64}") || token.isEmpty()
                    || (!url.getProtocol().equals("https") && !url.getProtocol().equals("http")) || url.getUserInfo() != null
                    || !url.getPath().equals("/api/mobile/update/apk") || url.getQuery() != null) {
                    throw new Exception("Updates require a paired desktop and a valid checksum");
                }
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    getActivity().runOnUiThread(() -> {
                        try {
                            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getContext().getPackageName())));
                            JSObject result = new JSObject(); result.put("permissionRequired", true); call.resolve(result);
                        } catch (Exception error) { call.reject("Could not open Android install settings", error); }
                    });
                    return;
                }
                File directory = new File(getContext().getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Update storage is unavailable");
                partial = new File(directory, "download.part");
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("Authorization", "Bearer " + token);
                if (connection.getResponseCode() != 200) throw new Exception("Desktop refused the download (" + connection.getResponseCode() + ")");
                MessageDigest hash = MessageDigest.getInstance("SHA-256");
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[65536]; int count; long total = 0;
                    while ((count = in.read(buffer)) != -1) {
                        total += count;
                        if (total > 100 * 1024 * 1024) throw new Exception("Update exceeds the size limit");
                        hash.update(buffer, 0, count); out.write(buffer, 0, count);
                    }
                }
                StringBuilder actual = new StringBuilder();
                for (byte value : hash.digest()) actual.append(String.format("%02x", value & 255));
                if (!actual.toString().equals(digest)) throw new Exception("Update checksum does not match; check again");
                verifyPackage(partial);
                File apk = new File(directory, digest + ".apk");
                if (apk.exists() && !apk.delete()) throw new Exception("Could not replace cached update");
                if (!partial.renameTo(apk)) throw new Exception("Could not save verified update");
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                getActivity().runOnUiThread(() -> {
                    try {
                        Intent install = new Intent(Intent.ACTION_VIEW);
                        install.setDataAndType(uri, "application/vnd.android.package-archive");
                        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(install);
                        JSObject result = new JSObject(); result.put("installerOpened", true); call.resolve(result);
                    } catch (Exception error) { call.reject("Could not open the Android update installer", error); }
                });
            } catch (Exception error) { call.reject(error.getMessage(), error); }
            finally {
                if (connection != null) connection.disconnect();
                if (partial != null && partial.exists()) partial.delete();
                busy.set(false);
            }
        });
    }

    @SuppressWarnings("deprecation")
    private void verifyPackage(File apk) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        PackageInfo incoming = manager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES);
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
        if (incoming == null || !installed.packageName.equals(incoming.packageName)) throw new Exception("This APK is not Amethyst");
        long next = Build.VERSION.SDK_INT >= 28 ? incoming.getLongVersionCode() : incoming.versionCode;
        long current = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        if (next <= current) throw new Exception("This update is not newer than the installed app");
        if (incoming.signatures == null || installed.signatures == null
            || incoming.signatures.length != installed.signatures.length) throw new Exception("Update signing key does not match");
        for (Signature signature : installed.signatures) {
            if (!Arrays.asList(incoming.signatures).contains(signature)) throw new Exception("Update signing key does not match");
        }
    }
}
