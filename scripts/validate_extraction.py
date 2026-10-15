from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


REQUIRED_FIELDS = ("id", "label", "name", "introduction", "source", "topics")
REQUIRED_TOPICS = ("Solutions", "How We Deliver", "Technologies", "Projects")
REQUIRED_HEADINGS = (
    "why choose",
    "how does",
    "what's included",
    "which technologies",
    "what healthcare software projects",
    "talk to us",
)
REQUIRED_SECTION_CONTENT = {
    "why choose": (
        "Interoperable health data systems",
        "Patient engagement platforms",
        "Telemedicine & remote care solutions",
        "Healthcare analytics & reporting",
    ),
    "how does": (
        "Discovery & Planning",
        "Solution Architecture",
        "Development & Integration",
        "Quality Assurance",
        "Deployment & Training",
    ),
    "what's included": (
        "EHR / EMR and patient-portal builds",
        "Telemedicine & remote-monitoring applications",
        "HL7 / FHIR integrations",
        "Analytics dashboards & automated compliance reporting",
    ),
    "which technologies": (
        "React",
        "Next.js",
        "Node.js",
        "Python",
        "FHIR / HL7",
        "PostgreSQL",
        "AWS",
        "Docker",
    ),
    "what healthcare software projects": (
        "Patient portal + telehealth",
        "Clinical analytics platform",
        "Remote patient monitoring",
    ),
    "talk to us": (
        "EHR",
        "before anyone signs anything",
        "Book a Call",
        "Send a Message",
    ),
}
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SECTION_BLOCK_TYPES = {"paragraph", "list_item", "subheading", "link"}
INVALID_PERCENT_ESCAPE = re.compile(r"%(?![0-9a-fA-F]{2})")


