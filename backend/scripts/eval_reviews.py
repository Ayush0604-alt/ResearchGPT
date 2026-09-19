"""
Compare review quality across prompt versions.

Reads the stored reviews (read-only) and prints averaged metrics per prompt
version, so a prompt change can be judged better or worse on the same fixed
topics. See eval/README.md for the procedure.

Usage:
    python scripts/eval_reviews.py                 # reviews for eval/topics.json
    python scripts/eval_reviews.py --all           # every review in the database
    python scripts/eval_reviews.py --by-topic      # one row per review
    python scripts/eval_reviews.py --json          # machine-readable output
"""

import argparse
import asyncio
import json
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOPICS = os.path.join(os.path.dirname(BACKEND_DIR), "eval", "topics.json")
sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.services.review_metrics import compare, load_rows  # noqa: E402

# Metric, column header, and whether lower is better.
COLUMNS = [
    ("sections_filled", "sections", False),
    ("words", "words", False),
    ("citation_density", "cited", False),
    ("coverage", "coverage", False),
    ("supported_rate", "supported", False),
    ("unsupported_rate", "unsupported", True),
    ("removed_citations", "invented", True),
    ("tokens", "tokens", True),
]


RATES = {"citation_density", "coverage", "supported_rate", "unsupported_rate"}


def _fmt(name: str, value) -> str:
    if value is None:
        return "-"
    if name in RATES:
        return f"{value:.0%}"
    return f"{value:,.0f}" if value >= 100 or value == int(value) else f"{value:.1f}"


def _table(header: list[str], rows: list[list[str]]) -> str:
    widths = [max(len(r[i]) for r in [header, *rows]) for i in range(len(header))]

    def line(cells: list[str]) -> str:
        return "  ".join(c.ljust(w) for c, w in zip(cells, widths, strict=True))

    return "\n".join([line(header), line(["-" * w for w in widths]), *map(line, rows)])


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--all", action="store_true", help="include every topic")
    parser.add_argument("--topics", default=TOPICS, help="JSON list of topics to evaluate")
    parser.add_argument("--by-topic", action="store_true", help="one row per review")
    parser.add_argument("--json", action="store_true", help="print JSON")
    args = parser.parse_args()

    topics = None
    if not args.all:
        with open(args.topics, encoding="utf-8") as f:
            topics = {t.strip().lower() for t in json.load(f)}

    async with AsyncSessionLocal() as db:
        rows = await load_rows(db, topics)
    if not rows:
        sys.exit("No reviews found. Run the evaluation topics first (see eval/README.md).")

    if args.by_topic:
        rows.sort(key=lambda r: (r["topic"], r["prompt_version"]))
        if args.json:
            print(json.dumps(rows, indent=2))
            return
        header = ["topic", "prompt", *(c[1] for c in COLUMNS)]
        body = [
            [
                r["topic"][:40],
                r["prompt_version"],
                *(_fmt(c[0], r["metrics"][c[0]]) for c in COLUMNS),
            ]
            for r in rows
        ]
    else:
        summary = compare((r["prompt_version"], r["metrics"]) for r in rows)
        if args.json:
            print(json.dumps(summary, indent=2))
            return
        header = ["prompt", "reviews", *(c[1] for c in COLUMNS)]
        body = [
            [version, str(s["reviews"]), *(_fmt(c[0], s[c[0]]) for c in COLUMNS)]
            for version, s in summary.items()
        ]
    print(_table(header, body))
    lower = ", ".join(c[1] for c in COLUMNS if c[2])
    print(f"\nHigher is better, except {lower}.")


if __name__ == "__main__":
    asyncio.run(main())
