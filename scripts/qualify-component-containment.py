#!/usr/bin/env python3
"""PostgreSQL 16 toolchain helpers for the validate image.

The synthetic component-containment qualification that used them retired with
the experiment platform (#1649); these helpers stay because the validate image
and its tests still use them.

PostgreSQL toolchain resolver reuses agents verdify_campaign_ci.py at 26c275536.
"""

import hashlib
import http.client
import os
import subprocess
import time
import urllib.request
from pathlib import Path

PGDG_KEY_URL = "https://www.postgresql.org/media/keys/ACCC4CF8.asc"
PGDG_KEY_SHA256 = "0144068502a1eddd2a0280ede10ef607d1ec592ce819940991203941564e8e76"
# Vendored copy of the pinned key. CI egress to www.postgresql.org intermittently
# stalls in the TLS handshake, so the network is only a fallback when it is absent.
PGDG_KEY_FILE = Path(__file__).resolve().parent.parent / "db/qualification/pgdg-ACCC4CF8.asc"


def fetch_with_retry(url, attempts=3, timeout=30, backoff_seconds=5):
    """Read at most 64 KiB from `url`, retrying transient failures with exponential backoff."""
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return response.read(65536)
        except (OSError, http.client.HTTPException):
            if attempt == attempts:
                raise
            time.sleep(backoff_seconds * 2 ** (attempt - 1))


def pgdg_signing_key(vendored=PGDG_KEY_FILE) -> bytes:
    """The pinned PGDG key: the vendored copy, or a network fetch only when that file is missing."""
    raw = vendored.read_bytes() if vendored.is_file() else fetch_with_retry(PGDG_KEY_URL)
    if hashlib.sha256(raw).hexdigest() != PGDG_KEY_SHA256:
        raise RuntimeError("PGDG signing key does not match the pinned authority")
    return raw


def postgres_bin(workspace: Path, installed=Path("/usr/lib/postgresql/16/bin")) -> Path:
    if (installed / "initdb").is_file() and Path("/usr/share/postgresql/16/extension/pgcrypto.control").is_file():
        return installed
    # Migration 217 reads pg_auth_members.inherit_option, introduced in PG16.
    # Resolve signed Debian/PGDG packages in private state, download only, then
    # extract without running package installation scripts or starting services.
    package_root = workspace / "postgres-toolchain"
    package_root.mkdir()
    lists = package_root / "lists"
    (lists / "partial").mkdir(parents=True)
    archives = package_root / "archives"
    (archives / "partial").mkdir(parents=True)
    key = package_root / "pgdg.asc"
    key.write_bytes(pgdg_signing_key())
    sources = package_root / "pgdg.list"
    sources.write_text(f"deb [signed-by={key}] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main\n")
    apt = [
        "apt-get",
        "-o",
        f"Dir::State::lists={lists}",
        "-o",
        f"Dir::Cache::archives={archives}",
        "-o",
        f"Dir::Etc::sourcelist={sources}",
        "-o",
        "Debug::NoLocking=true",
        "-o",
        "Acquire::AllowInsecureRepositories=false",
        # Ride out transient egress stalls: fail a stalled connect or read after
        # 20 s (apt's default is 30 s) and retry each item up to 5 times; apt
        # backs off exponentially between retries.
        "-o",
        "Acquire::Retries=5",
        "-o",
        "Acquire::http::Timeout=20",
        "-o",
        "Acquire::https::Timeout=20",
    ]
    subprocess.run([*apt, "update"], check=True, cwd=package_root)
    subprocess.run(
        [
            *apt,
            "--download-only",
            "--reinstall",
            "--no-install-recommends",
            "-y",
            "install",
            "postgresql-16",
            "postgresql-client-16",
        ],
        check=True,
        cwd=package_root,
    )
    root = package_root / "root"
    for package in archives.glob("*.deb"):
        subprocess.run(["dpkg-deb", "-x", str(package), str(root)], check=True)
    binaries = root / "usr/lib/postgresql/16/bin"
    if (
        not (binaries / "initdb").is_file()
        or not (root / "usr/share/postgresql/16/extension/pgcrypto.control").is_file()
    ):
        raise RuntimeError("private PostgreSQL 16/pgcrypto toolchain is incomplete")
    libraries = sorted(str(p) for p in (root / "usr/lib").glob("*-linux-gnu") if p.is_dir())
    os.environ["LD_LIBRARY_PATH"] = os.pathsep.join(libraries)
    subprocess.run([str(binaries / "postgres"), "--version"], check=True)
    return binaries
