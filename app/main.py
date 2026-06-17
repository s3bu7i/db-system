import hashlib
import json
import os
import re
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import BackgroundTasks, Body, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from .db import UPLOAD_DIR, get_conn, init_db
from .importer import import_excel_file, is_supported_excel, read_sheet_metadata


load_dotenv()

app = FastAPI(title="Excel DB Manager", version="1.0.0")
security = HTTPBasic(auto_error=False)


def utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _admin_username() -> str:
    return os.getenv("APP_ADMIN_USERNAME") or os.getenv("APP_USERNAME") or ""


def _admin_password() -> str:
    return os.getenv("APP_ADMIN_PASSWORD") or os.getenv("APP_PASSWORD") or ""


def _is_admin(credentials: HTTPBasicCredentials | None) -> bool:
    username = _admin_username()
    password = _admin_password()
    if not username and not password:
        return False

    if credentials is None:
        return False

    username_ok = secrets.compare_digest(credentials.username, username)
    password_ok = secrets.compare_digest(credentials.password, password)
    return username_ok and password_ok


def require_admin(credentials: Annotated[HTTPBasicCredentials | None, Depends(security)]) -> None:
    if not _is_admin(credentials):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, headers={"WWW-Authenticate": "Basic"})


def optional_admin(credentials: Annotated[HTTPBasicCredentials | None, Depends(security)]) -> bool:
    return _is_admin(credentials)


def require_auth(credentials: Annotated[HTTPBasicCredentials | None, Depends(security)]) -> None:
    username = _admin_username()
    password = _admin_password()
    if not username and not password:
        return

    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, headers={"WWW-Authenticate": "Basic"})

    username_ok = secrets.compare_digest(credentials.username, username)
    password_ok = secrets.compare_digest(credentials.password, password)
    if not (username_ok and password_ok):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, headers={"WWW-Authenticate": "Basic"})


@app.on_event("startup")
def startup() -> None:
    init_db()


app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


@app.get("/", response_class=HTMLResponse)
def index() -> FileResponse:
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/session")
def session(is_admin: Annotated[bool, Depends(optional_admin)]) -> dict[str, bool]:
    return {"is_admin": is_admin}


@app.post("/api/files", dependencies=[Depends(require_admin)])
def upload_files(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    category_id: int | None = Form(None),
) -> dict[str, list[dict[str, int | str]]]:
    created: list[dict[str, int | str]] = []

    if category_id is not None:
        _require_category(category_id)

    for upload in files:
        if not upload.filename or not is_supported_excel(upload.filename):
            raise HTTPException(status_code=400, detail=f"Desteklenmeyen Excel formati: {upload.filename}")

        suffix = Path(upload.filename).suffix.lower()
        stored_name = f"{uuid.uuid4().hex}{suffix}"
        target = UPLOAD_DIR / stored_name
        size = 0
        digest = hashlib.sha256()

        with target.open("wb") as out_file:
            while chunk := upload.file.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
                out_file.write(chunk)

        with get_conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO files
                    (category_id, original_name, stored_name, size_bytes, sha256, status, progress, message, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (category_id, upload.filename, stored_name, size, digest.hexdigest(), "queued", 0, "Novbede", utc_now()),
            )
            conn.commit()
            file_id = int(cursor.lastrowid)

        background_tasks.add_task(import_excel_file, file_id, str(target))
        created.append({"id": file_id, "name": upload.filename})

    return {"files": created}


@app.get("/api/files")
def list_files() -> dict[str, list[dict]]:
    with get_conn() as conn:
        files = [
            dict(row)
            for row in conn.execute(
                """
                SELECT f.*, c.name AS category_name
                  FROM files f
                  LEFT JOIN categories c ON c.id = f.category_id
                 ORDER BY f.uploaded_at DESC
                """
            )
        ]
        sheets = [
            dict(row)
            for row in conn.execute(
                """
                SELECT s.id,
                       s.file_id,
                       s.name,
                       s.sheet_index,
                       s.row_count,
                       s.column_count,
                       s.created_at,
                       CASE
                         WHEN TRIM(s.heading_text) != '' THEN s.heading_text
                         ELSE COALESCE((
                           SELECT SUBSTR(GROUP_CONCAT(r.cells_json, ' '), 1, 3000)
                             FROM sheet_rows r
                            WHERE r.sheet_id = s.id
                              AND r.row_number <= 15
                         ), '')
                       END AS heading_text
                  FROM sheets s
                 ORDER BY file_id, sheet_index
                """
            )
        ]
        category_paths = _category_path_map(conn)

    by_file: dict[int, list[dict]] = {}
    for sheet in sheets:
        by_file.setdefault(sheet["file_id"], []).append(sheet)

    for file_item in files:
        file_item["sheets"] = by_file.get(file_item["id"], [])
        if file_item.get("category_id") in category_paths:
            file_item["category_name"] = category_paths[file_item["category_id"]]
        file_item["original_name"] = _display_file_name(file_item["original_name"], file_item["sheets"])
    return {"files": files}


