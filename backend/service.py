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

from .cache import Cache
from .config import AppConfig, Dataset
from .sheets import SheetsAPI


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
    def snapshot(self) -> dict:
        """Everything the page needs, from the local cache (no network)."""
        out = {}
        for ds in self.cfg.datasets.values():
            item = {"title": ds.title, "description": ds.description, "kind": ds.kind, "write": ds.write}
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

    def refresh(self, ids: list[str] | None = None) -> dict:
        """Pull datasets from the Sheet into the cache, in one request."""
        targets = [self.dataset(i) for i in ids] if ids else [d for d in self.cfg.datasets.values() if d.kind == "sheet"]
        targets = [d for d in targets if d.kind == "sheet"]
        ranges: list[str] = []
        for d in targets:
            ranges.append(d.range.a1())
            ranges.append(d.range.header_a1() or d.range.a1())
        results = self.sheets.batch_get(self.cfg.spreadsheet_id, ranges)
        summary = {}
        for i, d in enumerate(targets):
            values = results[2 * i]
            header_rows = results[2 * i + 1] if d.range.header_a1() else []
            header = _pad(header_rows[0], d.range.width) if header_rows else []
            self.cache.put(d.id, range_a1=d.range.a1(), header=header, values=values, source="sheet")
            summary[d.id] = len(values)
        return summary

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

    # --------------------------------------------------------------- write
    def upsert(self, ds_id: str, new_row: list[str]) -> dict:
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

        live = [_pad(r, rng.width) for r in self.sheets.batch_get(self.cfg.spreadsheet_id, [rng.a1()])[0]]

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
            self.sheets.write_cells(self.cfg.spreadsheet_id, cells)
            self.refresh([ds.id])
        return {"action": action, "sheet_row": sheet_row, "cells_written": len(cells)}
