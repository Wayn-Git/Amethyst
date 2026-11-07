package app.amethyst.companion;

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
                    call.reject("BAD_PARAMETERS", "Missing or invalid pairing parameters");
                    return;
                }

                String normalizedExpectedFp = fp.replace(":", "").toLowerCase().trim();
                boolean anyConnected = false;

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
                            call.reject("DENIED", "Pairing was denied on your PC");
                            return;
                        } else if (responseCode == 408) {
                            call.reject("APPROVAL_TIMEOUT", "Approval timed out on your PC");
                            return;
                        } else if (responseCode == 400 || responseCode == 401) {
                            call.reject("INVALID_TOKEN", "Pairing token was rejected or expired");
                            return;
                        } else {
                            call.reject("SERVER_ERROR", "Server returned HTTP " + responseCode);
                            return;
                        }

                    } catch (SSLHandshakeException sslEx) {
                        String msg = sslEx.getMessage() != null ? sslEx.getMessage() : "";
                        if (msg.contains("fingerprint mismatch") || (sslEx.getCause() != null && sslEx.getCause().getMessage() != null && sslEx.getCause().getMessage().contains("fingerprint mismatch"))) {
                            call.reject("CERT_MISMATCH", "Certificate pinning verification failed");
                            return;
                        }
                        // Host may have closed TLS or rejected
                    } catch (SocketTimeoutException timeoutEx) {
                        if (anyConnected) {
                            call.reject("APPROVAL_TIMEOUT", "Pairing request timed out waiting for approval");
                            return;
                        }
                        // Connect timeout for this host, try next
                    } catch (ConnectException connectEx) {
                        // Host unreachable or port closed, try next host
                    } catch (Exception ex) {
                        if (anyConnected) {
                            call.reject("REQUEST_FAILED", ex.getMessage(), ex);
                            return;
                        }
                    } finally {
                        if (connection != null) {
                            connection.disconnect();
                        }
                    }
                }

                // If loop finished and none responded
                call.reject("NO_HOST_RESPONDED", "Phone and PC must be on the same Wi-Fi. Some guest/public networks block this.");

            } catch (Exception e) {
                call.reject("UNEXPECTED_ERROR", e.getMessage(), e);
            }
        });
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
