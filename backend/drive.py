"""Google Drive access for the data store, signed in as you (same sign-in as Sheets).

Only five operations, all inside one folder:
    list_folder   name, id, md5Checksum, modifiedTime of every file
    download      a file's bytes
    create        a new file in the folder
    update        new content for an existing file
    folder_url    link for the page

The app never touches anything outside the folder named in config/datasets.yaml
(store: drive_folder:), even though Google's permission covers your whole Drive.
"""
from __future__ import annotations

import io
from typing import Protocol


class DriveAPI(Protocol):
    def list_folder(self, folder_id: str) -> list[dict]: ...

    def download(self, file_id: str) -> bytes: ...

    def create(self, folder_id: str, name: str, data: bytes, mime: str = "application/json") -> dict: ...

    def update(self, file_id: str, data: bytes, mime: str = "application/json") -> dict: ...


def folder_url(folder_id: str) -> str:
    return f"https://drive.google.com/drive/folders/{folder_id}" if folder_id else ""


class GoogleDrive:
    """Drive v3 on top of the app's Google sign-in (backend/sheets.py)."""

    FIELDS = "id,name,md5Checksum,modifiedTime,size"

    def __init__(self, google):
        self.google = google          # GoogleSheets: owns the credentials
        self._service = None

    def _svc(self):
        if self._service is None:
            from googleapiclient.discovery import build

            self._service = build("drive", "v3", credentials=self.google.credentials(), cache_discovery=False)
        return self._service

    def list_folder(self, folder_id: str) -> list[dict]:
        out, token = [], None
        q = f"'{folder_id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
        while True:
            resp = self._svc().files().list(q=q, fields=f"nextPageToken,files({self.FIELDS})",
                                            pageSize=1000, pageToken=token,
                                            supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
            out += resp.get("files", [])
            token = resp.get("nextPageToken")
            if not token:
                return out

    def download(self, file_id: str) -> bytes:
        from googleapiclient.http import MediaIoBaseDownload

        buf = io.BytesIO()
        req = self._svc().files().get_media(fileId=file_id, supportsAllDrives=True)
        dl = MediaIoBaseDownload(buf, req)
        done = False
        while not done:
            _, done = dl.next_chunk()
        return buf.getvalue()

    def create(self, folder_id: str, name: str, data: bytes, mime: str = "application/json") -> dict:
        from googleapiclient.http import MediaIoBaseUpload

        media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime, resumable=False)
        return self._svc().files().create(body={"name": name, "parents": [folder_id]}, media_body=media,
                                          fields=self.FIELDS, supportsAllDrives=True).execute()

    def update(self, file_id: str, data: bytes, mime: str = "application/json") -> dict:
        from googleapiclient.http import MediaIoBaseUpload

        media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime, resumable=False)
        return self._svc().files().update(fileId=file_id, media_body=media, fields=self.FIELDS,
                                          supportsAllDrives=True).execute()
