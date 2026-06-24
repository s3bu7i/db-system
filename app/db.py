import os
import sqlite3
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", BASE_DIR / "uploads"))
DB_PATH = Path(os.getenv("DB_PATH", DATA_DIR / "app.db"))
DEFAULT_CATEGORIES = (
    "AZ-MDB",
    "AZ-Rayonlar",
    "AZ-Respublika",
    "EN-MDB",
    "EN-Rayonlar",
    "EN-Respublika",
)


def get_conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                sha256 TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                progress INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL DEFAULT '',
                uploaded_at TEXT NOT NULL,
                imported_at TEXT,
                FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_id INTEGER,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(parent_id) REFERENCES categories(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS sheets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                sheet_index INTEGER NOT NULL,
                row_count INTEGER NOT NULL DEFAULT 0,
                column_count INTEGER NOT NULL DEFAULT 0,
                heading_text TEXT NOT NULL DEFAULT '',
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sheet_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sheet_id INTEGER NOT NULL,
                row_number INTEGER NOT NULL,
                cells_json TEXT NOT NULL,
                styles_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY(sheet_id) REFERENCES sheets(id) ON DELETE CASCADE,
                UNIQUE(sheet_id, row_number)
            );

            CREATE INDEX IF NOT EXISTS idx_sheets_file_id
                ON sheets(file_id, sheet_index);
            CREATE INDEX IF NOT EXISTS idx_sheet_rows_sheet_row
                ON sheet_rows(sheet_id, row_number);
            CREATE INDEX IF NOT EXISTS idx_files_uploaded
                ON files(uploaded_at DESC);
            """
        )
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(files)")]
        if "category_id" not in columns:
            conn.execute("ALTER TABLE files ADD COLUMN category_id INTEGER")
        if "display_name" not in columns:
            conn.execute("ALTER TABLE files ADD COLUMN display_name TEXT")

        sheet_columns = [row["name"] for row in conn.execute("PRAGMA table_info(sheets)")]
        if "meta_json" not in sheet_columns:
            conn.execute("ALTER TABLE sheets ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'")
        if "heading_text" not in sheet_columns:
            conn.execute("ALTER TABLE sheets ADD COLUMN heading_text TEXT NOT NULL DEFAULT ''")

        row_columns = [row["name"] for row in conn.execute("PRAGMA table_info(sheet_rows)")]
        if "styles_json" not in row_columns:
            conn.execute("ALTER TABLE sheet_rows ADD COLUMN styles_json TEXT NOT NULL DEFAULT '{}'")

        category_columns = [row["name"] for row in conn.execute("PRAGMA table_info(categories)")]
        if "parent_id" not in category_columns:
            conn.execute("ALTER TABLE categories ADD COLUMN parent_id INTEGER")

        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_files_category
                ON files(category_id, uploaded_at DESC)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_categories_parent
                ON categories(parent_id, name)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sheets_heading_file
                ON sheets(file_id, sheet_index)
            """
        )

        conn.executemany(
            "INSERT OR IGNORE INTO categories (name) VALUES (?)",
            [(name,) for name in DEFAULT_CATEGORIES],
        )
        conn.commit()
