package app.amethyst.companion;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

@CapacitorPlugin(name = "Pairing")
public class PairingPlugin extends Plugin {

    private static final String TAG = "PairingPlugin";

    @PluginMethod
    public void pair(PluginCall call) {
        getBridge().execute(() -> {
            try {
                JSArray hostsArray = call.getArray("hosts");
                int port = call.getInt("port", 0);
                String fp = call.getString("fp", "");
                String token = call.getString("token", "");
                String deviceLabel = call.getString("deviceLabel", "Mobile Phone");
                int connectTimeoutMs = call.getInt("connectTimeoutMs", 3000);
                int readTimeoutMs = call.getInt("readTimeoutMs", 120000);

                if (hostsArray == null || hostsArray.length() == 0 || port <= 0 || fp.isEmpty() || token.isEmpty()) {
                    call.reject("Missing or invalid pairing parameters", "BAD_PARAMETERS");
                    return;
                }

                String normalizedExpectedFp = fp.replace(":", "").toLowerCase().trim();
                boolean anyConnected = false;
                JSArray attempts = new JSArray();

                for (int i = 0; i < hostsArray.length(); i++) {
                    String host = hostsArray.getString(i);
                    if (host == null || host.trim().isEmpty()) continue;
                    host = host.trim();

                    HttpsURLConnection connection = null;
                    try {
                        URL url = new URL("https://" + host + ":" + port + "/pair");

                        // Pin TLS certificate strictly to the expected SHA-256 fingerprint
                        TrustManager[] trustManagers = createPinnedTrustManager(normalizedExpectedFp);
                        SSLContext sslContext = SSLContext.getInstance("TLS");
                        sslContext.init(null, trustManagers, new SecureRandom());

                        final String targetHost = host;
                        HostnameVerifier hostnameVerifier = (hostname, session) -> {
                            return hostname != null && (hostname.equalsIgnoreCase(targetHost) || hostname.equalsIgnoreCase("localhost") || hostname.equals("127.0.0.1"));
                        };

                        connection = (HttpsURLConnection) url.openConnection();
                        connection.setSSLSocketFactory(sslContext.getSocketFactory());
                        connection.setHostnameVerifier(hostnameVerifier);
                        connection.setRequestMethod("POST");
                        connection.setRequestProperty("Content-Type", "application/json");
                        connection.setRequestProperty("Accept", "application/json");
                        connection.setDoOutput(true);
                        connection.setConnectTimeout(connectTimeoutMs);
                        connection.setReadTimeout(readTimeoutMs);

                        // Send payload
                        String payload = "{\"token\":\"" + escapeJson(token) + "\",\"device_label\":\"" + escapeJson(deviceLabel) + "\"}";
                        byte[] postData = payload.getBytes(StandardCharsets.UTF_8);

                        try (OutputStream os = connection.getOutputStream()) {
                            os.write(postData);
                            os.flush();
                        }

                        // Connected successfully to the pairing server!
                        anyConnected = true;
                        JSObject statusEvent = new JSObject();
                        statusEvent.put("state", "waiting_approval");
                        statusEvent.put("host", host);
                        notifyListeners("pairingState", statusEvent);

                        // Await approval response from PC
                        int responseCode = connection.getResponseCode();
                        if (responseCode == 200) {
                            String responseBody = readStream(connection.getInputStream());
                            JSObject result = new JSObject();
                            result.put("bundle", new JSObject(responseBody));
                            call.resolve(result);
                            return;
                        } else if (responseCode == 403) {
                            String errType = "DENIED";
                            Log.w(TAG, "Host " + host + ":" + port + " failed: " + errType);
                            recordAttempt(attempts, host, port, errType, "Pairing denied on PC");
                            call.reject("Pairing was denied on your PC", "DENIED", createErrorData(port, attempts));
                            return;
                        } else if (responseCode == 408) {
                            String errType = "APPROVAL_TIMEOUT";
                            Log.w(TAG, "Host " + host + ":" + port + " failed: " + errType);
                            recordAttempt(attempts, host, port, errType, "Approval timed out");
                            call.reject("Approval timed out on your PC", "APPROVAL_TIMEOUT", createErrorData(port, attempts));
                            return;
                        } else if (responseCode == 429) {
                            String errType = "TOO_MANY_ATTEMPTS";
                            Log.w(TAG, "Host " + host + ":" + port + " failed: " + errType);
                            recordAttempt(attempts, host, port, errType, "Too many attempts");
                            call.reject("Too many failed pairing attempts. Pairing locked out.", "TOO_MANY_ATTEMPTS", createErrorData(port, attempts));
                            return;
                        } else if (responseCode == 400 || responseCode == 401) {
                            String errType = "INVALID_TOKEN";
                            Log.w(TAG, "Host " + host + ":" + port + " failed: " + errType);
                            recordAttempt(attempts, host, port, errType, "Invalid or expired token");
                            call.reject("Pairing token was rejected or expired", "INVALID_TOKEN", createErrorData(port, attempts));
                            return;
                        } else {
                            String errType = "HTTP_" + responseCode;
                            Log.w(TAG, "Host " + host + ":" + port + " failed: " + errType);
                            recordAttempt(attempts, host, port, errType, "Server returned HTTP " + responseCode);
                            call.reject("Server returned HTTP " + responseCode, "SERVER_ERROR", createErrorData(port, attempts));
                            return;
                        }

                    } catch (SSLHandshakeException sslEx) {
                        String msg = sslEx.getMessage() != null ? sslEx.getMessage() : "";
                        String causeMsg = sslEx.getCause() != null && sslEx.getCause().getMessage() != null ? sslEx.getCause().getMessage() : "";
                        boolean isCertMismatch = msg.contains("fingerprint mismatch") || causeMsg.contains("fingerprint mismatch");
                        String errType = isCertMismatch ? "CERT_MISMATCH" : "TLS_ERROR";
                        Log.w(TAG, "Host " + host + ":" + port + " failed: " + errType);
                        recordAttempt(attempts, host, port, errType, isCertMismatch ? "Certificate fingerprint mismatch" : "TLS handshake failed");

                        if (isCertMismatch) {
                            call.reject("Certificate pinning verification failed", "CERT_MISMATCH", createErrorData(port, attempts));
                            return;
                        }
                    } catch (SocketTimeoutException timeoutEx) {
                        String errType = anyConnected ? "APPROVAL_TIMEOUT" : "CONNECT_TIMEOUT";
                        Log.w(TAG, "Host " + host + ":" + port + " failed: " + errType);
                        recordAttempt(attempts, host, port, errType, anyConnected ? "Approval timed out" : "Connect timed out");

                        if (anyConnected) {
                            call.reject("Approval timed out on your PC", "APPROVAL_TIMEOUT", createErrorData(port, attempts));
                            return;
                        }
                    } catch (ConnectException connectEx) {
                        String errType = "CONNECTION_REFUSED";
                        Log.w(TAG, "Host " + host + ":" + port + " failed: " + errType);
                        recordAttempt(attempts, host, port, errType, "Connection refused");
                    } catch (Exception ex) {
                        String errType = "UNKNOWN";
                        Log.w(TAG, "Host " + host + ":" + port + " failed: " + errType);
                        recordAttempt(attempts, host, port, errType, ex.getMessage() != null ? ex.getMessage() : "Unknown error");

                        if (anyConnected) {
                            call.reject("Pairing request failed: " + (ex.getMessage() != null ? ex.getMessage() : "Unknown error"), "UNKNOWN", createErrorData(port, attempts));
                            return;
                        }
                    } finally {
                        if (connection != null) {
                            connection.disconnect();
                        }
                    }
                }

                // If loop finished and none responded
                boolean allRefused = attempts.length() > 0;
                boolean allTimeout = attempts.length() > 0;
                boolean hasRefused = false;

                for (int i = 0; i < attempts.length(); i++) {
                    try {
                        String type = attempts.getJSONObject(i).getString("errorType");
                        if ("CONNECTION_REFUSED".equals(type)) {
                            hasRefused = true;
                            allTimeout = false;
                        } else if ("CONNECT_TIMEOUT".equals(type)) {
                            allRefused = false;
                        } else {
                            allRefused = false;
                            allTimeout = false;
                        }
                    } catch (Exception ignored) {}
                }

                String primaryCode;
                String primaryMessage;

                if (allRefused || hasRefused) {
                    primaryCode = "CONNECTION_REFUSED";
                    primaryMessage = "Connection refused on port " + port + ". Check PC pairing window and firewall.";
                } else if (allTimeout) {
                    primaryCode = "CONNECT_TIMEOUT";
                    primaryMessage = "Connection timed out on port " + port + ". Phone and PC must be on the same Wi-Fi.";
                } else {
                    primaryCode = "NO_HOST_RESPONDED";
                    primaryMessage = "Phone and PC must be on the same Wi-Fi. Some guest/public networks block this.";
                }

                JSObject errorData = createErrorData(port, attempts);
                errorData.put("code", primaryCode);
                call.reject(primaryMessage, primaryCode, errorData);

            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Unexpected pairing error", "UNEXPECTED_ERROR");
            }
        });
    }

