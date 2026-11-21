"""Google Sheets access, signed in as you (OAuth "desktop app" flow).

First run: the app opens a browser, you sign in to Google and allow access to
your spreadsheets. Google returns a token, saved to secrets/token.json, so
later runs need no browser. Delete that file to sign out.

Only two operations are needed:
  * batch_get  - read several ranges in one request
  * write_cells - write individual cells (so formulas in other cells survive)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

from .config import CREDENTIALS_PATH, TOKEN_PATH

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


class SheetsNotAuthorized(RuntimeError):
    pass


class SheetsAPI(Protocol):
    """What the rest of the app needs from Google. Tests pass a fake."""

    def batch_get(self, spreadsheet_id: str, ranges: list[str]) -> list[list[list[str]]]: ...

    def write_cells(self, spreadsheet_id: str, cells: dict[str, str]) -> None: ...


class GoogleSheets:
    def __init__(self, credentials_path: Path = CREDENTIALS_PATH, token_path: Path = TOKEN_PATH):
        self.credentials_path = credentials_path
        self.token_path = token_path
        self._service = None

    # ---- sign-in ---------------------------------------------------------
    def _load_creds(self):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

        if not self.token_path.exists():
            return None
        creds = Credentials.from_authorized_user_file(str(self.token_path), SCOPES)
        if creds.valid:
            return creds
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception:
                return None
            self.token_path.write_text(creds.to_json(), encoding="utf-8")
            return creds
        return None

    def status(self) -> dict:
        """Cheap check, no network: is there a saved sign-in we can renew?

        (Renewing the sign-in talks to Google, so it happens inside a job,
        where it shows up as a progress step, not on every page load.)
        """
        signed_in = False
        if self.token_path.exists():
            try:
                signed_in = bool(json.loads(self.token_path.read_text(encoding="utf-8")).get("refresh_token"))
            except (OSError, ValueError):
                signed_in = False
        return {"has_credentials_file": self.credentials_path.exists(), "signed_in": signed_in}

    def ensure_signed_in(self, progress=None) -> None:
        """Renew the sign-in if needed (network). Raises if there is none."""
        if progress:
            progress.step("Memeriksa izin Google")
        self._svc()

    def sign_in(self, progress=None, timeout_seconds: int = 300) -> None:
        """Open the browser for Google sign-in and save the token."""
        from google_auth_oauthlib.flow import InstalledAppFlow

        if not self.credentials_path.exists():
            raise SheetsNotAuthorized(
                f"File credentials.json belum ada di {self.credentials_path}. "
                "Lihat README, bagian 'Connect Google Sheets'."
            )
        if progress:
            progress.step(f"Menunggu persetujuan Anda di tab browser yang terbuka (maks. {timeout_seconds // 60} menit)")
        flow = InstalledAppFlow.from_client_secrets_file(str(self.credentials_path), SCOPES)
        try:
            creds = flow.run_local_server(port=0, open_browser=True, timeout_seconds=timeout_seconds)
        except Exception as exc:
            raise SheetsNotAuthorized(f"Masuk Google tidak selesai ({type(exc).__name__}). Klik 'Hubungkan Google' lagi.") from exc
        if creds is None:
            raise SheetsNotAuthorized("Masuk Google tidak selesai (waktu habis). Klik 'Hubungkan Google' lagi.")
        if progress:
            progress.step("Menyimpan izin (secrets/token.json)")
        self.token_path.parent.mkdir(parents=True, exist_ok=True)
        self.token_path.write_text(creds.to_json(), encoding="utf-8")
        self._service = None

    def _svc(self):
        if self._service is None:
            from googleapiclient.discovery import build

            creds = self._load_creds()
            if creds is None:
                raise SheetsNotAuthorized("Belum masuk ke Google. Klik 'Hubungkan Google' di toolbar (lihat README).")
            self._service = build("sheets", "v4", credentials=creds, cache_discovery=False)
        return self._service

    # ---- data ------------------------------------------------------------
    def batch_get(self, spreadsheet_id: str, ranges: list[str]) -> list[list[list[str]]]:
        # FORMATTED_VALUE = the text you see in the Sheet ("16,520.03"),
        # the same shape the prototype's loaders were written against.
        resp = (
            self._svc()
            .spreadsheets()
            .values()
            .batchGet(spreadsheetId=spreadsheet_id, ranges=ranges, valueRenderOption="FORMATTED_VALUE")
            .execute()
        )
        return [vr.get("values", []) for vr in resp.get("valueRanges", [])]

    def write_cells(self, spreadsheet_id: str, cells: dict[str, str]) -> None:
        if not cells:
            return
        body = {
            # USER_ENTERED: Sheets parses "51.2" as a number, like typing it in.
            "valueInputOption": "USER_ENTERED",
            "data": [{"range": a1, "values": [[v]]} for a1, v in cells.items()],
        }
        self._svc().spreadsheets().values().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()
