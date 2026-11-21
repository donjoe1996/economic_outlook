"""The app's logic, independent of the web framework.

    Drive folder  <--sync-->  data/store/ (typed JSON)  --snapshot-->  page
    feed Sheets   --pull-->        ^                                    |
    (GOOGLEFINANCE)                +--- upsert / table edit / updater <-+

Manual datasets live only in the store; Sheets are read-only price feeds.

Keeping this separate from main.py means it can be tested with a fake Sheet
(tests/test_service.py) and reused from scripts.
"""
from __future__ import annotations

import json
import re
from datetime import date

from .drive import DriveAPI, folder_url
from .store import Store
from . import sync as drive_sync
from .freshness import Freshness, assess, parse_period
from .config import AppConfig, Dataset
from .jobs import NO_PROGRESS, Progress
from .retry import short_error, with_retry
from .sheets import SheetsAPI, SheetsNotAuthorized


class UserError(ValueError):
    """A problem the person can fix (bad input, wrong dataset). Shown as-is."""


_THOUSANDS = re.compile(r"^-?\d{1,3}(,\d{3})+(\.\d+)?$")


def parse_number(text: str) -> float | None:
    """'16,520.03' -> 16520.03, '51.2' -> 51.2, '' -> None. Raises on '51,2'."""
    t = str(text).strip().replace("%", "")
    if t == "":
        return None
    if "," in t and not _THOUSANDS.match(t):
        raise UserError(f"'{text}': pakai titik untuk desimal (51.2), bukan koma (51,2).")
    try:
        return float(t.replace(",", ""))
    except ValueError:
        return None


def _is_number(text: str) -> bool:
    try:
        return parse_number(text) is not None
    except UserError:
        return False


def _pad(row: list, width: int) -> list[str]:
    row = ["" if v is None else str(v) for v in row[:width]]
    return row + [""] * (width - len(row))


def _same(a: str, b: str) -> bool:
    if _is_number(a) and _is_number(b):
        return abs(parse_number(a) - parse_number(b)) < 1e-12
    return a.strip() == b.strip()


def _norm_key(v: str) -> str:
    return " ".join(str(v).split()).casefold()


class _StepsOnly(Progress):
    """Pass steps through but not counts, for a sub-task inside a bigger job."""

    def __init__(self, inner: Progress):
        self.inner = inner

    def step(self, text: str) -> None:
        self.inner.step(text)

    def warn(self, text: str) -> None:
        self.inner.warn(text)


