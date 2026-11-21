"""The app's logic, independent of the web framework.

    Sheet  --refresh-->  cache  --snapshot-->  page
      ^                                          |
      +---------- upsert (form / updater) <------+

Keeping this separate from main.py means it can be tested with a fake Sheet
(tests/test_service.py) and reused from scripts.
"""
from __future__ import annotations

import json
import re
from datetime import date

from .cache import Cache
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
    def __init__(self, cfg: AppConfig, cache: Cache, sheets: SheetsAPI):
        self.cfg = cfg
        self.cache = cache
        self.sheets = sheets

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
                    "sheet_url": self.cfg.url_of(ds.spreadsheet) if ds.kind == "sheet" else None}
            if ds.kind == "file":
                try:
                    item.update(status="ok", answer=json.loads(ds.file.read_text(encoding="utf-8")))
                except FileNotFoundError:
                    item.update(status="missing", message=f"File {ds.file.name} tidak ditemukan")
            else:
                doc = self.cache.get(ds.id)
                if doc is None:
                    item.update(status="missing", message="Belum pernah ditarik dari Sheet")
                else:
                    item.update(
                        status="ok",
                        answer={"values": doc["values"]},
                        header=doc.get("header", []),
                        range=doc.get("range"),
                        fetched_at=doc.get("fetched_at"),
                        source=doc.get("source"),
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
        targets = [d for d in targets if d.kind == "sheet"]
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
                    self.cache.put(d.id, range_a1=d.range.a1(), header=header, values=values, source="sheet")
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
            }
            if ds.kind == "sheet":
                doc = self.cache.get(ds.id) or {"header": [], "values": []}
                rows = [_pad(r, ds.range.width) for r in doc["values"]]
                header = doc.get("header") or []
                cols = []
                for c in range(ds.range.width):
                    seen = [r[c] for r in rows if r[c].strip()]
                    distinct = list(dict.fromkeys(seen))
                    cols.append({
                        "index": c,
                        "name": (header[c] if c < len(header) and header[c] else f"Kolom {c + 1}"),
                        "numeric": len(seen) >= 2 and all(_is_number(v) for v in seen),
                        "key": c in ds.key,
                        # repeated text (units, publishers, confidence) is offered as suggestions
                        "suggestions": [v for v in distinct if seen.count(v) > 1][:12],
                    })
                item.update(range=ds.range.a1(), columns=cols, last_rows=rows[-3:], fetched_at=doc.get("fetched_at"))
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
            sheet_tabs = tabs.get(ds.spreadsheet, {})
            item["sheet_link"] = self.cfg.url_of(ds.spreadsheet) + (f"#gid={sheet_tabs[ds.range.tab]}" if ds.range.tab in sheet_tabs else "")
            doc = self.cache.get(ds.id)
            if doc is None:
                item.update(status="error", status_text="Belum pernah ditarik dari Sheet.")
                items.append(item)
                continue
            rows = [_pad(r, ds.range.width) for r in doc["values"]]
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
        return {"today": today.isoformat(), "sheet_url": self.cfg.sheet_url, "counts": counts, "datasets": items}

    # --------------------------------------------------------------- write
    def upsert(self, ds_id: str, new_row: list[str], progress: Progress = NO_PROGRESS) -> dict:
        """Add a new period, or fill/correct an existing one, in the Sheet.

        Only cells you filled in are written, one by one, so formulas and
        notes in the other cells of that row stay untouched.
        """
        ds = self.dataset(ds_id)
        if not ds.writable:
            raise UserError(f"'{ds.title}' hanya-baca (write: {ds.write}). Ubah langsung di Google Sheet.")
        rng = ds.range
        new = _pad(new_row, rng.width)
        new = [v.strip() for v in new]
        if any(not new[k] for k in ds.key):
            names = ", ".join(str(k + 1) for k in ds.key)
            raise UserError(f"Kolom kunci (kolom {names}) wajib diisi, misalnya periode.")

        progress.step(f"Membaca tabel '{ds.title}' terbaru dari Sheet")
        live = [_pad(r, rng.width) for r in self.sheets.batch_get(ds.spreadsheet, [rng.a1()])[0]]
        progress.step("Memeriksa isian")

        # Check numbers against columns that hold only numbers today.
        for c in range(rng.width):
            seen = [r[c] for r in live if r[c].strip()]
            if new[c] and len(seen) >= 2 and all(_is_number(v) for v in seen) and parse_number(new[c]) is None:
                raise UserError(f"Kolom {c + 1} berisi angka, tetapi '{new[c]}' bukan angka.")

        key = tuple(_norm_key(new[k]) for k in ds.key)
        match = next((i for i, r in enumerate(live) if tuple(_norm_key(r[k]) for k in ds.key) == key), None)

        if match is not None:
            sheet_row = rng.first_row + match
            cells = {
                rng.cell_a1(sheet_row, c): new[c]
                for c in range(rng.width)
                if c not in ds.key and new[c] and not _same(new[c], live[match][c])
            }
            action = "update" if cells else "unchanged"
        elif ds.write == "append":
            sheet_row = rng.first_row + len(live)
            cells = {rng.cell_a1(sheet_row, c): new[c] for c in range(rng.width) if new[c]}
            action = "append"
        else:
            keys = ", ".join(live[i][ds.key[0]] for i in range(len(live)) if live[i][ds.key[0]]) or "-"
            raise UserError(
                f"'{new[ds.key[0]]}' belum ada di tabel ini. Mode 'fill' hanya mengisi baris yang sudah ada ({keys}). "
                "Tambahkan barisnya di Sheet lalu perlebar range di config/datasets.yaml."
            )

        if cells:
            progress.step(f"Menulis {len(cells)} sel ke baris {sheet_row} ({new[ds.key[0]]})")
            self.sheets.write_cells(ds.spreadsheet, cells)
            pulled = self.refresh([ds.id], progress=_StepsOnly(progress))
            if pulled["failed"]:
                progress.warn("Tersimpan di Sheet, tetapi salinan lokal belum diperbarui. Klik 'Tarik dari Sheet' nanti.")
        return {"action": action, "sheet_row": sheet_row, "cells_written": len(cells)}
