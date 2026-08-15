from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))

from rule_engine import inspect_page, inspect_rule, inspect_stamp, process_job


def main() -> int:
    request_path = Path(sys.argv[1])
    response_path = Path(sys.argv[2])
    request = json.loads(request_path.read_text(encoding="utf-8"))
    flag = request["flag"]
    payload = request["request"]
    try:
        if flag == "--inspect-json":
            result = inspect_stamp(payload["input_pdf"])
        elif flag == "--inspect-rule-json":
            result = inspect_rule(payload["input_pdf"], payload["rule"])
        elif flag == "--inspect-page-json":
            result = inspect_page(payload["input_pdf"], int(payload.get("page", 1)))
        elif flag == "--job-json":
            result = process_job(payload)
        else:
            raise ValueError("Неподдерживаемая команда PDF-движка")
        response_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        return 0
    except Exception as error:
        response_path.write_text(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), encoding="utf-8")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