    private void recordAttempt(JSArray attempts, String host, int port, String errorType, String message) {
        JSObject att = new JSObject();
        att.put("host", host);
        att.put("port", port);
        att.put("errorType", errorType);
        att.put("message", message);
        attempts.put(att);
    }

    private JSObject createErrorData(int port, JSArray attempts) {
        JSObject data = new JSObject();
        data.put("port", port);
        data.put("attempts", attempts);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < attempts.length(); i++) {
            try {
                org.json.JSONObject att = attempts.getJSONObject(i);
                if (i > 0) sb.append(", ");
                sb.append(att.optString("host")).append(":").append(att.optInt("port", port));
                String msg = att.optString("message", att.optString("errorType", ""));
                if (!msg.isEmpty()) {
                    sb.append(" (").append(msg).append(")");
                }
            } catch (Exception ignored) {}
        }
        data.put("triedSummary", sb.toString());
        return data;
    }

    private TrustManager[] createPinnedTrustManager(String expectedFingerprint) {
        return new TrustManager[] {
            new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) {}

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                    if (chain == null || chain.length == 0) {
                        throw new CertificateException("No certificates presented by server");
                    }
                    X509Certificate cert = chain[0];
                    try {
                        MessageDigest md = MessageDigest.getInstance("SHA-256");
                        byte[] digest = md.digest(cert.getEncoded());
                        StringBuilder sb = new StringBuilder();
                        for (byte b : digest) {
                            sb.append(String.format("%02x", b));
                        }
                        String actualFp = sb.toString();
                        if (!MessageDigest.isEqual(actualFp.getBytes(StandardCharsets.UTF_8), expectedFingerprint.getBytes(StandardCharsets.UTF_8))) {
                            throw new CertificateException("Certificate fingerprint mismatch. Expected: " + expectedFingerprint + ", got: " + actualFp);
                        }
                    } catch (CertificateException ce) {
                        throw ce;
                    } catch (Exception e) {
                        throw new CertificateException("Fingerprint verification failed", e);
                    }
                }

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            }
        };
    }

    private String readStream(InputStream is) throws Exception {
        if (is == null) return "{}";
        BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        return sb.toString();
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
