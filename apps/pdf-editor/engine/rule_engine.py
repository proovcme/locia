from __future__ import annotations

import json
import base64
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable


HERE = Path(__file__).resolve().parent
for vendor in (HERE / "vendor", HERE.parent / "vendor"):
    if vendor.exists():
        sys.path.insert(0, str(vendor))

import pymupdf


# Ensure UTF-8 output
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")

MM = 72 / 25.4
SPDS_WIDTH_MM = 185
SPDS_HEIGHT_MM = 55


@dataclass
class Operation:
    page: int
    rule_id: str
    rule_name: str
    action: str
    old: str
    new: str
    rect: list[float]
    confidence: str = "high"


def hex_color(value: str | None, default: tuple[float, float, float]) -> tuple[float, float, float]:
    if not value:
        return default
    value = value.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(char * 2 for char in value)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", value):
        return default
    return tuple(int(value[index:index + 2], 16) / 255 for index in (0, 2, 4))


def parse_pages(value: str, count: int) -> set[int]:
    if not value or str(value).strip().casefold() in {"all", "все", "*"}:
        return set(range(1, count + 1))
    pages: set[int] = set()
    for item in str(value).split(","):
        item = item.strip()
        if not item:
            continue
        if "-" in item:
            start, end = item.split("-", 1)
            pages.update(range(max(1, int(start)), min(count, int(end)) + 1))
        else:
            page = int(item)
            if 1 <= page <= count:
                pages.add(page)
    return pages


