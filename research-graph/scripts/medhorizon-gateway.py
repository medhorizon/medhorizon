#!/usr/bin/env python3
"""MedHorizon companion gateway — inject Research Graph sidebar card (no core edits)."""

from __future__ import annotations

import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

ORIGIN = os.environ.get("MEDHORIZON_ORIGIN", "http://127.0.0.1:4444").rstrip("/")
API = os.environ.get("RESEARCH_GRAPH_API", "http://127.0.0.1:8000").rstrip("/")
PORT = int(os.environ.get("GATEWAY_PORT", "5199"))
SNIPPET = f'<script src="{API}/embed/sidebar-card.js" data-rg-api="{API}" defer></script>'


def inject(html: str) -> str:
    if "sidebar-card.js" in html or "data-rg-card" in html:
        return html
    if "</head>" in html:
        return html.replace("</head>", f"{SNIPPET}\n</head>", 1)
    if "</body>" in html:
        return html.replace("</body>", f"{SNIPPET}\n</body>", 1)
    return html + SNIPPET


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        self._proxy()

    def do_POST(self):  # noqa: N802
        self._proxy()

    def log_message(self, fmt: str, *args) -> None:
        print(f"[gateway] {self.address_string()} {fmt % args}")

    def _proxy(self) -> None:
        target = f"{ORIGIN}{self.path}"
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in {"host", "accept-encoding"}}
        req = Request(target, data=body, headers=headers, method=self.command)
        with urlopen(req, timeout=30) as res:  # noqa: S310 — local loopback proxy
            data = res.read()
            ctype = res.headers.get("Content-Type", "")
            out = data
            if "text/html" in ctype:
                out = inject(data.decode("utf-8", errors="ignore")).encode("utf-8")
            self.send_response(res.status)
            for key, value in res.headers.items():
                if key.lower() in {"content-encoding", "content-length", "transfer-encoding"}:
                    continue
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)


if __name__ == "__main__":
    print(f"Research Graph gateway → MedHorizon {ORIGIN}")
    print(f"Open http://127.0.0.1:{PORT}  (injects sidebar card from {API})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
