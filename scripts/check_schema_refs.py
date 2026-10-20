#!/usr/bin/env python3
"""Compare the tables the Go code queries with the tables the schema creates.

Every relation named after FROM / JOIN / INTO / UPDATE / TABLE inside a Go
string literal (non-test files) is matched against the tables, views and
partitions declared in the repo's schema files. A relation the code uses but
no schema declares is a feature shipped without its schema.

    python -I scripts/check_schema_refs.py                # code vs schema files
    python -I scripts/check_schema_refs.py --live tables.txt
    python -I scripts/check_schema_refs.py --since 2fa16d3

--live FILE compares against a live database as well: FILE holds one table
name per line, e.g. the output of
    psql -Atc "select tablename from pg_tables where schemaname in ('public','zekra_auth')
               union select viewname from pg_views where schemaname in ('public','zekra_auth')"
Run that against production to list the tables the deployed code expects but
production lacks (the memory_conflicts bug, 2026-10-20).

--since REV lists the tables schema.sql declares now but did not at REV, i.e.
the delta that must be applied by hand before merging (DEPLOY.md).

Exit status 1 when anything is missing.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCHEMA_FILES = [
    "plugins/brain/internal/brain/schema.sql",
    "plugins/brain/internal/brain/bm25.sql",
    "internal/account/schema/schema.sql",
    "internal/circlexo/schema.sql",
]
ATLAS_HCL = "db/atlas/schema/schema.hcl"
CODE_DIRS = ["plugins", "internal", "cmd"]

# Tables owned by togo plugins outside this repo (auth, db-postgres, ...) or by
# Postgres itself. Referenced on purpose; not ours to declare.
EXTERNAL = {
    "users", "sessions", "auth_sessions", "otp_codes", "personal_access_tokens", "pg_constraint", "pg_class", "pg_index", "pg_indexes", "pg_tables",
    "pg_views", "pg_namespace", "pg_attribute", "pg_extension", "pg_roles", "pg_stat_user_tables",
    "pg_available_extensions", "pg_proc", "pg_type", "pg_settings", "pg_stat_activity",
    "information_schema", "columns", "tables", "part_config", "tokenizer_catalog", "bm25_catalog",
}

CREATE_RE = re.compile(
    r"\bCREATE\s+(?:UNLOGGED\s+)?(?:TABLE|(?:MATERIALIZED\s+)?VIEW|OR\s+REPLACE\s+VIEW)\s+"
    r"(?:IF\s+NOT\s+EXISTS\s+)?(?:[a-z_]+\.)?\"?([a-z_][a-z0-9_]*)",
    re.I,
)
HCL_TABLE_RE = re.compile(r'^\s*table\s+"([a-z_][a-z0-9_]*)"', re.M)
GO_STRING_RE = re.compile(r"`[^`]*`|\"(?:[^\"\\\n]|\\.)*\"")
REF_RE = re.compile(
    r"\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:ONLY\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"
    r"(?:(public|zekra_auth)\.)?([a-z_][a-z0-9_]*)\b(\s*\()?",
)  # case-sensitive: the code writes SQL keywords in upper case, prose does not
CTE_RE = re.compile(
    r"(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([a-z_][a-z0-9_]*)\s*(?:\([^()]*\))?\s+AS\s+(?:NOT\s+)?(?:MATERIALIZED\s+)?\(",
    re.I,
)
ALIAS_RE = re.compile(r"\)\s+(?:AS\s+)?([a-z_][a-z0-9_]*)\b(?!\s*\()")
SQL_HINT_RE = re.compile(r"\b(SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE)\b")
# Words that follow FROM/JOIN/... without being a relation.
NOT_RELATIONS = {
    "select", "lateral", "unnest", "values", "only", "set", "the", "a", "an", "to", "and", "or",
    "where", "on", "as", "with", "jsonb_array_elements", "jsonb_array_elements_text",
    "jsonb_each", "jsonb_each_text", "generate_series", "string_to_array", "regexp_split_to_table",
    "json_array_elements", "now", "current_timestamp", "distinct", "public", "zekra_auth",
}


def strip_comments(sql: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def declared(text_by_file: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for path, text in text_by_file.items():
        if path.endswith(".hcl"):
            names = HCL_TABLE_RE.findall(text)
        else:
            names = CREATE_RE.findall(strip_comments(text))
        for n in names:
            out.setdefault(n.lower(), path)
    return out


def read_schemas(rev: str | None = None) -> dict[str, str]:
    texts = {}
    for rel in SCHEMA_FILES + [ATLAS_HCL]:
        if rev:
            r = subprocess.run(["git", "-C", str(ROOT), "show", f"{rev}:{rel}"], capture_output=True, text=True, encoding="utf-8")
            if r.returncode == 0:
                texts[rel] = r.stdout
        else:
            p = ROOT / rel
            if p.exists():
                texts[rel] = p.read_text(encoding="utf-8")
    return texts


def referenced() -> dict[str, set[str]]:
    refs: dict[str, set[str]] = {}
    for d in CODE_DIRS:
        for p in (ROOT / d).rglob("*.go"):
            if p.name.endswith("_test.go") or "node_modules" in p.parts:
                continue
            src = p.read_text(encoding="utf-8", errors="replace")
            # Blank out // comment lines (examples in docs are not queries), keeping offsets.
            src = re.sub(r"(?m)^[ \t]*//.*$", lambda m: " " * len(m.group(0)), src)
            # CTE names and subquery aliases, file-wide: queries are often built from
            # several concatenated literals, so the WITH and the FROM can be apart.
            ctes = {c.lower() for c in CTE_RE.findall(src)}
            ctes |= {a.lower() for a in ALIAS_RE.findall(src)}
            for m in GO_STRING_RE.finditer(src):
                lit = m.group(0)[1:-1]
                if not SQL_HINT_RE.search(lit):
                    continue
                for kw, _schema, name, call in REF_RE.findall(lit):
                    n = name.lower()
                    if call or n in NOT_RELATIONS or n in ctes:
                        continue
                    if kw.upper() == "TABLE" and not re.search(r"\b(ALTER|CREATE|TRUNCATE|DROP|LOCK)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:\w+\.)?" + re.escape(name) + r"\b", lit, re.I):
                        continue
                    line = src.count("\n", 0, m.start()) + 1
                    refs.setdefault(n, set()).add(f"{p.relative_to(ROOT).as_posix()}:{line}")
    return refs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--live", help="file with the live database's table names, one per line")
    ap.add_argument("--since", help="git rev: list tables schema.sql gained since then")
    args = ap.parse_args()

    decl = declared(read_schemas())
    refs = referenced()
    status = 0

    undeclared = sorted(n for n in refs if n not in decl and n not in EXTERNAL)
    print(f"{len(refs)} relations referenced by Go code, {len(decl)} declared in schema files")
    if undeclared:
        status = 1
        print("\nReferenced but not declared in any schema file:")
        for n in undeclared:
            print(f"  {n:32} {', '.join(sorted(refs[n])[:3])}")
    else:
        print("OK: every referenced relation is declared")

    if args.since:
        before = declared(read_schemas(args.since))
        added = sorted(n for n in decl if n not in before)
        print(f"\nDeclared now but not at {args.since} (apply by hand before deploy):")
        for n in added or ["(none)"]:
            print(f"  {n}")

    if args.live:
        live = {l.strip().lower() for l in Path(args.live).read_text(encoding="utf-8").splitlines() if l.strip()}
        missing = sorted(n for n in refs if n in decl and n not in live)
        if missing:
            status = 1
            print("\nUsed by the code but missing in the live database:")
            for n in missing:
                print(f"  {n:32} declared in {decl[n]}; used at {', '.join(sorted(refs[n])[:3])}")
        else:
            print("\n✓ every declared relation the code uses exists in the live database")
    return status


if __name__ == "__main__":
    sys.exit(main())
