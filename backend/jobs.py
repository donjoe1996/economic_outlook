"""Background jobs with progress, so the page can show what the app is doing.

Slow actions (Google sign-in, pulling from the Sheet, writing rows, asking
FRED) run in a thread. While they run, they report steps:

    def work(progress):
        progress.step("Membaca PMI dari Google Sheet")
        progress.count(3, 27)            # optional: 3 of 27 done
        return {"rows": 12}

The page starts a job (POST), gets its id, then asks GET /api/jobs/<id> a few
times per second and draws a progress bar from `done`/`total` and `steps`.
"""
from __future__ import annotations

import itertools
import threading
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable


class Progress:
    """What a job's work function uses to report. Also a no-op default."""

    def step(self, text: str) -> None: ...

    def count(self, done: int, total: int) -> None: ...

    def warn(self, text: str) -> None:
        """Something was skipped, but the job carries on."""


NO_PROGRESS = Progress()


@dataclass
class Job(Progress):
    id: str
    kind: str
    title: str
    state: str = "running"  # running | done | partial (done, with warnings) | error
    steps: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    done: int = 0
    total: int = 0
    result: Any = None
    error: str | None = None
    started: float = field(default_factory=time.time)
    finished: float | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def step(self, text: str) -> None:
        with self._lock:
            now = time.time()
            if self.steps and self.steps[-1]["end"] is None:
                self.steps[-1]["end"] = now
            self.steps.append({"text": text, "start": now, "end": None})

    def count(self, done: int, total: int) -> None:
        with self._lock:
            self.done, self.total = done, total

    def warn(self, text: str) -> None:
        with self._lock:
            self.warnings.append(text)

    def view(self) -> dict:
        with self._lock:
            now = self.finished or time.time()
            return {
                "id": self.id,
                "kind": self.kind,
                "title": self.title,
                "state": self.state,
                "done": self.done,
                "total": self.total,
                "current": self.steps[-1]["text"] if self.steps else self.title,
                "steps": [
                    {"text": s["text"], "seconds": round((s["end"] or now) - s["start"], 1), "open": s["end"] is None}
                    for s in self.steps
                ],
                "elapsed": round(now - self.started, 1),
                "warnings": list(self.warnings),
                "result": self.result,
                "error": self.error,
            }


class JobRunner:
    """Starts jobs in threads and keeps the most recent ones for the page."""

    def __init__(self, keep: int = 20):
        self._jobs: dict[str, Job] = {}
        self._ids = itertools.count(1)
        self._lock = threading.Lock()
        self._keep = keep

    def start(self, kind: str, title: str, work: Callable[[Job], Any]) -> Job:
        with self._lock:
            # One job of a kind at a time: a second click joins the running one.
            for j in self._jobs.values():
                if j.kind == kind and j.state == "running":
                    return j
            job = Job(id=str(next(self._ids)), kind=kind, title=title)
            self._jobs[job.id] = job
            for old in list(self._jobs)[: max(0, len(self._jobs) - self._keep)]:
                if self._jobs[old].state != "running":
                    del self._jobs[old]

        def run():
            try:
                job.result = work(job)
                job.state = "partial" if job.warnings else "done"
            except Exception as exc:  # shown on the page, so keep the message readable
                job.error = str(exc) or type(exc).__name__
                job.state = "error"
                traceback.print_exc()
            finally:
                job.finished = time.time()
                job.step({"done": "Selesai", "partial": f"Selesai dengan {len(job.warnings)} peringatan"}.get(job.state, "Gagal"))
                with job._lock:
                    job.steps[-1]["end"] = job.finished

        threading.Thread(target=run, name=f"job-{kind}-{job.id}", daemon=True).start()
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def recent(self) -> list[dict]:
        return [j.view() for j in reversed(list(self._jobs.values()))]
