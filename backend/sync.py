"""Keep data/store/ and the Drive folder the same.

Drive is the master copy; data/store/ is the working copy the page reads.

pull   one listing of the folder (names + md5), then download only the files
       whose md5 differs from the one recorded at the last sync. A file that
       changed on both sides is a conflict: the Drive version wins, and the
       local one is kept next to it as <name>.local-<time>.json.
push   upload every file changed here since the last sync. Before overwriting,
       the Drive md5 must still be the one recorded at the last sync
       (optimistic concurrency); if someone changed it in between, the file is
       skipped and reported, and the next pull brings their version.

Every transfer is checked against the md5 Drive reports, so a half-written
download can never replace a good local file.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .drive import DriveAPI
from .jobs import NO_PROGRESS, Progress
from .retry import short_error, with_retry
from .store import Store, md5_bytes


class SyncError(RuntimeError):
    pass


def _remote_index(drive: DriveAPI, folder: str) -> dict[str, dict]:
    files = with_retry(lambda: drive.list_folder(folder))
    out: dict[str, dict] = {}
    for f in files:
        name = f.get("name", "")
        if name.endswith(".json") and ".local-" not in name:
            # duplicates by name: keep the newest, like Drive's own UI does
            if name not in out or f.get("modifiedTime", "") > out[name].get("modifiedTime", ""):
                out[name] = f
    return out


def pull(store: Store, drive: DriveAPI, folder: str, progress: Progress = NO_PROGRESS) -> dict:
    if not folder:
        raise SyncError("Folder Drive untuk data belum diatur (store: drive_folder: di config/datasets.yaml).")
    progress.step("Membaca daftar file di folder Drive")
    remote = _remote_index(drive, folder)
    known = store.sync_state().get("files", {})
    got, conflicts, kept = [], [], []
    for name, f in sorted(remote.items()):
        local_path = store.path(name)
        local_md5 = md5_bytes(local_path.read_bytes()) if local_path.exists() else None
        last = known.get(name, {}).get("md5")
        if f.get("md5Checksum") == local_md5:
            if last != local_md5:
                store.set_sync(name, f["id"], local_md5)   # same content, just not recorded yet
            continue
        if f.get("md5Checksum") == last:
            kept.append(name)                              # only changed here: push will send it
            continue
        if local_md5 and last and local_md5 != last:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            local_path.rename(store.path(f"{name[:-5]}.local-{stamp}.json"))
            conflicts.append(name)
        progress.step(f"Mengunduh {name}")
        data = with_retry(lambda fid=f["id"]: drive.download(fid))
        if f.get("md5Checksum") and md5_bytes(data) != f["md5Checksum"]:
            raise SyncError(f"{name}: unduhan tidak utuh (md5 berbeda); salinan lokal tidak diganti.")
        tmp = local_path.with_suffix(".json.tmp")
        tmp.write_bytes(data)
        tmp.replace(local_path)
        store.set_sync(name, f["id"], md5_bytes(data))
        got.append(name)
    return {"downloaded": got, "conflicts": conflicts, "local_changes": kept, "remote_files": len(remote)}


def push(store: Store, drive: DriveAPI, folder: str, names: list[str] | None = None,
         progress: Progress = NO_PROGRESS) -> dict:
    if not folder:
        raise SyncError("Folder Drive untuk data belum diatur (store: drive_folder: di config/datasets.yaml).")
    todo = [n for n in (names if names is not None else store.dirty()) if store.path(n).exists()]
    if "datapackage.json" in store.dirty() and "datapackage.json" not in todo:
        todo.append("datapackage.json")             # the index follows every data change
    if not todo:
        return {"uploaded": [], "skipped": {}}
    remote = _remote_index(drive, folder)
    known = store.sync_state().get("files", {})
    sent, skipped = [], {}
    for name in todo:
        data = store.path(name).read_bytes()
        md5 = md5_bytes(data)
        f = remote.get(name)
        last = known.get(name, {}).get("md5")
        try:
            if f is None:
                progress.step(f"Mengunggah {name} (baru)")
                out = with_retry(lambda: drive.create(folder, name, data))
            elif f.get("md5Checksum") == md5:
                store.set_sync(name, f["id"], md5)
                continue
            elif last is not None and f.get("md5Checksum") != last and name != "datapackage.json":
                skipped[name] = "berubah di Drive sejak sinkron terakhir; tarik dulu"
                continue
            else:
                progress.step(f"Mengunggah {name}")
                out = with_retry(lambda fid=f["id"]: drive.update(fid, data))
        except Exception as exc:  # one file must not stop the others
            skipped[name] = short_error(exc)
            continue
        if out.get("md5Checksum") and out["md5Checksum"] != md5:
            skipped[name] = "unggahan tidak utuh (md5 berbeda)"
            continue
        store.set_sync(name, out["id"], md5)
        sent.append(name)
    for name, why in skipped.items():
        progress.warn(f"{name} tidak diunggah: {why}")
    return {"uploaded": sent, "skipped": skipped}
