from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup, Tag


ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://zuigo.ai/services/healthcare-software"
USER_AGENT = "ZuiGOPhase1Extractor/1.0 (+https://zuigo.ai/)"
OUTPUT_DIR = ROOT / "data" / "website_extraction"
EXPECTED_SECTIONS = {
    "why choose": "Solutions",
    "how does": "How We Deliver",
    "what's included": "Solutions",
    "which technologies": "Technologies",
    "what healthcare software projects": "Projects",
    "talk to us": "Contact",
}


def normalize_text(value: str) -> str:
    value = " ".join(value.split())
    return re.sub(r"\s+([?.!,;:])", r"\1", value)


def content_hash(value: object) -> str:
    serialized = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def fetch_page() -> bytes:
    parsed_url = urlparse(SOURCE_URL)
    robots_url = f"{parsed_url.scheme}://{parsed_url.netloc}/robots.txt"
    robots_response = requests.get(
        robots_url, headers={"User-Agent": USER_AGENT}, timeout=20
    )
    robots_response.raise_for_status()

    robots = RobotFileParser()
    robots.set_url(robots_url)
    robots.parse(robots_response.text.splitlines())
    if not robots.can_fetch(USER_AGENT, SOURCE_URL):
        raise RuntimeError(f"robots.txt disallows extraction of {SOURCE_URL}")

    response = requests.get(
        SOURCE_URL,
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    response.raise_for_status()
    return response.content


def collect_section_blocks(heading: Tag) -> list[dict[str, str]]:
    container = heading.parent
    if not isinstance(container, Tag):
        return []
    heading_text = normalize_text(heading.get_text(" ", strip=True)).casefold()
    if "projects does" in heading_text:
        while container.find("h3") is None:
            parent = container.parent
            if not isinstance(parent, Tag) or len(parent.find_all("h2")) > 1:
                break
            container = parent

    blocks: list[dict[str, str]] = []
    for element in container.find_all(["h3", "p", "li", "div", "a"]):
        classes = set(element.get("class", []))
        if element.name == "div" and {"flex", "items-start", "gap-3"} <= classes:
            text = normalize_text(element.get_text(" ", strip=True))
            if text:
                blocks.append({"type": "list_item", "text": text})
        elif element.name == "div" and {"flex", "flex-wrap"} <= classes:
            for chip in element.find_all("span", recursive=True):
                text = normalize_text(chip.get_text(" ", strip=True))
                if text:
                    blocks.append({"type": "list_item", "text": text})
        elif element.name == "a":
            text = normalize_text(
                str(element.get("aria-label") or element.get_text(" ", strip=True))
            )
            href = element.get("href")
            if text and href:
                blocks.append({"type": "link", "text": text, "href": href})
        elif element.name in {"h3", "p", "li"}:
            text = normalize_text(element.get_text(" ", strip=True))
            if text:
                block_type = (
                    "subheading"
                    if element.name == "h3"
                    else "list_item"
                    if element.name == "li"
                    else "paragraph"
                )
                blocks.append({"type": block_type, "text": text})
    return blocks


def collect_introduction(main: Tag, title: Tag) -> str:
    paragraphs: list[str] = []
    for element in title.find_all_next(["h1", "h2", "p"]):
        if element not in main.descendants:
            break
        if element.name in {"h1", "h2"}:
            break
        text = normalize_text(element.get_text(" ", strip=True))
        if text:
            paragraphs.append(text)
    if not paragraphs:
        raise RuntimeError("Healthcare page introduction was not found")
    return "\n\n".join(paragraphs)


def render_blocks(blocks: list[dict[str, str]]) -> str:
    return "\n".join(
        f"{block['text']}" if block["type"] == "subheading"
        else f"- {block['text']}" if block["type"] == "list_item"
        else block["text"]
        for block in blocks
    )


def extract_record(html: bytes) -> dict[str, object]:
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main")
    if not isinstance(main, Tag):
        raise RuntimeError("Static HTML did not contain a main content element")

    title = main.find("h1")
    if not isinstance(title, Tag):
        raise RuntimeError("Healthcare page title was not found")
    title_text = normalize_text(title.get_text(" ", strip=True))

    section_tags = main.find_all(["h2"])
    sections: list[dict[str, object]] = []
    for section_heading in section_tags:
        heading_text = normalize_text(section_heading.get_text(" ", strip=True))
        blocks = collect_section_blocks(section_heading)
        if blocks:
            sections.append({"heading": heading_text, "content": blocks})

    missing_headings = [
        label
        for prefix, label in EXPECTED_SECTIONS.items()
        if not any(
            normalize_text(str(section["heading"])).casefold().startswith(prefix)
            for section in sections
        )
    ]
    if missing_headings:
        raise RuntimeError(
            "Expected Healthcare sections were not found in static HTML: "
            + ", ".join(missing_headings)
        )

    mapped_sections: dict[str, list[str]] = {
        "Solutions": [],
        "How We Deliver": [],
        "Technologies": [],
        "Projects": [],
    }
    for section in sections:
        heading_text = str(section["heading"])
        heading_key = normalize_text(heading_text).casefold()
        category = next(
            (
                value
                for prefix, value in EXPECTED_SECTIONS.items()
                if heading_key.startswith(prefix)
            ),
            None,
        )
        if category in mapped_sections:
            mapped_sections[category].append(
                f"{heading_text}\n{render_blocks(section['content'])}"
            )

    topics = {
        name: "\n\n".join(section_texts)
        for name, section_texts in mapped_sections.items()
    }
    if any(not value.strip() for value in topics.values()):
        raise RuntimeError("One or more required Healthcare topics are empty")

    record: dict[str, object] = {
        "id": "healthcare",
        "label": "Healthcare",
        "name": title_text,
        "introduction": collect_introduction(main, title),
        "source": SOURCE_URL,
        "topics": topics,
        "sections": sections,
    }
    record["content_sha256"] = content_hash(record)
    return record


def main() -> int:
    try:
        source_bytes = fetch_page()
        record = extract_record(source_bytes)
        fetched_at = datetime.now(timezone.utc)
        output_path = OUTPUT_DIR / (
            f"healthcare-{fetched_at.strftime('%Y%m%dT%H%M%SZ')}.json"
        )
        snapshot = {
            "schema_version": 1,
            "source": SOURCE_URL,
            "fetched_at": fetched_at.isoformat(),
            "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
            "records": [record],
        }

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        with output_path.open("x", encoding="utf-8", newline="\n") as file:
            json.dump(snapshot, file, ensure_ascii=False, indent=2)
            file.write("\n")
        print(f"Saved Healthcare snapshot: {output_path.relative_to(ROOT)}")
        print(f"Source SHA-256: {snapshot['source_sha256']}")
        print(f"Record content SHA-256: {record['content_sha256']}")
        return 0
    except (requests.RequestException, OSError, RuntimeError, ValueError) as error:
        print(f"Extraction failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