def apply_page_operations(
    document: pymupdf.Document,
    operations: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Apply structural operations in order and defer extracts until content edits are complete."""
    completed: list[dict[str, Any]] = []
    extracts: list[dict[str, Any]] = []
    for index, operation in enumerate(operations, start=1):
        operation_type = str(operation.get("type", "")).strip()
        if not operation_type:
            continue
        if operation_type == "extract":
            extracts.append(operation)
            continue
        before = len(document)
        pages = sorted(parse_pages(operation.get("pages", "all"), before)) if operation_type != "insert_pdf" else []
        if operation_type == "delete":
            if not pages:
                raise ValueError(f"Операция {index}: не указаны страницы для удаления")
            if len(pages) >= before:
                raise ValueError(f"Операция {index}: нельзя удалить все страницы документа")
            for page_number in reversed(pages):
                document.delete_page(page_number - 1)
        elif operation_type == "keep":
            if not pages:
                raise ValueError(f"Операция {index}: не указаны страницы, которые нужно оставить")
            document.select([page_number - 1 for page_number in pages])
        elif operation_type == "rotate":
            angle = int(operation.get("angle", 90))
            if angle not in {90, 180, 270}:
                raise ValueError(f"Операция {index}: поворот должен быть 90, 180 или 270 градусов")
            for page_number in pages:
                page = document[page_number - 1]
                page.set_rotation((page.rotation + angle) % 360)
        elif operation_type == "duplicate":
            if not pages:
                raise ValueError(f"Операция {index}: не указаны страницы для дублирования")
            for page_number in pages:
                document.copy_page(page_number - 1)
        elif operation_type == "insert_pdf":
            source_path = Path(str(operation.get("source_pdf", ""))).resolve()
            if not source_path.exists():
                raise FileNotFoundError(f"Операция {index}: не найден добавляемый PDF: {source_path}")
            source = pymupdf.open(source_path)
            try:
                source_pages = sorted(parse_pages(operation.get("pages", "all"), len(source)))
                if not source_pages:
                    raise ValueError(f"Операция {index}: в добавляемом PDF не выбраны страницы")
                position_value = str(operation.get("position", "end")).strip().casefold()
                insertion_index = -1 if position_value in {"end", "конец", ""} else max(0, min(len(document), int(position_value) - 1))
                for source_page in source_pages:
                    document.insert_pdf(source, from_page=source_page - 1, to_page=source_page - 1, start_at=insertion_index)
                    if insertion_index >= 0:
                        insertion_index += 1
            finally:
                source.close()
        else:
            raise ValueError(f"Операция {index}: неизвестное действие со страницами: {operation_type}")
        completed.append({
            "index": index,
            "type": operation_type,
            "pages": pages,
            "page_count_before": before,
            "page_count_after": len(document),
        })
    return completed, extracts


def save_extracts(
    document: pymupdf.Document,
    operations: list[dict[str, Any]],
    output_pdf: Path,
) -> list[str]:
    paths: list[str] = []
    for index, operation in enumerate(operations, start=1):
        pages = sorted(parse_pages(operation.get("pages", "all"), len(document)))
        if not pages:
            raise ValueError("Не указаны страницы для извлечения")
        suffix = re.sub(r"[^0-9A-Za-zА-Яа-яЁё_-]+", "-", str(operation.get("suffix", "извлечено"))).strip("-") or "извлечено"
        target = output_pdf.with_name(f"{output_pdf.stem}_{suffix}{f'-{index}' if index > 1 else ''}.pdf")
        extracted = pymupdf.open()
        try:
            for page_number in pages:
                extracted.insert_pdf(document, from_page=page_number - 1, to_page=page_number - 1)
            extracted.save(target, garbage=4, deflate=True)
        finally:
            extracted.close()
        paths.append(str(target))
    return paths


def spds_region(page: pymupdf.Page) -> pymupdf.Rect:
    right = page.rect.width - 5 * MM
    bottom = page.rect.height - 5 * MM
    return pymupdf.Rect(right - SPDS_WIDTH_MM * MM, bottom - SPDS_HEIGHT_MM * MM, right, bottom)


def resolve_region(page: pymupdf.Page, spec: dict[str, Any] | None) -> pymupdf.Rect:
    spec = spec or {}
    anchor = spec.get("anchor", "page")
    x = float(spec.get("x_mm", 0)) * MM
    y = float(spec.get("y_mm", 0)) * MM
    width = float(spec.get("width_mm", page.rect.width / MM)) * MM
    height = float(spec.get("height_mm", page.rect.height / MM)) * MM
    if anchor == "spds_title_block":
        base = spds_region(page)
        return pymupdf.Rect(base.x0 + x, base.y0 + y, base.x0 + x + width, base.y0 + y + height)
    if anchor == "detected_title_block_top":
        base = spds_region(page)
        words = unique_words(page)
        bottom = [word for word in words if word[1] > page.rect.height * 0.60]
        top_candidates = [
            word[1] for word in bottom
            if word[4].strip(".,").casefold() in {"изм", "лист", "стадия", "нов", "зам", "арх", "гап", "гип", "утв", "проверил", "составил"}
            or re.search(r"\d{2,4}-.*(?:АР|КР|ОВ|ВК|ЭО|ТХ)", word[4], re.IGNORECASE)
        ]
        top = min(top_candidates, default=base.y0)
        return pymupdf.Rect(x, top + y, x + width, top + y + height)
    if anchor == "bottom_left":
        return pymupdf.Rect(x, page.rect.height - y - height, x + width, page.rect.height - y)
    return pymupdf.Rect(x, y, x + width, y + height)


def unique_words(page: pymupdf.Page, clip: pymupdf.Rect | None = None) -> list[tuple]:
    result: list[tuple] = []
    seen: set[tuple] = set()
    for word in page.get_text("words", clip=clip):
        key = tuple(round(value, 1) for value in word[:4]) + (word[4],)
        if key not in seen:
            seen.add(key)
            result.append(word)
    return result


def document_kind(page: pymupdf.Page) -> str | None:
    if page.rect.width > page.rect.height:
        return "ГЧ"
    stamp = spds_region(page)
    words = unique_words(page, stamp)
    for kind in ("ТЧ", "ГЧ"):
        if any(word[4].strip(".,") == kind for word in words):
            return kind
    bottom_words = unique_words(page, pymupdf.Rect(0, page.rect.height - 180, page.rect.width, page.rect.height))
    if any(w[4].strip(".,").casefold() in {"изм", "лист", "стадия", "п", "тч", "кол.уч", "арх", "гап", "гип"} for w in bottom_words):
        return "ТЧ"
    return None


def page_matches(page: pymupdf.Page, page_number: int, selector: dict[str, Any], count: int) -> bool:
    if page_number not in parse_pages(selector.get("pages", "all"), count):
        return False
    orientation = selector.get("orientation", "any")
    if orientation == "portrait" and page.rect.width >= page.rect.height:
        return False
    if orientation == "landscape" and page.rect.width <= page.rect.height:
        return False
    expected_kind = selector.get("document_kind", "any")
    if expected_kind != "any" and document_kind(page) != expected_kind:
        return False
    return True


def font_path(style: dict[str, Any]) -> Path:
    explicit = style.get("font_file")
    if explicit and Path(explicit).exists():
        return Path(explicit)
    family = style.get("font_family", "Arial")
    bold = bool(style.get("bold"))
    italic = bool(style.get("italic"))
    suffix = ""
    if bold and italic:
        suffix = "bi"
    elif bold:
        suffix = "bd"
    elif italic:
        suffix = "i"
    mapping = {
        "Arial": f"arial{suffix}.ttf",
        "Calibri": f"calibri{suffix}.ttf",
        "Times New Roman": f"times{suffix}.ttf",
    }
    candidates = [Path(r"C:\Windows\Fonts") / mapping.get(family, "arial.ttf")]
    if suffix:
        candidates.append(Path(r"C:\Windows\Fonts\arial.ttf"))
    candidates.extend([
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path(r"C:\Windows\Fonts\calibri.ttf"),
        Path(r"C:\Windows\Fonts\DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf" if bold and italic else
             "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
             "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf" if italic else
             "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ])
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Не найден файл шрифта для {family}")


def source_text_style(page: pymupdf.Page, target: pymupdf.Rect) -> dict[str, Any] | None:
    best: tuple[float, dict[str, Any]] | None = None
    for block in page.get_text("dict", clip=target).get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                rect = pymupdf.Rect(span["bbox"])
                intersection = rect & target
                area = max(0.0, intersection.width) * max(0.0, intersection.height)
                if area and (best is None or area > best[0]):
                    color_value = int(span.get("color", 0))
                    best = (area, {
                        "font_name": span.get("font", ""),
                        "font_size_pt": float(span.get("size", 9)),
                        "color_rgb": ((color_value >> 16 & 255) / 255, (color_value >> 8 & 255) / 255, (color_value & 255) / 255),
                    })
    return best[1] if best else None


def embedded_font_buffer(page: pymupdf.Page, font_name: str) -> bytes | None:
    wanted = re.sub(r"[^a-z0-9]", "", font_name.casefold())
    for font in page.get_fonts(full=True):
        xref, basefont, resource = font[0], str(font[3]), str(font[4])
        candidates = [basefont.split("+")[-1], resource]
        if wanted and any(wanted in re.sub(r"[^a-z0-9]", "", item.casefold()) for item in candidates):
            try:
                extracted = page.parent.extract_font(xref)
                if extracted and extracted[3]:
                    return extracted[3]
            except Exception:
                return None
    return None


def insert_fitted(page: pymupdf.Page, rect: pymupdf.Rect, text: str, style: dict[str, Any], font_key: str, source_style: dict[str, Any] | None = None, font_buffer: bytes | None = None) -> float:
    preserve = bool(style.get("preserve_source_style")) and source_style
    size = float(source_style["font_size_pt"] if preserve else style.get("font_size_pt", 9))
    minimum = float(style.get("min_font_size_pt", 5))
    auto_fit = bool(style.get("auto_fit", True))
    alignment = {"left": 0, "center": 1, "right": 2}.get(style.get("align", "left"), 0)
    color = source_style["color_rgb"] if preserve else hex_color(style.get("color"), (0, 0, 0))
    rotation = int(style.get("rotation", 0))
    while size >= minimum:
        font_args: dict[str, Any] = {"fontname": font_key}
        if preserve and font_buffer:
            page.insert_font(fontname=font_key, fontbuffer=font_buffer)
        else:
            font_args["fontfile"] = str(font_path(style))
        result = page.insert_textbox(rect, text, fontsize=size, color=color, align=alignment, rotate=rotation, lineheight=float(style.get("line_height", 1.05)), overlay=True, **font_args)
        if result >= 0:
            return size
        if not auto_fit:
            break
        size -= 0.35
    raise ValueError(f"Текст не помещается: {text}")


def find_date_linked_names(page: pymupdf.Page, region: pymupdf.Rect, years: set[int]) -> list[pymupdf.Rect]:
    words = unique_words(page, region)
    dates = []
    for word in words:
        digits = re.sub(r"\D", "", word[4])
        for year in years:
            str_year = str(year)
            short_year = str_year[-2:]
            if str_year in digits or digits.endswith(short_year) or digits.startswith(short_year):
                dates.append(word)
                break
    found: list[pymupdf.Rect] = []
    seen: set[tuple] = set()
    for date in dates:
        date_center = (date[1] + date[3]) / 2
        candidates = []
        for word in words:
            text = word[4].strip("()[]{}.,:;\"'«»")
            if not re.fullmatch(r"[А-ЯЁ][а-яё-]{2,}", text):
                continue
            gap = date[0] - word[2]
            word_center = (word[1] + word[3]) / 2
            if abs(word_center - date_center) <= 5.0 and -2 <= gap <= 150:
                candidates.append((gap, word))
        if candidates:
            _, word = min(candidates, key=lambda item: item[0])
            key = tuple(round(value, 1) for value in word[:4])
            if key not in seen:
                seen.add(key)
                found.append(pymupdf.Rect(word[:4]))
    return found


def word_text_at(page: pymupdf.Page, target: pymupdf.Rect) -> str:
    candidates = unique_words(page, target + (-0.5, -0.5, 0.5, 0.5))
    if not candidates:
        return ""
    def overlap(word: tuple) -> float:
        intersection = pymupdf.Rect(word[:4]) & target
        return max(0.0, intersection.width) * max(0.0, intersection.height)
    return max(candidates, key=overlap)[4].strip("()[]{}.,:;\"'«»")


ROLE_ALIASES = {
    "разработал": "Разработал",
    "разарботал": "Разработал",
    "проверил": "Проверил",
    "нконтр": "Н. контр.",
    "гип": "ГИП",
    "гап": "ГАП",
    "арх": "Арх.",
    "измвнес": "Изм. внес",
    "утв": "Утв.",
    "исполнил": "Исполнил",
    "составил": "Составил",
}


def normalized_role(value: str) -> str | None:
    key = re.sub(r"[^а-яё]", "", value.casefold())
    return ROLE_ALIASES.get(key)


def stamp_role_fields(page: pymupdf.Page, stamp: pymupdf.Rect) -> list[dict[str, Any]]:
    """Recognize standard SPDS role rows and their value cells."""
    words = unique_words(page, stamp)
    role_words = [word for word in words if word[0] < stamp.x0 + 20.5 * MM]
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()
    for seed in role_words:
        center_y = (seed[1] + seed[3]) / 2
        row_role_words = [
            word for word in role_words
            if abs(((word[1] + word[3]) / 2) - center_y) <= 3.2
        ]
        role_text = " ".join(word[4] for word in sorted(row_role_words, key=lambda item: item[0]))
        role = normalized_role(role_text) or normalized_role(seed[4])
        if not role:
            continue
        value_words = [
            word for word in words
            if stamp.x0 + 17.5 * MM <= (word[0] + word[2]) / 2 <= stamp.x0 + 42.5 * MM
            and abs(((word[1] + word[3]) / 2) - center_y) <= 4.0
        ]
        if not value_words:
            continue
        value_word = max(value_words, key=lambda item: item[2] - item[0])
        value = value_word[4].strip("()[]{}.,:;\"'«»")
        if not re.fullmatch(r"[А-ЯЁ][а-яё-]{2,}", value):
            continue
        key = (role, value.casefold(), round(center_y))
        if key in seen:
            continue
        seen.add(key)
        result.append({"role": role, "text": value, "rect": pymupdf.Rect(value_word[:4])})
    return result


def find_matches(page: pymupdf.Page, region: pymupdf.Rect, match: dict[str, Any]) -> list[tuple[pymupdf.Rect, str]]:
    match_type = match.get("type", "none")
    if match_type == "none":
        return [(region, "")]
    if match_type == "region_content":
        text = " ".join(page.get_text("text", clip=region).split())
        return [(region, text)] if text or match.get("allow_empty", False) else []
    if match_type == "stamp_values":
        stamp = spds_region(page) & page.rect
        if not stamp_role_fields(page, stamp):
            return []
        static_labels = {
            "изм", "колуч", "лист", "док", "подп", "дата", "стадия", "листов", "формат",
            "разработал", "проверил", "нконтр", "гип", "гап", "арх", "утв", "исполнил",
            "составил", "наименование", "обозначение", "инв", "подл", "взам", "согласовано",
            "подпись", "н", "контр", "нов", "зам", "аннул", "n", "кол", "уч",
        }
        result: list[tuple[pymupdf.Rect, str]] = []
        for word in unique_words(page, region):
            normalized = re.sub(r"[^а-яёa-z]", "", str(word[4]).casefold())
            if normalized not in static_labels:
                result.append((pymupdf.Rect(word[:4]), str(word[4])))
        return result
    if match_type == "date_linked_name":
        years = {int(year) for year in match.get("years", [2025, 2026])}
        expected_name = str(match.get("text", "")).strip().casefold()
        expected_role = str(match.get("role", "")).strip().casefold()
        if expected_role:
            fields = stamp_role_fields(page, spds_region(page))
            return [
                (field["rect"], field["text"])
                for field in fields
                if field["role"].casefold() == expected_role and (not expected_name or field["text"].casefold() == expected_name)
            ]
        matches = [(rect, word_text_at(page, rect)) for rect in find_date_linked_names(page, region, years)]
        if not expected_name or expected_name in {"*", "all", "все"}:
            return matches
        return [(rect, text) for rect, text in matches if text.casefold() == expected_name]
    if match_type == "exact_text":
        text = str(match.get("text", "")).strip()
        if not text:
            return []
        variants = [text]
        for v in list(variants):
            clean = v.strip("«»\"' ")
            if clean not in variants:
                variants.append(clean)
        for variant in variants:
            found = page.search_for(variant, clip=region)
            if found:
                return [(rect, variant) for rect in found]
        return []
    if match_type == "regex_word":
        pattern = re.compile(str(match.get("text", "")), 0 if match.get("case_sensitive") else re.IGNORECASE)
        return [(pymupdf.Rect(word[:4]), word[4]) for word in unique_words(page, region) if pattern.search(word[4])]
    raise ValueError(f"Неизвестный тип поиска: {match_type}")


def inspect_stamp(input_pdf: str) -> dict[str, Any]:
    """Analyze the document and return a real stamp sample with role/value fields."""
    document = pymupdf.open(Path(input_pdf).resolve())
    page_count = len(document)
    detected_pages: list[int] = []
    sample_candidate: tuple[int, pymupdf.Page, pymupdf.Rect, list[dict[str, Any]]] | None = None
    values: dict[tuple[str, str], dict[str, Any]] = {}
    formats: dict[str, int] = {}
    kinds: dict[str, int] = {}
    page_structure: list[dict[str, Any]] = []
    for page_number, page in enumerate(document, start=1):
        size_key = f"{round(page.rect.width / MM)}x{round(page.rect.height / MM)} мм"
        formats[size_key] = formats.get(size_key, 0) + 1
        kind = document_kind(page) or "Не определён"
        kinds[kind] = kinds.get(kind, 0) + 1
        page_text = page.get_text("text")[:5000].casefold()
        looks_like_title = any(marker in page_text for marker in ("проектная документация", "рабочая документация", "том ", "раздел ")) and page_number <= 3
        page_info = {"page": page_number, "format": size_key, "kind": kind, "classification": "Титульный лист" if looks_like_title else "Лист документации", "has_stamp": False}
        page_structure.append(page_info)
        stamp = spds_region(page) & page.rect
        if stamp.is_empty or stamp.width < 100 or stamp.height < 50:
            continue
        fields = stamp_role_fields(page, stamp)
        if not fields:
            continue
        detected_pages.append(page_number)
        page_info["has_stamp"] = True
        page_info["classification"] = "Лист со штампом"
        for field in fields:
            key = (field["role"], field["text"])
            values.setdefault(key, {"type": "stamp_role", "role": field["role"], "text": field["text"], "pages": []})["pages"].append(page_number)
        if sample_candidate is None or len(fields) > len(sample_candidate[3]):
            sample_candidate = (page_number, page, stamp, fields)
    sample: dict[str, Any] | None = None
    if sample_candidate:
        page_number, page, stamp, fields = sample_candidate
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), clip=stamp, alpha=False)
        sample = {
            "page": page_number,
            "image": base64.b64encode(pixmap.tobytes("png")).decode("ascii"),
            "fields": [{
                "type": "stamp_role", "role": field["role"], "text": field["text"],
                "x": (field["rect"].x0 - stamp.x0) / stamp.width * 100,
                "y": (field["rect"].y0 - stamp.y0) / stamp.height * 100,
                "width": field["rect"].width / stamp.width * 100,
                "height": field["rect"].height / stamp.height * 100,
            } for field in fields],
        }
    document.close()
    return {
        "ok": True,
        "page_count": page_count,
        "detected_stamp_pages": detected_pages,
        "sample": sample,
        "values": list(values.values()),
        "structure": {"formats": formats, "document_kinds": kinds, "pages": page_structure, "title_pages": [item["page"] for item in page_structure if item["classification"] == "Титульный лист"]},
    }


def inspect_rule(input_pdf: str, rule: dict[str, Any]) -> dict[str, Any]:
    """Find rule matches without modifying the PDF and return one visual sample."""
    document = pymupdf.open(Path(input_pdf).resolve())
    items: list[dict[str, Any]] = []
    total_count = 0
    sample_page_number: int | None = None
    sample_rects: list[pymupdf.Rect] = []
    try:
        for page_number, page in enumerate(document, start=1):
            selector = rule.get("selector", {})
            if not page_matches(page, page_number, selector, len(document)):
                continue
            region = resolve_region(page, selector.get("region")) & page.rect
            matches = find_matches(page, region, rule.get("match", {}))
            for rect, text in matches:
                total_count += 1
                if len(items) < 500:
                    items.append({"page": page_number, "text": text, "rect": list(rect)})
                if sample_page_number is None:
                    sample_page_number = page_number
                if sample_page_number == page_number:
                    sample_rects.append(rect)
        sample: dict[str, Any] | None = None
        if sample_page_number is not None:
            page = document[sample_page_number - 1]
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.25, 1.25), alpha=False)
            sample = {
                "page": sample_page_number,
                "image": base64.b64encode(pixmap.tobytes("png")).decode("ascii"),
                "markers": [{
                    "x": rect.x0 / page.rect.width * 100,
                    "y": rect.y0 / page.rect.height * 100,
                    "width": rect.width / page.rect.width * 100,
                    "height": rect.height / page.rect.height * 100,
                } for rect in sample_rects[:100]],
            }
        pages = sorted({item["page"] for item in items})
        return {"ok": True, "count": total_count, "pages": pages, "items": items, "sample": sample, "truncated": total_count > len(items)}
    finally:
        document.close()


def inspect_page(input_pdf: str, page_number: int) -> dict[str, Any]:
    """Render one page and expose clickable text spans for direct editing."""
    document = pymupdf.open(Path(input_pdf).resolve())
    try:
        if not 1 <= page_number <= len(document):
            raise ValueError(f"Страница {page_number} отсутствует; всего страниц: {len(document)}")
        page = document[page_number - 1]
        spans: list[dict[str, Any]] = []
        for block in page.get_text("dict").get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = str(span.get("text", "")).strip()
                    if not text:
                        continue
                    rect = pymupdf.Rect(span["bbox"])
                    spans.append({
                        "text": text,
                        "rect": list(rect),
                        "x": rect.x0 / page.rect.width * 100,
                        "y": rect.y0 / page.rect.height * 100,
                        "width": rect.width / page.rect.width * 100,
                        "height": rect.height / page.rect.height * 100,
                        "font": span.get("font", ""),
                        "size": span.get("size", 9),
                    })
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.4, 1.4), alpha=False)
        return {
            "ok": True,
            "page": page_number,
            "page_count": len(document),
            "width_mm": page.rect.width / MM,
            "height_mm": page.rect.height / MM,
            "image": base64.b64encode(pixmap.tobytes("png")).decode("ascii"),
            "spans": spans[:2000],
            "truncated": len(spans) > 2000,
        }
    finally:
        document.close()


def process_job(job: dict[str, Any]) -> dict[str, Any]:
    input_pdf = Path(job["input_pdf"]).resolve()
    output_pdf = Path(job["output_pdf"]).resolve()
    if input_pdf == output_pdf:
        raise ValueError("Исходный и выходной PDF должны отличаться")
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(input_pdf)
    operations: list[Operation] = []
    warnings: list[str] = []
    page_operations, deferred_extracts = apply_page_operations(document, job.get("page_operations", []))

    for page_number, page in enumerate(document, start=1):
        for rule_index, rule in enumerate(job.get("rules", [])):
            if not rule.get("enabled", True):
                continue
            selector = rule.get("selector", {})
            if not page_matches(page, page_number, selector, len(document)):
                continue
            region = resolve_region(page, selector.get("region")) & page.rect
            matches = find_matches(page, region, rule.get("match", {}))
            action = rule.get("action", {})
            action_type = action.get("type", "replace")
            replacement = str(action.get("text", ""))
            image_path = str(action.get("image_path", ""))
            style = action.get("style", {})
            pending: list[tuple[pymupdf.Rect, str, str, dict[str, Any] | None, bytes | None]] = []
            pending_images: list[tuple[pymupdf.Rect, str]] = []

            if action_type == "add" and action.get("skip_if_exists") and replacement:
                if page.search_for(replacement, clip=region):
                    continue

            for match_rect, old_text in matches:
                preserved = source_text_style(page, match_rect) if style.get("preserve_source_style") else None
                font_buffer = embedded_font_buffer(page, preserved["font_name"]) if preserved else None
                target = region if action.get("target_region", "match") == "selector_region" else match_rect
                if rule.get("match", {}).get("type") == "date_linked_name" and action.get("target_region", "match") == "match":
                    stamp = spds_region(page)
                    center_y = (match_rect.y0 + match_rect.y1) / 2
                    target = pymupdf.Rect(
                        stamp.x0 + 20.8 * MM,
                        center_y - 2.35 * MM,
                        stamp.x0 + 37.2 * MM,
                        center_y + 2.35 * MM,
                    )
                if action_type in {"replace", "redact", "replace_image"}:
                    fill = hex_color(style.get("background", "#FFFFFF"), (1, 1, 1))
                    redact_rect = region if action.get("redact_region", "match") == "selector_region" else match_rect
                    if redact_rect == region:
                        redact_rect = redact_rect + (1.2, 1.2, -1.2, -1.2)
                    else:
                        redact_rect = redact_rect + (-0.5, -0.4, 0.5, 0.4)
                    page.add_redact_annot(redact_rect, fill=fill, cross_out=False)
                if action_type in {"replace", "add"} and replacement:
                    pending.append((target, replacement, old_text, preserved, font_buffer))
                if action_type in {"replace_image", "add_image"} and image_path:
                    pending_images.append((target, image_path))
                operations.append(Operation(
                    page_number,
                    str(rule.get("id", rule_index + 1)),
                    str(rule.get("name", "Правило")),
                    action_type,
                    old_text,
                    image_path if action_type in {"replace_image", "add_image"} else replacement,
                    list(target),
                    "medium" if action_type == "add" else "high",
                ))

            if action_type in {"replace", "redact", "replace_image"} and matches:
                page.apply_redactions(
                    images=pymupdf.PDF_REDACT_IMAGE_NONE,
                    graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                )
            for target, text, _old, preserved, font_buffer in pending:
                try:
                    insert_fitted(page, target, text, style, f"RuleFont{rule_index}_{page_number}", preserved, font_buffer)
                except Exception as exc:
                    warnings.append(f"Стр. {page_number}, {rule.get('name', 'правило')}: {exc}")
            for target, path in pending_images:
                try:
                    if not Path(path).exists():
                        raise FileNotFoundError(f"Не найден файл логотипа: {path}")
                    page.insert_image(target, filename=path, keep_proportion=True, overlay=True)
                except Exception as exc:
                    warnings.append(f"Стр. {page_number}, {rule.get('name', 'логотип')}: {exc}")

    extracted_files = save_extracts(document, deferred_extracts, output_pdf)
    page_count = len(document)
    document.save(output_pdf, garbage=4, deflate=True)
    document.close()

    preview_dir = None
    if job.get("make_previews", True):
        preview_dir = render_previews(output_pdf)
    report = {
        "ok": True,
        "input_pdf": str(input_pdf),
        "output_pdf": str(output_pdf),
        "page_count": page_count,
        "operation_count": len(operations),
        "operations": [asdict(operation) for operation in operations],
        "page_operations": page_operations,
        "extracted_files": extracted_files,
        "warnings": warnings,
        "preview_dir": str(preview_dir) if preview_dir else None,
    }
    report_path = output_pdf.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    report["report_path"] = str(report_path)
    return report


def render_previews(pdf_path: Path, dpi: int = 110) -> Path:
    output_dir = pdf_path.parent / f"{pdf_path.stem}_preview"
    output_dir.mkdir(parents=True, exist_ok=True)
    document = pymupdf.open(pdf_path)
    matrix = pymupdf.Matrix(dpi / 72, dpi / 72)
    for number, page in enumerate(document, start=1):
        page.get_pixmap(matrix=matrix, alpha=False).save(output_dir / f"page-{number:03}.png")
    document.close()
    return output_dir
