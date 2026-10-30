"""Publish a locally built APK for paired phones. No network upload.

Run from the repository: .venv/bin/python scripts/publish_android_update.py
Requires Gradle's output-metadata.json beside the APK.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile


def publish(build: Path, destination: Path):
    metadata = json.loads((build / 'output-metadata.json').read_text())
    if metadata['applicationId'] != 'app.amethyst.companion':
        raise ValueError('Not an Amethyst companion build')
    element, = metadata['elements']
    name = element['outputFile']
    if Path(name).name != name:
        raise ValueError('APK filename must be local to the build directory')
    apk = build / name
    with apk.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    release = dict(version_code=element['versionCode'], version=element['versionName'],
                   sha256=digest, size=apk.stat().st_size)
    destination.mkdir(parents=True, exist_ok=True)
    # Publish immutable bytes first, then atomically switch the manifest.
    with tempfile.NamedTemporaryFile(dir=destination, delete=False) as tmp:
        with apk.open('rb') as source:
            shutil.copyfileobj(source, tmp)
        temporary = Path(tmp.name)
    temporary.replace(destination / f'{digest}.apk')
    with tempfile.NamedTemporaryFile(mode='w', dir=destination, delete=False) as tmp:
        json.dump(release, tmp)
        temporary = Path(tmp.name)
    temporary.replace(destination / 'latest.json')
    return release


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', type=Path, default=Path('frontend/android/app/build/outputs/apk/debug'))
    args = parser.parse_args()
    home = Path(os.environ.get('AMETHYST_HOME', Path.home() / '.amethyst'))
    print(json.dumps(publish(args.build, home / 'mobile-updates')))
