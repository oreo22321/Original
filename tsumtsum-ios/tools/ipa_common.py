"""Shared helpers for working with an .ipa (zip with Payload/<App>.app/)."""
from __future__ import annotations

import plistlib
import zipfile
from dataclasses import dataclass


class IpaError(Exception):
    pass


@dataclass
class AppInfo:
    app_dir: str          # "Payload/Name.app/"
    bundle_id: str
    version: str
    build: str
    executable: str       # zip path of the main executable


def app_info(z: zipfile.ZipFile) -> AppInfo:
    apps = sorted({n.split("/")[1] for n in z.namelist()
                   if n.startswith("Payload/") and n.count("/") >= 2 and n.split("/")[1].endswith(".app")})
    if len(apps) != 1:
        raise IpaError(f"expected exactly one Payload/*.app, found {apps}")
    app_dir = f"Payload/{apps[0]}/"
    try:
        info = plistlib.loads(z.read(app_dir + "Info.plist"))
    except KeyError as e:
        raise IpaError("Info.plist missing") from e
    exe = info.get("CFBundleExecutable")
    if not exe:
        raise IpaError("CFBundleExecutable missing")
    return AppInfo(app_dir, info.get("CFBundleIdentifier", ""), info.get("CFBundleShortVersionString", ""),
                   info.get("CFBundleVersion", ""), app_dir + exe)
