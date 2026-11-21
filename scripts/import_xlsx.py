"""Fill the local cache from an .xlsx export of the Sheet (no Google sign-in needed).

    python scripts/import_xlsx.py path/to/Indonesia-Economic-Outlook-Data.xlsx

In Google Sheets: File > Download > Microsoft Excel (.xlsx). Useful before you
have set up Google access, or to work offline from a saved copy.

The Sheets API returns cells as the text you see ("16,520.03", "31 Oct 2025"),
while .xlsx holds raw numbers and dates, so this script re-applies the common
number formats to give the page the same text the live Sheet would.
"""
from __future__ import annotations

import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import openpyxl  # noqa: E402

from backend.cache import Cache  # noqa: E402
from backend.config import load_config  # noqa: E402


def as_text(cell) -> str:
    v, fmt = cell.value, (cell.number_format or "General")
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (datetime, date)):
        if fmt.lower().startswith("yyyy-mm-dd"):
            return v.strftime("%Y-%m-%d")
        if "mmm" in fmt.lower():
            return f"{v.day} {v.strftime('%b')} {v.year}"
        return f"{v.month}/{v.day}/{v.year}"
    if isinstance(v, (int, float)):
        if "#,##0.00" in fmt:
            return f"{v:,.2f}"
        if "#,##0" in fmt:
            return f"{v:,.0f}"
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return "%.15g" % v
    return str(v)


def read_block(ws, first_row, last_row, first_col, last_col) -> list[list[str]]:
    last_row = last_row or ws.max_row
    rows = []
    for r in range(first_row, last_row + 1):
        row = [as_text(ws.cell(row=r, column=c + 1)) for c in range(first_col, last_col + 1)]
        while row and row[-1] == "":
            row.pop()  # the API leaves out empty cells at the end of a row
        rows.append(row)
    while rows and not rows[-1]:
        rows.pop()  # ... and empty rows at the end of a range
    return rows


def main(path: str) -> None:
    cfg = load_config()
    cache = Cache()
    wb = openpyxl.load_workbook(path, data_only=True)
    for ds in cfg.datasets.values():
        if ds.kind != "sheet":
            continue
        rng = ds.range
        if rng.tab not in wb.sheetnames:
            print(f"  skip {ds.id}: tab '{rng.tab}' not in workbook")
            continue
        ws = wb[rng.tab]
        values = read_block(ws, rng.first_row, rng.last_row, rng.first_col, rng.last_col)
        header = []
        if rng.first_row > 1:
            h = read_block(ws, rng.first_row - 1, rng.first_row - 1, rng.first_col, rng.last_col)
            header = (h[0] if h else []) + [""] * rng.width
            header = header[: rng.width]
        cache.put(ds.id, range_a1=rng.a1(), header=header, values=values, source="xlsx-import")
        print(f"  {ds.id:12s} {len(values):3d} rows  {rng.a1()}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