def is_safe_link_url(value: str) -> bool:
    if not value or value != value.strip() or any(
        character.isspace() or ord(character) < 32 for character in value
    ):
        return False
    if INVALID_PERCENT_ESCAPE.search(value) or "\\" in value:
        return False

    try:
        parsed = urlsplit(value)
        if parsed.scheme:
            if parsed.scheme.lower() == "mailto":
                return bool(
                    re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", parsed.path)
                ) and not parsed.query and not parsed.fragment
            if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
                return False
            if parsed.username is not None or parsed.password is not None:
                return False
            port = parsed.port
            if port is not None and port > 65535:
                return False
            return True
        return not parsed.netloc and parsed.path.startswith("/") and not parsed.path.startswith("//")
    except ValueError:
        return False


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def find_empty_strings(value: Any, path: str = "$") -> list[str]:
    empty: list[str] = []
    if isinstance(value, str):
        if not value.strip():
            empty.append(path)
    elif isinstance(value, dict):
        for key, child in value.items():
            empty.extend(find_empty_strings(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            empty.extend(find_empty_strings(child, f"{path}[{index}]"))
    return empty


def validate_snapshot(snapshot: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(snapshot, dict):
        return ["snapshot root must be a JSON object"]

    if type(snapshot.get("schema_version")) is not int or snapshot["schema_version"] != 1:
        errors.append("schema_version must be 1")
    if not isinstance(snapshot.get("source"), str) or not snapshot["source"].strip():
        errors.append("source must be a non-empty string")
    if not isinstance(snapshot.get("fetched_at"), str) or not snapshot["fetched_at"].strip():
        errors.append("fetched_at must be a non-empty string")
    source_hash = snapshot.get("source_sha256")
    if not isinstance(source_hash, str) or not SHA256_PATTERN.fullmatch(source_hash):
        errors.append("source_sha256 must be a 64-character lowercase SHA-256 hash")

    records = snapshot.get("records")
    if not isinstance(records, list) or not records:
        return errors + ["records must be a non-empty array"]

    ids: list[str] = []
    record_hashes: list[str] = []
    for index, record in enumerate(records):
        prefix = f"records[{index}]"
        if not isinstance(record, dict):
            errors.append(f"{prefix} must be an object")
            continue

        kind = record.get("kind", "healthcare")
        if not isinstance(kind, str) or kind not in {
            "healthcare",
            "service",
            "page",
            "booking",
        }:
            errors.append(f"{prefix}.kind must identify a supported extraction type")
            kind = "page"

        required_fields = ("id", "label", "name", "introduction", "source")
        if kind != "healthcare":
            required_fields += ("page_title",)
        for field in required_fields:
            value = record.get(field)
            if not isinstance(value, str) or not value.strip():
                errors.append(f"{prefix}.{field} must be a non-empty string")

        record_id = record.get("id")
        if isinstance(record_id, str) and record_id.strip():
            ids.append(record_id)

        topics = record.get("topics")
        if not isinstance(topics, dict):
            errors.append(f"{prefix}.topics must be an object")
        else:
            for topic, value in topics.items():
                if not isinstance(topic, str) or not isinstance(value, str) or not value.strip():
                    errors.append(f"{prefix}.topics.{topic} must be a non-empty string")
            if not topics:
                errors.append(f"{prefix}.topics must not be empty")
            if kind in {"healthcare", "service"}:
                for topic in REQUIRED_TOPICS:
                    if topic not in topics:
                        errors.append(f"{prefix}.topics.{topic} is missing")

        sections = record.get("sections")
        if not isinstance(sections, list) or not sections:
            errors.append(f"{prefix}.sections must be a non-empty array")
        else:
            normalized_sections: list[tuple[str, str]] = []
            for section_index, section in enumerate(sections):
                section_prefix = f"{prefix}.sections[{section_index}]"
                if not isinstance(section, dict):
                    errors.append(f"{section_prefix} must be an object")
                    continue

                heading = section.get("heading")
                if not isinstance(heading, str) or not heading.strip():
                    errors.append(f"{section_prefix}.heading must be a non-empty string")

                content = section.get("content")
                if not isinstance(content, list):
                    errors.append(
                        f"{section_prefix}.content must be an array"
                    )
                    continue
                if not content:
                    errors.append(
                        f"{section_prefix}.content must not be empty"
                    )
                    continue

                section_text: list[str] = []
                for block_index, block in enumerate(content):
                    block_prefix = f"{section_prefix}.content[{block_index}]"
                    if not isinstance(block, dict):
                        errors.append(f"{block_prefix} must be an object")
                        continue

                    block_type = block.get("type")
                    if not isinstance(block_type, str) or block_type not in SECTION_BLOCK_TYPES:
                        errors.append(
                            f"{block_prefix}.type must be one of "
                            f"{', '.join(sorted(SECTION_BLOCK_TYPES))}"
                        )

                    text = block.get("text")
                    if not isinstance(text, str) or not text.strip():
                        errors.append(f"{block_prefix}.text must be a non-empty string")
                    else:
                        section_text.append(text)

                    if block_type == "link":
                        href = block.get("href")
                        if not isinstance(href, str) or not is_safe_link_url(href):
                            errors.append(
                                f"{block_prefix}.href must be a safe relative path "
                                "or absolute HTTP(S) URL"
                            )

                if isinstance(heading, str) and heading.strip():
                    normalized_sections.append(
                        (heading.strip().casefold(), " ".join(section_text).casefold())
                    )

            if kind == "healthcare":
                headings = {heading for heading, _ in normalized_sections}
                for expected in REQUIRED_HEADINGS:
                    if not any(heading.startswith(expected) for heading in headings):
                        errors.append(
                            f"{prefix}.sections is missing a heading beginning "
                            f"with {expected!r}"
                        )
                for heading_prefix, required_content in REQUIRED_SECTION_CONTENT.items():
                    matching = [
                        text
                        for heading, text in normalized_sections
                        if heading.startswith(heading_prefix)
                    ]
                    if not matching:
                        continue
                    section_text = " ".join(matching)
                    for phrase in required_content:
                        if phrase.casefold() not in section_text:
                            errors.append(
                                f"{prefix}.sections section {heading_prefix!r} is "
                                f"missing expected content {phrase!r}"
                            )
            elif kind == "service":
                project_sections = [
                    section
                    for section in sections
                    if isinstance(section, dict)
                    and isinstance(section.get("heading"), str)
                    and "projects does" in section["heading"].casefold()
                ]
                if len(project_sections) != 1:
                    errors.append(
                        f"{prefix}.sections must contain one service-projects section"
                    )
                elif isinstance(project_sections[0].get("content"), list):
                    project_content = project_sections[0]["content"]
                    project_titles = [
                        block
                        for block in project_content
                        if isinstance(block, dict)
                        and block.get("type") == "subheading"
                    ]
                    project_descriptions = [
                        block
                        for block in project_content
                        if isinstance(block, dict)
                        and block.get("type") == "paragraph"
                    ]
                    if len(project_titles) < 3:
                        errors.append(
                            f"{prefix}.sections service-projects section must "
                            "contain at least three project headings"
                        )
                    if len(project_descriptions) < 4:
                        errors.append(
                            f"{prefix}.sections service-projects section must "
                            "contain an introduction and at least three project "
                            "descriptions"
                        )
                    project_text = " ".join(
                        str(block.get("text", ""))
                        for block in project_content
                        if isinstance(block, dict)
                    ).casefold()
                    if "illustrative" not in project_text or "not a client list" not in project_text:
                        errors.append(
                            f"{prefix}.sections service-projects section must "
                            "identify examples as illustrative, not a client list"
                        )
            elif kind == "page" and record.get("id") == "contact":
                section_by_heading = {
                    heading: text for heading, text in normalized_sections
                }
                for expected_heading in (
                    "email",
                    "prefer to talk?",
                    "follow us",
                    "contact form options",
                ):
                    if expected_heading not in section_by_heading:
                        errors.append(
                            f"{prefix}.sections is missing the {expected_heading!r} "
                            "contact section"
                        )
                options_text = section_by_heading.get("contact form options", "")
                for expected_option in (
                    "healthcare software",
                    "ai & machine learning",
                    "fintech solutions",
                    "launch & growth support",
                    "custom software development",
                    "cloud & devops",
                    "under $25,000",
                    "$25,000 – $50,000",
                    "$50,000 – $100,000",
                    "$100,000+",
                    "not sure yet",
                ):
                    if expected_option.casefold() not in options_text:
                        errors.append(
                            f"{prefix}.sections contact form options are missing "
                            f"{expected_option!r}"
                        )
                section_links = [
                    block
                    for section in sections
                    if isinstance(section, dict)
                    for block in section.get("content", [])
                    if isinstance(block, dict) and block.get("type") == "link"
                ]
                link_targets = {
                    str(block.get("href", "")).casefold()
                    for block in section_links
                }
                expected_links = {
                    "mailto:hello@zuigo.ai",
                    "/book",
                    "https://www.linkedin.com/company/zuigo-ai/",
                    "https://x.com/zuigoapp",
                    "https://youtube.com/@zuigo",
                    "https://www.facebook.com/profile.php?id=61591502318681",
                }
                for expected_link in expected_links - link_targets:
                    errors.append(
                        f"{prefix}.sections is missing contact link {expected_link!r}"
                    )

        empty_strings = find_empty_strings(record, prefix)
        errors.extend(f"empty content at {path}" for path in empty_strings)

        stored_hash = record.get("content_sha256")
        hash_payload = {
            key: value for key, value in record.items() if key != "content_sha256"
        }
        calculated_hash = canonical_hash(hash_payload)
        if not isinstance(stored_hash, str) or not SHA256_PATTERN.fullmatch(
            stored_hash
        ):
            errors.append(f"{prefix}.content_sha256 is missing or invalid")
        elif stored_hash != calculated_hash:
            errors.append(f"{prefix}.content_sha256 does not match record content")
        record_hashes.append(calculated_hash)

    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    if duplicates:
        errors.append("duplicate record IDs: " + ", ".join(duplicates))
    if len(record_hashes) != len(set(record_hashes)):
        errors.append("duplicate records detected by canonical content hash")

    empty_metadata = find_empty_strings(
        {key: value for key, value in snapshot.items() if key != "records"}
    )
    errors.extend(
        f"empty snapshot metadata at {path}" for path in empty_metadata
    )
    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print(
            "Usage: python scripts/validate_extraction.py "
            "<snapshot.json>",
            file=sys.stderr,
        )
        return 2

    snapshot_path = Path(sys.argv[1])
    try:
        with snapshot_path.open(encoding="utf-8") as file:
            snapshot = json.load(file)
    except (OSError, json.JSONDecodeError) as error:
        print(f"Could not read valid JSON from {snapshot_path}: {error}", file=sys.stderr)
        return 1

    errors = validate_snapshot(snapshot)
    if errors:
        print(f"Validation failed for {snapshot_path}:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Validation passed: {snapshot_path}")
    print(f"Records checked: {len(snapshot['records'])}")
    for record in snapshot["records"]:
        print(f"Record ID: {record['id']}")
        print(f"Record content SHA-256: {record['content_sha256']}")
    print(f"Source SHA-256: {snapshot['source_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
