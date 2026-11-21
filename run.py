"""Start the app:  python run.py   (then it opens http://127.0.0.1:8000)

Options:
    python run.py --port 8080
    python run.py --no-browser
    python run.py --reload        # restart on code changes, while developing
"""
import argparse
import threading
import webbrowser

import uvicorn


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-browser", action="store_true")
    p.add_argument("--reload", action="store_true")
    a = p.parse_args()
    url = f"http://127.0.0.1:{a.port}"
    if not a.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"Indonesia Economic Outlook -> {url}   (Ctrl+C to stop)")
    # 127.0.0.1 only: the app is reachable from this computer, not the network.
    uvicorn.run("backend.main:app", host="127.0.0.1", port=a.port, reload=a.reload)


if __name__ == "__main__":
    main()