@app.get("/api/categories")
def list_categories() -> dict[str, list[dict]]:
    with get_conn() as conn:
        categories = [
            dict(row)
            for row in conn.execute(
                """
                SELECT c.id,
                       c.parent_id,
                       c.name,
                       COUNT(DISTINCT f.id) AS file_count,
                       COUNT(DISTINCT CASE WHEN f.status = 'ready' THEN f.id END) AS ready_count,
                       COALESCE(SUM(s.row_count), 0) AS row_count,
                       COALESCE(SUM(CASE WHEN s.id IS NULL THEN 0 ELSE 1 END), 0) AS sheet_count
                  FROM categories c
                  LEFT JOIN files f ON f.category_id = c.id
                  LEFT JOIN sheets s ON s.file_id = f.id
                 GROUP BY c.id, c.parent_id, c.name
                 ORDER BY c.name
                """
            )
        ]
    return {"categories": _category_tree_payload(categories)}


@app.post("/api/categories", dependencies=[Depends(require_admin)])
def create_category(
    name: str = Body(..., embed=True, min_length=1, max_length=80),
    parent_id: int | None = Body(None, embed=True),
) -> dict:
    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Bolme adi bos ola bilmez")
    if parent_id is not None:
        _require_category(parent_id)

    with get_conn() as conn:
        try:
            cursor = conn.execute("INSERT INTO categories (parent_id, name) VALUES (?, ?)", (parent_id, clean_name))
            conn.commit()
        except Exception as exc:  # noqa: BLE001 - uniqueness message is surfaced cleanly.
            raise HTTPException(status_code=400, detail="Bu adda bolme artiq var") from exc
        row = conn.execute("SELECT id, parent_id, name FROM categories WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)


@app.delete("/api/categories/{category_id}", dependencies=[Depends(require_admin)])
def delete_category(category_id: int) -> dict[str, int | bool]:
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM categories WHERE id = ?", (category_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bolme tapilmadi")

        files_count = conn.execute(
            "SELECT COUNT(*) AS count FROM files WHERE category_id = ?",
            (category_id,),
        ).fetchone()["count"]
        conn.execute(
            """
            UPDATE categories
               SET parent_id = (SELECT parent_id FROM categories WHERE id = ?)
             WHERE parent_id = ?
            """,
            (category_id, category_id),
        )
        conn.execute("UPDATE files SET category_id = NULL WHERE category_id = ?", (category_id,))
        conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        conn.commit()

    return {"ok": True, "files_uncategorized": files_count}


