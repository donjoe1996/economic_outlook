"""The JSON store, its Drive sync and the one-time conversion of the old cache."""
import json

import pytest

from backend import sync
from backend.config import AppConfig, Dataset, SheetRange
from backend.service import Service
from backend.store import Store, import_legacy_cache, md5_bytes


class FakeDrive:
    """A Drive folder in memory, reporting md5 like Drive does."""

    def __init__(self):
        self.files = {}      # id -> {"name", "data"}
        self.calls = []

    def _meta(self, fid):
        f = self.files[fid]
        return {"id": fid, "name": f["name"], "md5Checksum": md5_bytes(f["data"]), "modifiedTime": f.get("t", "")}

    def list_folder(self, folder):
        self.calls.append("list")
        return [self._meta(fid) for fid in self.files]

    def download(self, fid):
        self.calls.append(("download", self.files[fid]["name"]))
        return self.files[fid]["data"]

    def create(self, folder, name, data, mime="application/json"):
        fid = f"f{len(self.files) + 1}"
        self.files[fid] = {"name": name, "data": data}
        self.calls.append(("create", name))
        return self._meta(fid)

    def update(self, fid, data, mime="application/json"):
        self.files[fid]["data"] = data
        self.calls.append(("update", self.files[fid]["name"]))
        return self._meta(fid)

    def by_name(self, name):
        return next(fid for fid, f in self.files.items() if f["name"] == name)


def test_types_are_inferred_losslessly_and_read_back_as_text(tmp_path):
    st = Store(tmp_path)
    st.put("x", header=["Periode", "Nilai", "Tanggal", "Catatan"], source="t", values=[
        ["Okt'25", "16,520.03", "1/4/2016 16:00:00", "a"], ["Nov'25", "-3", "11/20/2026 16:00:00", ""],
        ["Des'25", "", "", "n/a"]])
    doc = st.typed("x")
    assert [f["type"] for f in doc["schema"]["fields"]] == ["string", "number", "date", "string"]
    assert doc["rows"] == [["Okt'25", 16520.03, "2016-01-04", "a"], ["Nov'25", -3, "2026-11-20"], ["Des'25", None, None, "n/a"]]
    assert st.get("x")["values"][1] == ["Nov'25", "-3", "2026-11-20"]
    # one text cell keeps the whole column as text
    st.put("y", header=["a"], values=[["1"], ["dua"]], source="t")
    assert st.typed("y")["schema"]["fields"][0]["type"] == "string"


def test_index_lists_every_dataset_with_its_hash(tmp_path):
    st = Store(tmp_path)
    st.put("a", header=["k"], values=[["1"]], source="t")
    pkg = json.loads(st.path("datapackage.json").read_text())
    assert pkg["resources"][0]["name"] == "a" and pkg["resources"][0]["hash"] == "md5:" + md5_bytes(st.path("a.json").read_bytes())


def test_push_then_pull_moves_only_what_changed(tmp_path):
    drive = FakeDrive()
    a = Store(tmp_path / "a")
    a.put("pmi", header=["P", "V"], values=[["Okt'26", "51"]], source="t")
    out = sync.push(a, drive, "folder")
    assert sorted(out["uploaded"]) == ["datapackage.json", "pmi.json"] and a.dirty() == []
    # a second machine pulls everything once, then nothing
    b = Store(tmp_path / "b")
    assert sorted(sync.pull(b, drive, "folder")["downloaded"]) == ["datapackage.json", "pmi.json"]
    assert b.get("pmi")["values"] == [["Okt'26", "51"]]
    drive.calls.clear()
    assert sync.pull(b, drive, "folder")["downloaded"] == [] and drive.calls == ["list"]
    # an edit on b reaches a; unchanged files are not sent again
    b.put("pmi", header=["P", "V"], values=[["Okt'26", "51"], ["Nov'26", "52"]], source="t")
    assert set(sync.push(b, drive, "folder")["uploaded"]) == {"pmi.json", "datapackage.json"}
    assert "pmi.json" in sync.pull(a, drive, "folder")["downloaded"]
    assert a.get("pmi")["values"][-1] == ["Nov'26", "52"]


def test_push_refuses_to_overwrite_a_newer_drive_version(tmp_path):
    drive = FakeDrive()
    a, b = Store(tmp_path / "a"), Store(tmp_path / "b")
    a.put("pmi", header=["P"], values=[["1"]], source="t")
    sync.push(a, drive, "folder")
    sync.pull(b, drive, "folder")
    b.put("pmi", header=["P"], values=[["2"]], source="t")
    sync.push(b, drive, "folder")                       # Drive now has b's version
    a.put("pmi", header=["P"], values=[["3"]], source="t")
    out = sync.push(a, drive, "folder")
    assert "pmi.json" in out["skipped"]                 # a must pull first
    res = sync.pull(a, drive, "folder")                 # changed on both sides: Drive wins, local kept aside
    assert res["conflicts"] == ["pmi.json"] and a.get("pmi")["values"] == [["2"]]
    assert any(p.name.startswith("pmi.local-") for p in (tmp_path / "a").glob("*.json"))


def test_old_cache_is_converted_once_with_derived_columns(tmp_path):
    old = tmp_path / "cache"
    old.mkdir()
    (old / "sbn.json").write_text(json.dumps({"header": ["Tanggal", "SBN", "UST"] + [""] * 5 + ["Selisih", "ISO"],
                                              "values": [["29 Apr 2026", "6.96", "4.1", "", "", "", "", "", "", ""]],
                                              "range": "'Yield SBN'!A2:J"}))
    cfg = AppConfig("x", {"sbn": Dataset("sbn", "SBN", range=SheetRange.parse("'Yield SBN'!A2:J"), write="append", derived=(
        {"col": 8, "op": "diff", "args": [1, 2], "round": 2}, {"col": 9, "op": "iso_date", "args": [0], "round": None}))})
    st = Store(tmp_path / "store")
    svc = Service(cfg, st, None)
    assert import_legacy_cache(cfg, st, old, derive=svc.derive) == ["sbn"]
    assert st.typed("sbn")["rows"][0][8:] == [2.86, "2026-04-29"]
    assert import_legacy_cache(cfg, st, old, derive=svc.derive) == []        # never twice


def test_service_writes_are_pushed_to_drive(tmp_path):
    drive = FakeDrive()
    cfg = AppConfig("x", {"pmi": Dataset("pmi", "PMI", range=SheetRange.parse("PMI!A2:B"), write="append")}, drive_folder="folder")
    st = Store(tmp_path)
    st.put("pmi", header=["P", "V"], values=[["Okt'26", "51"]], source="t")
    svc = Service(cfg, st, None, drive)
    svc.upsert("pmi", ["Nov'26", "52"])
    assert json.loads(drive.files[drive.by_name("pmi.json")]["data"])["rows"][-1] == ["Nov'26", 52]


def test_new_dataset_declared_by_columns_starts_from_the_editor(tmp_path):
    p = tmp_path / "d.yaml"
    p.write_text("spreadsheet_id: x\ndatasets:\n  ekspor: {title: Ekspor, columns: [Periode, Nilai, Unit], write: append}\n")
    from backend.config import load_config
    cfg = load_config(p, local_path=tmp_path / "none.json")
    svc = Service(cfg, Store(tmp_path / "s"), None)
    svc.save_table("ekspor", [["Okt'26", "21.5", "USD miliar"]])
    doc = svc.store.typed("ekspor")
    assert [f["name"] for f in doc["schema"]["fields"]] == ["Periode", "Nilai", "Unit"]
    assert doc["rows"] == [["Okt'26", 21.5, "USD miliar"]]
