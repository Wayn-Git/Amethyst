"""Paired-device access to an Android build published on this desktop."""
import json
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.config import amethyst_home

router = APIRouter(prefix='/api/mobile/update', tags=['mobile'])


def published():
    folder = amethyst_home() / 'mobile-updates'
    try:
        data = json.loads((folder / 'latest.json').read_text())
        digest = data['sha256']
        if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError('Invalid digest')
        if type(data['version_code']) is not int or data['version_code'] < 1:
            raise ValueError('Invalid version')
        path = folder / f'{digest}.apk'
        if path.is_symlink() or not path.is_file() or path.stat().st_size != data['size']:
            raise ValueError('APK missing or incomplete')
        return {key: data[key] for key in ('version_code', 'version', 'sha256', 'size')}, path
    except FileNotFoundError:
        raise HTTPException(404, 'No Android update has been published on this desktop')
    except (ValueError, KeyError, TypeError):
        raise HTTPException(503, 'The desktop Android update is incomplete')


@router.get('')
def latest():
    metadata, _ = published()
    return metadata


@router.get('/apk')
def apk():
    metadata, path = published()
    return FileResponse(path, media_type='application/vnd.android.package-archive',
                        filename=f'Amethyst-{metadata["version_code"]}.apk',
                        headers={'Cache-Control': 'no-store'})