@app.patch("/api/files/{file_id}/category", dependencies=[Depends(require_admin)])
def update_file_category(
    file_id: int,
    category_id: int | None = Body(None, embed=True),
) -> dict[str, bool]:
    if category_id is not None:
        _require_category(category_id)

    with get_conn() as conn:
        row = conn.execute("SELECT id FROM files WHERE id = ?", (file_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Fayl tapilmadi")
        conn.execute("UPDATE files SET category_id = ? WHERE id = ?", (category_id, file_id))
        conn.commit()
    return {"ok": True}


@app.get("/api/files/{file_id}")
def get_file(file_id: int) -> dict:
    with get_conn() as conn:
        file_row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail="Fayl tapilmadi")
        sheets = [
            dict(row)
            for row in conn.execute(
                """
                SELECT s.id,
                       s.file_id,
                       s.name,
                       s.sheet_index,
                       s.row_count,
                       s.column_count,
                       s.created_at,
                       CASE
                         WHEN TRIM(s.heading_text) != '' THEN s.heading_text
                         ELSE COALESCE((
                           SELECT SUBSTR(GROUP_CONCAT(r.cells_json, ' '), 1, 3000)
                             FROM sheet_rows r
                            WHERE r.sheet_id = s.id
                              AND r.row_number <= 15
                         ), '')
                       END AS heading_text
                  FROM sheets s
                 WHERE s.file_id = ?
                 ORDER BY sheet_index
                """,
                (file_id,),
            )
        ]

    item = dict(file_row)
    item["sheets"] = sheets
    item["original_name"] = _display_file_name(item["original_name"], sheets)
    return item


@app.get("/api/files/{file_id}/download")
def download_file(file_id: int) -> FileResponse:
    with get_conn() as conn:
        row = conn.execute("SELECT original_name, stored_name FROM files WHERE id = ?", (file_id,)).fetchone()
        sheets = [
            dict(sheet)
            for sheet in conn.execute(
                "SELECT name FROM sheets WHERE file_id = ? ORDER BY sheet_index",
                (file_id,),
            )
        ]
    if not row:
        raise HTTPException(status_code=404, detail="Fayl tapilmadi")

    path = UPLOAD_DIR / row["stored_name"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Orijinal fayl diskde yoxdur")
    display_name = _display_file_name(row["original_name"], sheets)
    return FileResponse(path, filename=_download_filename(display_name, row["stored_name"]))


@app.delete("/api/files", dependencies=[Depends(require_admin)])
def delete_all_files() -> dict[str, int | bool]:
    with get_conn() as conn:
        rows = [dict(row) for row in conn.execute("SELECT stored_name FROM files")]
        conn.execute("DELETE FROM files")
        conn.commit()

    deleted_uploads = 0
    for row in rows:
        path = UPLOAD_DIR / row["stored_name"]
        if path.exists():
            path.unlink()
            deleted_uploads += 1

    return {"ok": True, "files": len(rows), "uploads": deleted_uploads}


@app.delete("/api/files/{file_id}", dependencies=[Depends(require_admin)])
def delete_file(file_id: int) -> dict[str, bool]:
    with get_conn() as conn:
        row = conn.execute("SELECT stored_name FROM files WHERE id = ?", (file_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Fayl tapilmadi")
        conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
        conn.commit()

    path = UPLOAD_DIR / row["stored_name"]
    if path.exists():
        path.unlink()
    return {"ok": True}


@app.get("/api/sheets/{sheet_id}/rows")
def get_sheet_rows(
    sheet_id: int,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    q: str = Query("", max_length=200),
) -> dict:
    with get_conn() as conn:
        sheet = conn.execute(
            """
            SELECT s.*, f.stored_name
              FROM sheets s
              JOIN files f ON f.id = s.file_id
             WHERE s.id = ?
            """,
            (sheet_id,),
        ).fetchone()
        if not sheet:
            raise HTTPException(status_code=404, detail="Sheet tapilmadi")

        params: list[object] = [sheet_id]
        where = "WHERE sheet_id = ?"
        if q.strip():
            where += " AND cells_json LIKE ?"
            params.append(f"%{q.strip()}%")

        total = conn.execute(
            f"SELECT COUNT(*) AS count FROM sheet_rows {where}",
            params,
        ).fetchone()["count"]

        rows = [
            {"row_number": row["row_number"], "cells": _loads(row["cells_json"])}
            for row in conn.execute(
                f"""
                SELECT row_number, cells_json
                  FROM sheet_rows
                 {where}
                 ORDER BY row_number
                 LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            )
        ]

    sheet_payload = dict(sheet)
    stored_name = sheet_payload.pop("stored_name", "")
    sheet_meta = _loads(sheet_payload.pop("meta_json", "{}") or "{}")
    if not isinstance(sheet_meta, dict):
        sheet_meta = {}
    if "merged_cells" not in sheet_meta and stored_name:
        sheet_meta = _backfill_sheet_metadata(sheet_id, stored_name, int(sheet["sheet_index"]))

    return {
        "sheet": sheet_payload,
        "meta": sheet_meta,
        "offset": offset,
        "limit": limit,
        "total": total,
        "query": q.strip(),
        "rows": rows,
        "columns": [_excel_column_name(index) for index in range(1, int(sheet["column_count"]) + 1)],
    }


@app.get("/api/merged/rows")
def get_merged_rows(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    q: str = Query("", max_length=200),
    category_id: int | None = Query(None, ge=1),
    file_ids: str = Query("", max_length=4000),
) -> dict:
    selected_file_ids = _parse_file_ids(file_ids)
    with get_conn() as conn:
        filters, params = _merged_filters(q, category_id, selected_file_ids)
        where = "WHERE " + " AND ".join(filters)

        max_columns = conn.execute(
            f"""
            SELECT COALESCE(MAX(s.column_count), 0) AS max_columns
              FROM sheets s
              JOIN files f ON f.id = s.file_id
              LEFT JOIN categories c ON c.id = f.category_id
             {where}
            """,
            params,
        ).fetchone()["max_columns"]

        total = conn.execute(
            f"""
            SELECT COUNT(*) AS count
              FROM sheet_rows r
              JOIN sheets s ON s.id = r.sheet_id
              JOIN files f ON f.id = s.file_id
              LEFT JOIN categories c ON c.id = f.category_id
             {where}
            """,
            params,
        ).fetchone()["count"]

        category_paths = _category_path_map(conn)
        rows = [
            {
                "file_id": row["file_id"],
                "file_name": _display_file_name(row["file_name"], [{"name": row["sheet_name"]}]),
                "category_id": row["category_id"],
                "category_name": category_paths.get(row["category_id"], row["category_name"]),
                "sheet_id": row["sheet_id"],
                "sheet_name": row["sheet_name"],
                "row_number": row["row_number"],
                "cells": _loads(row["cells_json"]),
            }
            for row in conn.execute(
                f"""
                SELECT f.id AS file_id,
                       f.original_name AS file_name,
                       f.category_id,
                       c.name AS category_name,
                       s.id AS sheet_id,
                       s.name AS sheet_name,
                       r.row_number,
                       r.cells_json
                  FROM sheet_rows r
                  JOIN sheets s ON s.id = r.sheet_id
                  JOIN files f ON f.id = s.file_id
                  LEFT JOIN categories c ON c.id = f.category_id
                 {where}
                 ORDER BY f.uploaded_at DESC, s.sheet_index, r.row_number
                 LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            )
        ]

    return {
        "offset": offset,
        "limit": limit,
        "total": total,
        "query": q.strip(),
        "category_id": category_id,
        "file_ids": selected_file_ids,
        "rows": rows,
        "columns": [_excel_column_name(index) for index in range(1, int(max_columns) + 1)],
    }


@app.post("/api/files/{file_id}/reimport", dependencies=[Depends(require_admin)])
def reimport_file(file_id: int, background_tasks: BackgroundTasks) -> dict[str, bool]:
    with get_conn() as conn:
        row = conn.execute("SELECT stored_name FROM files WHERE id = ?", (file_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Fayl tapilmadi")
        conn.execute(
            "UPDATE files SET status = ?, progress = ?, message = ? WHERE id = ?",
            ("queued", 0, "Novbede", file_id),
        )
        conn.commit()

    path = UPLOAD_DIR / row["stored_name"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Orijinal fayl diskde yoxdur")
    background_tasks.add_task(import_excel_file, file_id, str(path))
    return {"ok": True}


def _loads(value: str) -> Any:
    return json.loads(value)


def _backfill_sheet_metadata(sheet_id: int, stored_name: str, sheet_index: int) -> dict:
    path = UPLOAD_DIR / stored_name
    if not path.exists():
        return {"merged_cells": []}

    metadata = read_sheet_metadata(str(path), sheet_index)
    if not isinstance(metadata, dict):
        metadata = {"merged_cells": []}
    metadata.setdefault("merged_cells", [])

    with get_conn() as conn:
        conn.execute(
            "UPDATE sheets SET meta_json = ? WHERE id = ?",
            (json.dumps(metadata, ensure_ascii=False), sheet_id),
        )
        conn.commit()
    return metadata


def _download_filename(display_name: str, stored_name: str) -> str:
    suffix = Path(stored_name).suffix
    if suffix and Path(display_name).suffix.lower() != suffix.lower():
        return f"{display_name}{suffix}"
    return display_name


def _display_file_name(name: str, sheets: list[dict]) -> str:
    if not _looks_like_data_row_name(name):
        return name

    sheet_names = [str(sheet.get("name") or "").strip() for sheet in sheets if str(sheet.get("name") or "").strip()]
    if not sheet_names:
        return name
    return ", ".join(sheet_names[:3])


def _looks_like_data_row_name(name: str) -> bool:
    value = str(name or "").strip()
    if len(value) < 35:
        return False

    numeric_tokens = len(re.findall(r"\b\d+(?:[.,]\d+)?\b", value))
    alpha_tokens = len(re.findall(r"[^\W\d_]{2,}", value, flags=re.UNICODE))
    if numeric_tokens >= 4 and numeric_tokens > alpha_tokens:
        return True

    parts = value.split()
    numeric_parts = sum(1 for part in parts if _looks_numeric_text(part))
    return len(parts) >= 8 and numeric_parts >= 4 and numeric_parts >= (len(parts) // 2)


def _looks_numeric_text(value: str) -> bool:
    normalized = value.strip().replace(",", ".")
    if not normalized:
        return False
    try:
        float(normalized)
    except ValueError:
        return False
    return True


def _require_category(category_id: int) -> None:
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM categories WHERE id = ?", (category_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Bolme tapilmadi")


def _category_tree_payload(categories: list[dict]) -> list[dict]:
    by_id = {int(category["id"]): category for category in categories}
    children: dict[int | None, list[dict]] = {}
    for category in categories:
        parent_id = category.get("parent_id")
        if parent_id is not None and int(parent_id) not in by_id:
            parent_id = None
            category["parent_id"] = None
        children.setdefault(parent_id, []).append(category)

    for items in children.values():
        items.sort(key=lambda item: str(item["name"]).casefold())

    ordered: list[dict] = []

    def visit(category: dict, level: int, ancestors: list[str]) -> None:
        path_parts = [*ancestors, str(category["name"])]
        item = dict(category)
        item["level"] = level
        item["path"] = " / ".join(path_parts)
        ordered.append(item)
        for child in children.get(category["id"], []):
            visit(child, level + 1, path_parts)

    for root in children.get(None, []):
        visit(root, 0, [])
    return ordered


def _category_path_map(conn) -> dict[int, str]:
    rows = [dict(row) for row in conn.execute("SELECT id, parent_id, name FROM categories")]
    return {int(item["id"]): item["path"] for item in _category_tree_payload(rows)}


def _category_descendant_ids(conn, category_id: int) -> list[int]:
    rows = conn.execute("SELECT id, parent_id FROM categories").fetchall()
    children: dict[int | None, list[int]] = {}
    ids = {int(row["id"]) for row in rows}
    if category_id not in ids:
        raise HTTPException(status_code=400, detail="Bolme tapilmadi")

    for row in rows:
        children.setdefault(row["parent_id"], []).append(int(row["id"]))

    result: list[int] = []
    stack = [category_id]
    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.append(current)
        stack.extend(children.get(current, []))
    return result


def _parse_file_ids(value: str) -> list[int]:
    if not value.strip():
        return []

    ids: list[int] = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            file_id = int(part)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="file_ids yalniz reqemlerden ibaret olmalidir") from exc
        if file_id > 0 and file_id not in ids:
            ids.append(file_id)
    return ids


def _merged_filters(q: str, category_id: int | None, file_ids: list[int]) -> tuple[list[str], list[object]]:
    filters = ["f.status = 'ready'"]
    params: list[object] = []

    if q.strip():
        filters.append("(r.cells_json LIKE ? OR f.original_name LIKE ? OR s.name LIKE ? OR c.name LIKE ?)")
        pattern = f"%{q.strip()}%"
        params.extend([pattern, pattern, pattern, pattern])

    if category_id is not None:
        with get_conn() as conn:
            category_ids = _category_descendant_ids(conn, category_id)
        placeholders = ",".join("?" for _ in category_ids)
        filters.append(f"f.category_id IN ({placeholders})")
        params.extend(category_ids)

    if file_ids:
        placeholders = ",".join("?" for _ in file_ids)
        filters.append(f"f.id IN ({placeholders})")
        params.extend(file_ids)

    return filters, params


def _excel_column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name
