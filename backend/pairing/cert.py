"""TLS certificate management for CONTRACT v2 PC pairing.

Generates and persists a self-signed TLS certificate and private key,
or reuses an existing certificate, computing its SHA-256 DER fingerprint.
"""

from __future__ import annotations

import datetime
import hashlib
import ipaddress
import logging
import os
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from backend.config import amethyst_home

log = logging.getLogger(__name__)

CERT_FILENAME = "pairing_cert.pem"
KEY_FILENAME = "pairing_key.pem"


def certs_dir() -> Path:
    override = os.environ.get("AMETHYST_CERTS_DIR")
    if override:
        path = Path(override)
    else:
        path = amethyst_home() / "certs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_cert_fingerprint(cert: x509.Certificate) -> str:
    """Return SHA-256 fingerprint of the certificate DER representation."""
    der = cert.public_bytes(serialization.Encoding.DER)
    return hashlib.sha256(der).hexdigest()


def get_cert_fingerprint_from_file(cert_path: Path) -> str:
    """Read a PEM cert file and compute its SHA-256 fingerprint."""
    data = cert_path.read_bytes()
    cert = x509.load_pem_x509_certificate(data)
    return get_cert_fingerprint(cert)


def get_or_create_tls_cert(
    hosts: list[str] | None = None,
    directory: Path | None = None,
) -> tuple[Path, Path, str]:
    """Retrieve existing TLS cert & key, or generate a new self-signed pair.

    Returns:
        tuple[cert_path, key_path, sha256_fingerprint]
    """
    cdir = directory or certs_dir()
    cert_path = cdir / CERT_FILENAME
    key_path = cdir / KEY_FILENAME

    if cert_path.exists() and key_path.exists():
        try:
            cert_bytes = cert_path.read_bytes()
            cert = x509.load_pem_x509_certificate(cert_bytes)
            # Verify cert is not expired
            now = datetime.datetime.now(datetime.timezone.utc)
            if cert.not_valid_before_utc <= now <= cert.not_valid_after_utc:
                fp = get_cert_fingerprint(cert)
                return cert_path, key_path, fp
            log.warning("Existing pairing cert is expired; regenerating")
        except Exception as exc:
            log.warning("Could not load existing pairing cert: %s; regenerating", exc)

    # Generate new RSA private key
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    # Build SAN list
    san_list: list[x509.GeneralName] = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    ]
    if hosts:
        for host in hosts:
            try:
                ip = ipaddress.ip_address(host)
                if x509.IPAddress(ip) not in san_list:
                    san_list.append(x509.IPAddress(ip))
            except ValueError:
                san_list.append(x509.DNSName(host))

    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "Amethyst Local Pairing"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Amethyst"),
        ]
    )

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(san_list), critical=False)
        .sign(key, hashes.SHA256())
    )

    # Write key (owner read/write only: 0o600)
    key_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    key_path.write_bytes(key_pem)
    key_path.chmod(0o600)

    # Write cert
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    cert_path.write_bytes(cert_pem)
    cert_path.chmod(0o644)

    fp = get_cert_fingerprint(cert)
    return cert_path, key_path, fp
