import Foundation
import Capacitor
import CommonCrypto

@objc(PairingPlugin)
public class PairingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PairingPlugin"
    public let jsName = "Pairing"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pair", returnType: CAPPluginReturnPromise)
    ]

    @objc func pair(_ call: CAPPluginCall) {
        guard let hosts = call.getArray("hosts") as? [String], !hosts.isEmpty,
              let port = call.getInt("port"), port > 0,
              let fp = call.getString("fp"), !fp.isEmpty,
              let token = call.getString("token"), !token.isEmpty else {
            call.reject("Missing or invalid pairing parameters", "BAD_PARAMETERS")
            return
        }

        let deviceLabel = call.getString("deviceLabel") ?? "iPhone"
        let connectTimeout = Double(call.getInt("connectTimeoutMs") ?? 3000) / 1000.0
        let readTimeout = Double(call.getInt("readTimeoutMs") ?? 120000) / 1000.0
        let cleanExpectedFp = fp.replacingOccurrences(of: ":", with: "").lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        DispatchQueue.global(qos: .userInitiated).async {
            var anyConnected = false
            var attempts: [[String: Any]] = []

            func makeErrorData(primaryCode: String) -> [String: Any] {
                var data: [String: Any] = [
                    "port": port,
                    "code": primaryCode,
                    "attempts": attempts
                ]
                let summaryParts = attempts.map { att in
                    let h = att["host"] as? String ?? ""
                    let p = att["port"] as? Int ?? port
                    let msg = att["message"] as? String ?? (att["errorType"] as? String ?? "")
                    return "\(h):\(p) (\(msg))"
                }
                data["triedSummary"] = summaryParts.joined(separator: ", ")
                return data
            }

            for host in hosts {
                let trimmedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmedHost.isEmpty,
                      let url = URL(string: "https://\(trimmedHost):\(port)/pair") else {
                    continue
                }

                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.timeoutInterval = anyConnected ? readTimeout : connectTimeout

                let bodyDict: [String: Any] = [
                    "token": token,
                    "device_label": deviceLabel
                ]
                guard let bodyData = try? JSONSerialization.data(withJSONObject: bodyDict, options: []) else {
                    continue
                }
                request.httpBody = bodyData

                let delegate = PinnedSessionDelegate(expectedFingerprint: cleanExpectedFp) { [weak self] in
                    anyConnected = true
                    self?.notifyListeners("pairingState", data: [
                        "state": "waiting_approval",
                        "host": trimmedHost
                    ])
                }
                let config = URLSessionConfiguration.ephemeral
                config.timeoutIntervalForRequest = connectTimeout
                config.timeoutIntervalForResource = readTimeout
                let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

                let semaphore = DispatchSemaphore(value: 0)
                var responseResult: (Data?, URLResponse?, Error?) = (nil, nil, nil)

                let task = session.dataTask(with: request) { data, response, error in
                    responseResult = (data, response, error)
                    semaphore.signal()
                }
                task.resume()

                // Await response from PC pairing server
                let statusResult = semaphore.wait(timeout: .now() + readTimeout)

                if statusResult == .timedOut {
                    task.cancel()
                    session.invalidateAndCancel()
                    let errType = anyConnected ? "APPROVAL_TIMEOUT" : "CONNECT_TIMEOUT"
                    print("[PairingPlugin] Host \(trimmedHost):\(port) failed: \(errType)")
                    attempts.append([
                        "host": trimmedHost,
                        "port": port,
                        "errorType": errType,
                        "message": anyConnected ? "Approval timed out" : "Connect timed out"
                    ])
                    if anyConnected {
                        call.reject("Approval timed out on your PC", "APPROVAL_TIMEOUT", nil, makeErrorData(primaryCode: "APPROVAL_TIMEOUT"))
                        return
                    }
                    continue
                }

                session.finishTasksAndInvalidate()

                let (data, response, error) = responseResult

                if let httpResponse = response as? HTTPURLResponse {
                    anyConnected = true
                    if httpResponse.statusCode == 200, let responseData = data {
                        if let json = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any] {
                            call.resolve(["bundle": json])
                            return
                        }
                    } else if httpResponse.statusCode == 403 {
                        let errType = "DENIED"
                        print("[PairingPlugin] Host \(trimmedHost):\(port) failed: \(errType)")
                        attempts.append(["host": trimmedHost, "port": port, "errorType": errType, "message": "Pairing denied on PC"])
                        call.reject("Pairing was denied on your PC", "DENIED", nil, makeErrorData(primaryCode: "DENIED"))
                        return
                    } else if httpResponse.statusCode == 408 {
                        let errType = "APPROVAL_TIMEOUT"
                        print("[PairingPlugin] Host \(trimmedHost):\(port) failed: \(errType)")
                        attempts.append(["host": trimmedHost, "port": port, "errorType": errType, "message": "Approval timed out"])
                        call.reject("Approval timed out on your PC", "APPROVAL_TIMEOUT", nil, makeErrorData(primaryCode: "APPROVAL_TIMEOUT"))
                        return
                    } else if httpResponse.statusCode == 429 {
                        let errType = "TOO_MANY_ATTEMPTS"
                        print("[PairingPlugin] Host \(trimmedHost):\(port) failed: \(errType)")
                        attempts.append(["host": trimmedHost, "port": port, "errorType": errType, "message": "Too many attempts"])
                        call.reject("Too many failed pairing attempts. Pairing locked out.", "TOO_MANY_ATTEMPTS", nil, makeErrorData(primaryCode: "TOO_MANY_ATTEMPTS"))
                        return
                    } else if httpResponse.statusCode == 400 || httpResponse.statusCode == 401 {
                        let errType = "INVALID_TOKEN"
                        print("[PairingPlugin] Host \(trimmedHost):\(port) failed: \(errType)")
                        attempts.append(["host": trimmedHost, "port": port, "errorType": errType, "message": "Invalid or expired token"])
                        call.reject("Pairing token was rejected or expired", "INVALID_TOKEN", nil, makeErrorData(primaryCode: "INVALID_TOKEN"))
                        return
                    } else {
                        let errType = "HTTP_\(httpResponse.statusCode)"
                        print("[PairingPlugin] Host \(trimmedHost):\(port) failed: \(errType)")
                        attempts.append(["host": trimmedHost, "port": port, "errorType": errType, "message": "Server returned HTTP \(httpResponse.statusCode)"])
                        call.reject("Server returned HTTP \(httpResponse.statusCode)", "SERVER_ERROR", nil, makeErrorData(primaryCode: "SERVER_ERROR"))
                        return
                    }
                }

                if delegate.pinningFailed {
                    let errType = "CERT_MISMATCH"
                    print("[PairingPlugin] Host \(trimmedHost):\(port) failed: \(errType)")
                    attempts.append(["host": trimmedHost, "port": port, "errorType": errType, "message": "Certificate fingerprint mismatch"])
                    call.reject("Certificate pinning verification failed", "CERT_MISMATCH", nil, makeErrorData(primaryCode: "CERT_MISMATCH"))
                    return
                }

                if let err = error as NSError? {
                    var errType = "UNKNOWN"
                    var errMsg = err.localizedDescription
                    if err.domain == NSURLErrorDomain {
                        switch err.code {
                        case NSURLErrorTimedOut:
                            errType = "CONNECT_TIMEOUT"
                            errMsg = "Connect timed out"
                        case NSURLErrorCannotConnectToHost, NSURLErrorConnectionLost:
                            errType = "CONNECTION_REFUSED"
                            errMsg = "Connection refused"
                        case NSURLErrorServerCertificateUntrusted, NSURLErrorSecureConnectionFailed:
                            errType = "TLS_ERROR"
                            errMsg = "TLS handshake failed"
                        default:
                            errType = "UNKNOWN"
                        }
                    }
                    print("[PairingPlugin] Host \(trimmedHost):\(port) failed: \(errType)")
                    attempts.append(["host": trimmedHost, "port": port, "errorType": errType, "message": errMsg])
                }
            }

            var allRefused = !attempts.isEmpty
            var allTimeout = !attempts.isEmpty
            var hasRefused = false

            for att in attempts {
                let t = att["errorType"] as? String ?? ""
                if t == "CONNECTION_REFUSED" {
                    hasRefused = true
                    allTimeout = false
                } else if t == "CONNECT_TIMEOUT" {
                    allRefused = false
                } else {
                    allRefused = false
                    allTimeout = false
                }
            }

            let primaryCode: String
            let primaryMessage: String
            if allRefused || hasRefused {
                primaryCode = "CONNECTION_REFUSED"
                primaryMessage = "Connection refused on port \(port). Check PC pairing window and firewall."
            } else if allTimeout {
                primaryCode = "CONNECT_TIMEOUT"
                primaryMessage = "Connection timed out on port \(port). Phone and PC must be on the same Wi-Fi."
            } else {
                primaryCode = "NO_HOST_RESPONDED"
                primaryMessage = "Phone and PC must be on the same Wi-Fi. Some guest/public networks block this."
            }

            call.reject(primaryMessage, primaryCode, nil, makeErrorData(primaryCode: primaryCode))
        }
    }
}

class PinnedSessionDelegate: NSObject, URLSessionDelegate {
    let expectedFingerprint: String
    var pinningFailed: Bool = false
    var onPinned: (() -> Void)?

    init(expectedFingerprint: String, onPinned: (() -> Void)? = nil) {
        self.expectedFingerprint = expectedFingerprint
        self.onPinned = onPinned
        super.init()
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            pinningFailed = true
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        var secResult: SecTrustResultType = .invalid
        SecTrustEvaluate(serverTrust, &secResult)

        guard let certificate = SecTrustGetCertificateAtIndex(serverTrust, 0) else {
            pinningFailed = true
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        let serverCertData = SecCertificateCopyData(certificate) as Data
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        serverCertData.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(serverCertData.count), &hash)
        }
        let actualFingerprint = hash.map { String(format: "%02x", $0) }.joined()

        if actualFingerprint.caseInsensitiveCompare(expectedFingerprint) == .orderedSame {
            onPinned?()
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            pinningFailed = true
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}