class Service:
    def __init__(self, cfg: AppConfig, store: Store, sheets: SheetsAPI, drive: DriveAPI | None = None):
        self.cfg = cfg
        self.store = store
        self.cache = store        # older name, same object
        self.sheets = sheets
        self.drive = drive        # None: work locally, sync later

    # ---------------------------------------------------------------- drive
    @property
    def folder_url(self) -> str:
        return folder_url(self.cfg.drive_folder)

    def sync_pull(self, progress: Progress = NO_PROGRESS) -> dict | None:
        if not (self.drive and self.cfg.drive_folder):
            return None
        out = drive_sync.pull(self.store, self.drive, self.cfg.drive_folder, progress)
        for name in out["conflicts"]:
            progress.warn(f"{name} berubah di Drive dan di sini; versi Drive dipakai, versi lokal disimpan sebagai cadangan.")
        return out

    def sync_push(self, progress: Progress = NO_PROGRESS) -> dict | None:
        if not (self.drive and self.cfg.drive_folder):
            if self.store.dirty():
                progress.step("Drive belum terhubung: perubahan tersimpan lokal dan diunggah saat sinkron berikutnya")
            return None
        return drive_sync.push(self.store, self.drive, self.cfg.drive_folder, progress=progress)

    def store_status(self) -> dict:
        st = self.store.sync_state()
        return {"folder": self.cfg.drive_folder, "folder_url": self.folder_url, "drive": bool(self.drive),
                "dirty": self.store.dirty(), "synced_at": st.get("synced_at"), "files": len(self.store.files())}

    def dataset(self, ds_id: str) -> Dataset:
        ds = self.cfg.datasets.get(ds_id)
        if ds is None:
            raise UserError(f"Dataset '{ds_id}' tidak ada di config/datasets.yaml")
        return ds

    # ---------------------------------------------------------------- read
    def snapshot(self, group: str | None = None, ids: list[str] | None = None) -> dict:
        """Everything a page needs, from the local cache (no network).

        group: "macro" for the dashboard, "stock" for the stock pages.
        ids:   extra datasets by id (e.g. the stock page's macro context).
        Neither given: everything.
        """
        out = {}
        for ds in self.cfg.datasets.values():
            if (group or ids) and not (ds.group == group or (ids and ds.id in ids)):
                continue
            item = {"title": ds.title, "description": ds.description, "kind": ds.kind, "write": ds.write,
                    "source": ds.source if ds.kind == "sheet" else "file",
                    "sheet_url": (self.cfg.url_of(ds.spreadsheet) if ds.is_feed and ds.spreadsheet
                                  else self.folder_url or None) if ds.kind == "sheet" else None}
            if ds.kind == "file":
                try:
                    if ds.file.stat().st_size > 50_000:
                        # big static files (map shapes): own URL, so the browser caches them
                        item.update(status="ok", answer_url=f"/api/files/{ds.id}?v={int(ds.file.stat().st_mtime)}")
                    else:
                        item.update(status="ok", answer=json.loads(ds.file.read_text(encoding="utf-8")))
                except FileNotFoundError:
                    item.update(status="missing", message=f"File {ds.file.name} tidak ditemukan")
            else:
                doc = self.store.typed(ds.id)
                if doc is None:
                    item.update(status="missing", message=(
                        "Belum pernah ditarik dari Sheet" if ds.is_feed and (ds.spreadsheet or not ds.alias)
                        else "Spreadsheet-nya belum dibuat (tambahkan saham pertama untuk membuatnya)" if ds.is_feed
                        else "Belum ada di penyimpanan data"))
                else:
                    fields = doc.get("schema", {}).get("fields", [])
                    item.update(
                        status="ok",
                        # typed values; blanks as "" because the page's loaders were written for Sheet text
                        answer={"values": [["" if v is None else v for v in r] for r in doc.get("rows", [])]},
                        header=[f["name"] for f in fields],
                        types=[f["type"] for f in fields],
                        range=doc.get("origin"),
                        fetched_at=doc.get("updated_at"),
                        changed_at=doc.get("changed_at"),
                        stored_source=doc.get("source"),
                    )
            out[ds.id] = item
        return out

    def refresh(self, ids: list[str] | None = None, progress: Progress = NO_PROGRESS, batch: int = 4) -> dict:
        """Pull datasets from the Sheet into the cache.

        Asked in small batches (not one big request) so progress can be shown
        per batch. 27 datasets = 7 requests, well inside Google's limit of
        60 read requests per minute.

        One failure does not stop the pull:
          1. each batch is retried on transient errors (timeouts, 429, 5xx);
          2. if a batch still fails, its datasets are tried one by one, so a
             single broken tab (e.g. renamed) cannot block its neighbours;
          3. what still fails keeps its previous copy, is recorded for the
             metadata page, and is reported as a warning.
        Returns {"rows": {id: n_rows}, "failed": {id: message}}.
        """
        targets = [self.dataset(i) for i in ids] if ids else [d for d in self.cfg.datasets.values() if d.kind == "sheet"]
        targets = [d for d in targets if d.is_feed]
        # A spreadsheet alias with no id yet (the Saham sheet before the first
        # stock is added) is not an error: there is simply nothing to pull.
        targets = [d for d in targets if d.spreadsheet or not d.alias]
        rows: dict[str, int] = {}
        failed: dict[str, str] = {}
        progress.count(0, len(targets))
        self._remember_tabs({d.spreadsheet for d in targets})
        # a batch read covers one spreadsheet, so batch within each spreadsheet
        batches: list[list[Dataset]] = []
        for sid in dict.fromkeys(d.spreadsheet for d in targets):
            same = [d for d in targets if d.spreadsheet == sid]
            batches += [same[i:i + batch] for i in range(0, len(same), batch)]
        done = 0
        for group in batches:
            progress.step("Membaca dari Google Sheet: " + ", ".join(d.title for d in group))
            try:
                results = self._get_with_retry(group, progress)
            except SheetsNotAuthorized:
                raise  # nothing else can work without a sign-in
            except Exception as exc:
                if len(group) > 1:
                    progress.step(f"Batch gagal ({short_error(exc)}); mencoba satu per satu")
                results = None
            for i, d in enumerate(group):
                try:
                    if results is not None:
                        values, header_rows = results[2 * i], results[2 * i + 1]
                    else:
                        values, header_rows = self._get_with_retry([d], progress)
                    header = _pad(header_rows[0], d.range.width) if (header_rows and d.range.header_a1()) else []
                    self.store.put(d.id, range_a1=d.range.a1(), header=header, values=values, source="sheet",
                                   title=d.title, key=d.key)
                    self.cache.record(d.id, "pull", True)
                    rows[d.id] = len(values)
                except SheetsNotAuthorized:
                    raise
                except Exception as exc:
                    msg = short_error(exc)
                    failed[d.id] = msg
                    self.cache.record(d.id, "pull", False, msg)
                    progress.warn(f"{d.title}: tidak bisa ditarik ({msg}). Salinan lama tetap dipakai.")
            done += len(group)
            progress.count(done, len(targets))
        return {"rows": rows, "failed": failed}

    def _get_with_retry(self, group: list[Dataset], progress: Progress) -> list:
        ranges: list[str] = []
        for d in group:
            ranges.append(d.range.a1())
            ranges.append(d.range.header_a1() or d.range.a1())

        def note(attempt, exc, delay):
            progress.step(f"Percobaan {attempt} gagal ({short_error(exc)}); coba lagi dalam {delay:.0f} dtk")

        return with_retry(lambda: self.sheets.batch_get(group[0].spreadsheet, ranges), on_retry=note)

    def _remember_tabs(self, spreadsheet_ids: set[str]) -> None:
        """Tab ids let the metadata page link straight to each tab. Optional."""
        tab_ids = getattr(self.sheets, "tab_ids", None)
        if not tab_ids:
            return
        tabs = self.cache.meta().get("tabs", {})
        if tabs and not all(isinstance(v, dict) for v in tabs.values()):
            tabs = {}  # older single-spreadsheet format
        for sid in spreadsheet_ids:
            try:
                tabs[sid] = tab_ids(sid)
            except SheetsNotAuthorized:
                raise
            except Exception:
                pass  # links fall back to the spreadsheet itself
        self.cache.put_meta({"tabs": tabs})

    def describe(self) -> list[dict]:
        """Datasets with their columns, for the 'add data' form."""
        out = []
        for ds in self.cfg.datasets.values():
            item = {
                "id": ds.id,
                "title": ds.title,
                "description": ds.description,
                "kind": ds.kind,
                "write": ds.write,
                "has_updater": bool(ds.updater),
                "source": ds.source if ds.kind == "sheet" else "file",
                "editable": ds.writable,
                "derived": [d["col"] for d in ds.derived],
            }
            if ds.kind == "sheet":
                doc = self.store.get(ds.id) or {"header": list(ds.columns), "values": []}
                width = self._width(ds, doc)
                rows = [_pad(r, width) for r in doc["values"]]
                header = doc.get("header") or []
                types = [f["type"] for f in ((self.store.typed(ds.id) or {}).get("schema", {}).get("fields", []))]
                cols = []
                for c in range(width):
                    seen = [r[c] for r in rows if r[c].strip()]
                    distinct = list(dict.fromkeys(seen))
                    cols.append({
                        "index": c,
                        "name": (header[c] if c < len(header) and header[c] else f"Kolom {c + 1}"),
                        "numeric": (types[c] == "number") if c < len(types) else (len(seen) >= 2 and all(_is_number(v) for v in seen)),
                        "type": types[c] if c < len(types) else "string",
                        "derived": any(d["col"] == c for d in ds.derived),
                        "key": c in ds.key,
                        # repeated text (units, publishers, confidence) is offered as suggestions
                        "suggestions": [v for v in distinct if seen.count(v) > 1][:12],
                    })
                item.update(range=ds.range.a1(), columns=cols, last_rows=rows[-3:], fetched_at=doc.get("fetched_at"),
                            row_count=len(rows))
            out.append(item)
        return out

    # ------------------------------------------------------------ metadata
    # Order on the page: what needs action first.
    _RANK = {"error": 0, "late": 1, "due": 2, "stale": 3, "gaps": 4, "unknown": 5, "ok": 6, "snapshot": 7, "static": 8}

    def metadata(self, today: date | None = None) -> dict:
        """Per dataset: newest period, what should exist by now, blanks, last pull."""
        today = today or date.today()
        status = self.cache.status()
        tabs = self.cache.meta().get("tabs", {})
        if tabs and not all(isinstance(v, dict) for v in tabs.values()):
            tabs = {}
        items = []
        for ds in self.cfg.datasets.values():
            st = status.get(ds.id, {})
            item = {
                "id": ds.id, "title": ds.title, "description": ds.description, "kind": ds.kind,
                "write": ds.write, "group": ds.group, "frequency": ds.frequency, "lag_days": ds.lag_days,
                "stale_after_days": ds.stale_after_days, "release": ds.release,
                "release_url": ds.release_url, "note": ds.note, "updater": (ds.updater or {}).get("type"),
                "last_pull": st.get("pull"), "last_check": st.get("check"),
                "range": ds.range.a1() if ds.range else None,
                "sheet_link": None, "rows": 0, "gaps": [], "fetched_at": None, "changed_at": None,
            }
            if ds.kind == "file":
                f = assess("static", None, today)
                item.update(status=f.status, status_text=f.text)
                items.append(item)
                continue
            item.update(source=ds.source, editable=ds.writable)
            if ds.is_feed and ds.spreadsheet:
                sheet_tabs = tabs.get(ds.spreadsheet, {})
                item["sheet_link"] = self.cfg.url_of(ds.spreadsheet) + (f"#gid={sheet_tabs[ds.range.tab]}" if ds.range.tab in sheet_tabs else "")
            else:
                item["sheet_link"] = self.folder_url or None
            doc = self.store.get(ds.id)
            if doc is None:
                item.update(status="error", status_text="Belum pernah ditarik dari Sheet." if ds.is_feed else "Belum ada di penyimpanan data.")
                items.append(item)
                continue
            rows = [_pad(r, self._width(ds, doc)) for r in doc["values"]]
            pcol = ds.period_col if ds.period_col is not None else ds.key[0]
            vcol = ds.value_col
            ends, gaps = [], []
            for r in rows:
                end = parse_period(r[pcol]) if pcol < len(r) else None
                if end is None:
                    continue
                if vcol < len(r) and r[vcol].strip():
                    ends.append(end)
                elif end <= today:
                    gaps.append(r[ds.key[0]] or r[pcol])
            if ds.frequency == "snapshot" and not ends:
                f = Freshness("snapshot", f"Potret satu waktu ({ds.release or 'tanpa tanggal'}). Perbarui bila ada rilis baru.")
            else:
                f = assess(ds.frequency, max(ends) if ends else None, today, ds.lag_days, ds.stale_after_days)
            state, text = f.status, f.text
            if gaps and state in ("ok", "snapshot", "unknown"):
                state = "gaps"
            if gaps:
                text += f" {len(gaps)} periode masih kosong: {', '.join(gaps[:6])}{' …' if len(gaps) > 6 else ''}."
            if st.get("pull") and not st["pull"]["ok"]:
                state = "error"
                text = f"Tarikan terakhir gagal ({st['pull']['message']}); yang tampil salinan lama. " + text
            item.update(
                status=state, status_text=text, latest=f.latest, expected=f.expected, behind=f.behind,
                next_release=f.next_release, rows=len(rows), gaps=gaps,
                fetched_at=doc.get("fetched_at"), changed_at=doc.get("changed_at"), source=doc.get("source"),
            )
            items.append(item)
        items.sort(key=lambda x: (self._RANK.get(x["status"], 9), x["title"]))
        counts: dict[str, int] = {}
        for it in items:
            counts[it["status"]] = counts.get(it["status"], 0) + 1
        return {"today": today.isoformat(), "sheet_url": self.cfg.sheet_url, "counts": counts, "datasets": items,
                "store": self.store_status()}

    # --------------------------------------------------------------- write
    def upsert(self, ds_id: str, new_row: list[str], progress: Progress = NO_PROGRESS) -> dict:
        """Add a new period, or fill/correct an existing one, in the Sheet.

        Only cells you filled in are written, one by one, so formulas and
        notes in the other cells of that row stay untouched.
        """
        out = self.upsert_many(ds_id, [new_row], progress=progress)
        r = out["results"][0]
        return {"action": r["action"], "sheet_row": r["sheet_row"], "cells_written": out["cells_written"]}

    @staticmethod
    def _width(ds: Dataset, doc: dict | None) -> int:
        w = ds.range.width if ds.range else 0
        if doc:
            w = max([w, len(doc.get("header") or [])] + [len(r) for r in doc.get("values", [])])
        return w

    def _writable(self, ds: Dataset) -> None:
        if ds.is_feed:
            raise UserError(f"'{ds.title}' diisi rumus GOOGLEFINANCE di Google Sheet (feed), jadi hanya-baca di aplikasi.")
        if not ds.writable:
            raise UserError(f"'{ds.title}' hanya-baca (write: {ds.write}).")

    def _check_types(self, ds: Dataset, row: list[str], types: list[str]) -> None:
        derived = {d["col"] for d in ds.derived}
        for c, v in enumerate(row):
            if not v or c in derived or c >= len(types):
                continue
            if types[c] == "number" and parse_number(v) is None:
                raise UserError(f"Kolom {c + 1} berisi angka, tetapi '{v}' bukan angka.")

    def _types(self, ds: Dataset, rows: list[list[str]], width: int) -> list[str]:
        """Column types: the stored schema, else what the rows hold today."""
        stored = self.store.typed(ds.id) or {}
        fields = stored.get("schema", {}).get("fields", []) if stored.get("rows") else []
        out = []
        for c in range(width):
            if c < len(fields):
                out.append(fields[c]["type"])
            else:
                seen = [r[c] for r in rows if c < len(r) and r[c].strip()]
                out.append("number" if len(seen) >= 2 and all(_is_number(v) for v in seen) else "string")
        return out

    def derive(self, ds: Dataset, rows: list[list[str]]) -> list[list[str]]:
        """Recompute the dataset's derived columns (what Sheet formulas used to do)."""
        if not ds.derived:
            return rows
        lookups = {}
        for d in ds.derived:
            if d["op"] == "lookup" and d["dataset"] not in lookups:
                src = (self.store.get(d["dataset"]) or {}).get("values", [])
                lookups[d["dataset"]] = {_norm_key(r[d["key"]]): (r[d["value"]] if d["value"] < len(r) else "")
                                         for r in src if d["key"] < len(r)}
        out = []
        for r in rows:
            r = list(r)
            for d in ds.derived:
                while len(r) <= d["col"]:
                    r.append("")
                args = [r[a] if a < len(r) else "" for a in d["args"]]
                nums = [parse_number(a) if _is_number(a) else None for a in args]
                val = ""
                if d["op"] == "diff" and None not in nums and len(nums) == 2:
                    val = nums[0] - nums[1]
                elif d["op"] == "pct_change" and None not in nums and len(nums) == 2 and nums[0]:
                    val = (nums[1] / nums[0] - 1) * 100
                elif d["op"] == "iso_date":
                    p = parse_period(args[0]) if args else None
                    val = p.isoformat() if p else ""
                elif d["op"] == "lookup":
                    val = lookups.get(d["dataset"], {}).get(_norm_key(args[0]) if args else "", "")
                if isinstance(val, float):
                    val = round(val, d["round"]) if d.get("round") is not None else val
                    val = repr(float(val)).rstrip("0").rstrip(".") if not float(val).is_integer() else str(int(val))
                r[d["col"]] = str(val)
            out.append(r)
        return out

    def _save(self, ds: Dataset, header: list[str], rows: list[list[str]], source: str) -> dict:
        rows = self.derive(ds, rows)
        # types are inferred from the full table on every save (lossless: one
        # text cell keeps a column as text; the form check stops that for number columns)
        doc = self.store.put(ds.id, header=header, values=rows, source=source, title=ds.title, key=ds.key,
                             range_a1=ds.range.a1() if ds.range else None)
        # datasets that look values up in this one (rotation <- flow)
        for other in self.cfg.datasets.values():
            if other.id != ds.id and any(d["op"] == "lookup" and d["dataset"] == ds.id for d in other.derived):
                cur = self.store.get(other.id)
                if cur:
                    self.store.put(other.id, header=cur["header"], values=self.derive(other, cur["values"]),
                                   source=source, title=other.title, key=other.key)
        return doc

    def upsert_many(self, ds_id: str, new_rows: list[list[str]], progress: Progress = NO_PROGRESS,
                    source: str = "app", push: bool = True) -> dict:
        """Add or update rows, matched by the dataset's key columns.

        Only cells you filled in change; blanks in new_rows leave the stored
        value alone. One save to the store, then one upload to Drive.
        """
        ds = self.dataset(ds_id)
        self._writable(ds)
        doc = self.store.get(ds.id) or {"header": list(ds.columns), "values": []}
        width = self._width(ds, doc)
        live = [_pad(r, width) for r in doc["values"]]
        header = _pad(doc.get("header") or list(ds.columns), width)
        types = self._types(ds, live, width)
        progress.step(f"Memeriksa isian untuk '{ds.title}'")
        derived = {d["col"] for d in ds.derived}
        cells = 0
        results = []
        for new_row in new_rows:
            new = [v.strip() for v in _pad(new_row, width)]
            if any(not new[k] for k in ds.key):
                names = ", ".join(str(k + 1) for k in ds.key)
                raise UserError(f"Kolom kunci (kolom {names}) wajib diisi, misalnya periode.")
            self._check_types(ds, new, types)
            key = tuple(_norm_key(new[k]) for k in ds.key)
            match = next((i for i, r in enumerate(live) if tuple(_norm_key(r[k]) for k in ds.key) == key), None)
            if match is not None:
                changed = [c for c in range(width)
                           if c not in ds.key and c not in derived and new[c] and not _same(new[c], live[match][c])]
                for c in changed:
                    live[match][c] = new[c]
                action, row_no = ("update" if changed else "unchanged"), match + 1
            elif ds.write == "append":
                changed = [c for c in range(width) if new[c] and c not in derived]
                live.append([new[c] if c not in derived else "" for c in range(width)])
                action, row_no = "append", len(live)
            else:
                keys = ", ".join(r[ds.key[0]] for r in live if r[ds.key[0]]) or "-"
                raise UserError(
                    f"'{new[ds.key[0]]}' belum ada di tabel ini. Mode 'fill' hanya mengisi baris yang sudah ada ({keys}). "
                    "Tambahkan barisnya lewat editor tabel di halaman Metadata.")
            cells += len(changed)
            results.append({"key": [new[k] for k in ds.key], "action": action, "sheet_row": row_no, "cells": len(changed)})
        if cells:
            progress.step(f"Menyimpan {cells} sel ke {ds.id}.json")
            self._save(ds, header, live, source)
            if push:
                self.sync_push(progress)
        return {"results": results, "cells_written": cells}

    def save_table(self, ds_id: str, rows: list[list[str]], progress: Progress = NO_PROGRESS) -> dict:
        """Replace a dataset's rows with an edited table (the in-app editor).

        Checks every row like upsert does, plus unique keys; derived columns
        are recomputed, so whatever the editor sent for them is ignored.
        """
        ds = self.dataset(ds_id)
        self._writable(ds)
        doc = self.store.get(ds.id) or {"header": list(ds.columns), "values": []}
        width = max([self._width(ds, doc)] + [len(r) for r in rows])
        header = _pad(doc.get("header") or list(ds.columns), width)
        clean = [[("" if v is None else str(v)).strip() for v in _pad(r, width)] for r in rows]
        clean = [r for r in clean if any(r)]                      # drop fully blank rows
        types = self._types(ds, [_pad(r, width) for r in doc["values"]], width)
        seen = set()
        for i, r in enumerate(clean, 1):
            if any(not r[k] for k in ds.key):
                raise UserError(f"Baris {i}: kolom kunci ({', '.join(header[k] or str(k + 1) for k in ds.key)}) wajib diisi.")
            try:
                self._check_types(ds, r, types)
            except UserError as exc:
                raise UserError(f"Baris {i}: {exc}") from None
            key = tuple(_norm_key(r[k]) for k in ds.key)
            if key in seen:
                raise UserError(f"Baris {i}: kunci '{' / '.join(r[k] for k in ds.key)}' muncul dua kali.")
            seen.add(key)
        before = len(doc["values"])
        progress.step(f"Menyimpan {len(clean)} baris ke {ds.id}.json")
        self._save(ds, header, clean, "app")
        self.sync_push(progress)
        return {"rows": len(clean), "before": before}
