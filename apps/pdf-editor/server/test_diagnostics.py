from __future__ import annotations

import asyncio
import os
import tempfile
import unittest


STATIC_ROOT = tempfile.TemporaryDirectory(prefix="locia-pdf-test-static-")
os.environ["PDF_EDITOR_STATIC_ROOT"] = STATIC_ROOT.name

from starlette.requests import Request
from starlette.responses import JSONResponse

from server.app import request_diagnostics


class RequestDiagnosticsTest(unittest.TestCase):
    def test_response_echoes_safe_client_request_id(self) -> None:
        request = Request({
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/health",
            "raw_path": b"/api/health",
            "query_string": b"",
            "headers": [(b"x-client-request-id", b"pdf-test-request-413")],
            "client": ("127.0.0.1", 1234),
            "server": ("127.0.0.1", 8000),
            "root_path": "",
        })

        async def call_next(_request: Request) -> JSONResponse:
            return JSONResponse({"status": "ok"})

        response = asyncio.run(request_diagnostics(request, call_next))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("X-Request-Id"), "pdf-test-request-413")


if __name__ == "__main__":
    unittest.main()
