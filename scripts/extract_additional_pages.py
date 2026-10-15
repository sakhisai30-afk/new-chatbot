from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup, Tag

from extract_healthcare import (
    OUTPUT_DIR,
    SOURCE_URL as HEALTHCARE_SOURCE_URL,
    USER_AGENT,
    collect_section_blocks,
    content_hash,
    extract_record as extract_healthcare_record,
    normalize_text,
    render_blocks,
)
from validate_extraction import validate_snapshot


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://zuigo.ai"
SERVICE_PAGES = (
    {
        "id": "ai-ml",
        "label": "AI & Machine Learning",
        "path": "/services/ai-machine-learning",
    },
    {
        "id": "fintech",
        "label": "Fintech",
        "path": "/services/fintech-software",
    },
    {
        "id": "custom-software",
        "label": "Custom Software Development",
        "path": "/services/custom-software",
    },
    {
        "id": "cloud-devops",
        "label": "Cloud & DevOps",
        "path": "/services/cloud-devops",
    },
)
INFORMATION_PAGES = (
    {"id": "about", "label": "About ZuiGO", "path": "/about"},
    {"id": "contact", "label": "Contact", "path": "/contact"},
    {"id": "home", "label": "Home", "path": "/"},
    {"id": "services", "label": "Services", "path": "/services"},
)
BOOKING_PATH = "/book"
SERVICE_TOPICS = ("Solutions", "How We Deliver", "Technologies", "Projects")


def allowed_by_robots(session: requests.Session, url: str) -> bool:
    parsed_url = urlparse(url)
    robots_url = f"{parsed_url.scheme}://{parsed_url.netloc}/robots.txt"
    response = session.get(robots_url, timeout=20)
    response.raise_for_status()

    robots = RobotFileParser()
    robots.set_url(robots_url)
    robots.parse(response.text.splitlines())
    return robots.can_fetch(USER_AGENT, url)


def fetch_page(session: requests.Session, url: str) -> requests.Response:
    if not allowed_by_robots(session, url):
        raise RuntimeError(f"robots.txt disallows extraction of {url}")
    response = session.get(url, timeout=30)
    response.raise_for_status()
    return response


def page_title(soup: BeautifulSoup) -> str:
    title = soup.find("title")
    if not isinstance(title, Tag):
        raise RuntimeError("Page title was not found")
    text = normalize_text(title.get_text(" ", strip=True))
    if not text:
        raise RuntimeError("Page title was empty")
    return text


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
        raise RuntimeError("Page introduction was not found")
    return "\n\n".join(paragraphs)


def collect_sections(main: Tag) -> list[dict[str, object]]:
    sections: list[dict[str, object]] = []
    for heading in main.find_all("h2"):
        heading_text = normalize_text(heading.get_text(" ", strip=True))
        blocks = collect_section_blocks(heading)
        if heading_text and blocks:
            sections.append({"heading": heading_text, "content": blocks})
    return sections


def section_text(section: dict[str, object]) -> str:
    content = section["content"]
    if not isinstance(content, list):
        raise RuntimeError("Extracted section content was not a list")
    return render_blocks(content)


def extract_service_record(
    html: bytes, source_url: str, service: dict[str, str]
) -> dict[str, object]:
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main")
    if not isinstance(main, Tag):
        raise RuntimeError("Static HTML did not contain a main content element")
    title = main.find("h1")
    if not isinstance(title, Tag):
        raise RuntimeError("Service page title was not found")

    sections = collect_sections(main)
    topics: dict[str, str] = {topic: "" for topic in SERVICE_TOPICS}
    for section in sections:
        heading = str(section["heading"]).casefold()
        text = f"{section['heading']}\n{section_text(section)}"
        if heading.startswith(("why choose", "what's included")):
            topics["Solutions"] += f"{text}\n\n"
        elif heading.startswith("how does"):
            topics["How We Deliver"] += f"{text}\n\n"
        elif heading.startswith("which technologies"):
            topics["Technologies"] += f"{text}\n\n"
        elif "projects does" in heading:
            topics["Projects"] += f"{text}\n\n"

    missing_topics = [topic for topic, text in topics.items() if not text.strip()]
    if missing_topics:
        raise RuntimeError(
            f"Expected service topics not found on {source_url}: "
            + ", ".join(missing_topics)
        )

    record: dict[str, object] = {
        "kind": "service",
        "id": service["id"],
        "label": service["label"],
        "name": normalize_text(title.get_text(" ", strip=True)),
        "page_title": page_title(soup),
        "introduction": collect_introduction(main, title),
        "source": source_url,
        "topics": {topic: text.strip() for topic, text in topics.items()},
        "sections": sections,
    }
    record["content_sha256"] = content_hash(record)
    return record


def jsonld_objects(value: object) -> list[dict[str, object]]:
    if isinstance(value, list):
        return [item for child in value for item in jsonld_objects(child)]
    if not isinstance(value, dict):
        return []

    objects = [value]
    for key in ("@graph", "mainEntity", "publisher", "provider"):
        if key in value:
            objects.extend(jsonld_objects(value[key]))
    return objects


def organization_data(soup: BeautifulSoup) -> dict[str, object]:
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            payload = json.loads(script.get_text())
        except json.JSONDecodeError:
            continue
        for item in jsonld_objects(payload):
            types = item.get("@type", [])
            if isinstance(types, str):
                types = [types]
            if "Organization" in types and item.get("name") == "ZuiGO":
                return item
    return {}


def extract_page_record(
    html: bytes,
    source_url: str,
    page: dict[str, str],
) -> dict[str, object]:
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main")
    if not isinstance(main, Tag):
        raise RuntimeError("Static HTML did not contain a main content element")
    title = main.find("h1")
    if not isinstance(title, Tag):
        raise RuntimeError("Page heading was not found")

    sections = collect_sections(main)
    for section in sections:
        kept_blocks = []
        for block in section["content"]:
            if block.get("type") == "link":
                full_url = urljoin(source_url, str(block.get("href", "")).strip())
                if not full_url.lower().startswith(("http://", "https://", "mailto:")):
                    continue
                block["href"] = full_url
            kept_blocks.append(block)
        section["content"] = kept_blocks
    topics: dict[str, str] = {
        str(section["heading"]): section_text(section) for section in sections
    }

    if page["id"] == "contact":
        for heading in main.find_all("h3"):
            heading_text = normalize_text(heading.get_text(" ", strip=True))
            blocks = collect_section_blocks(heading)
            if heading_text and blocks:
                section = {"heading": heading_text, "content": blocks}
                sections.append(section)
                topics[heading_text] = section_text(section)

        email_link = next(
            (
                link
                for link in main.find_all("a", href=True)
                if str(link.get("href")).casefold().startswith("mailto:")
            ),
            None,
        )
        if email_link is not None:
            email_section = {
                "heading": "Email",
                "content": [
                    {
                        "type": "link",
                        "text": normalize_text(email_link.get_text(" ", strip=True)),
                        "href": str(email_link.get("href")),
                    }
                ],
            }
            sections.append(email_section)
            topics["Email"] = section_text(email_section)

        org = organization_data(soup)
        email = org.get("email")
        telephone = org.get("telephone")
        address = org.get("address")
        address_text = ""
        if isinstance(address, dict):
            address_parts = [
                address.get("addressLocality"),
                address.get("addressRegion"),
                address.get("addressCountry"),
            ]
            address_text = ", ".join(
                str(part) for part in address_parts if isinstance(part, str) and part
            )
        if not isinstance(email, str) or not isinstance(telephone, str):
            raise RuntimeError("Official contact email or telephone was not found")
        if not address_text:
            raise RuntimeError("Official organization location was not found")

        form_labels = [
            normalize_text(label.get_text(" ", strip=True))
            for label in main.find_all("label")
            if normalize_text(label.get_text(" ", strip=True))
        ]
        response_text = " ".join(main.stripped_strings)
        response_claim = (
            "The contact page says ZuiGO will reply within 24 hours."
            if "within 24 hours" in response_text.casefold()
            else "The contact page does not state a reply timeframe."
        )
        topics["Contact details"] = (
            f"Email: {email}\nTelephone: {telephone}\n{response_claim}"
        )
        topics["Location"] = (
            f"Organization structured data lists: {address_text}. "
            "No street address was published in this structured data."
        )
        if form_labels:
            topics["Contact form fields"] = "\n".join(f"- {label}" for label in form_labels)
            sections.append(
                {
                    "heading": "Contact form fields",
                    "content": [
                        {"type": "list_item", "text": label}
                        for label in form_labels
                    ],
                }
            )
        form_options: list[dict[str, str]] = []
        for select in main.find_all("select"):
            label = select.find_previous("label")
            label_text = (
                normalize_text(label.get_text(" ", strip=True))
                if isinstance(label, Tag)
                else ""
            )
            if not label_text:
                continue
            options = [
                normalize_text(option.get_text(" ", strip=True))
                for option in select.find_all("option")
            ]
            options = [
                option
                for option in options
                if option and not option.casefold().startswith("select ")
            ]
            if options:
                form_options.append({"label": label_text, "options": options})
        if form_options:
            option_blocks: list[dict[str, str]] = []
            for form_option in form_options:
                option_blocks.append(
                    {"type": "subheading", "text": form_option["label"]}
                )
                option_blocks.extend(
                    {"type": "list_item", "text": option}
                    for option in form_option["options"]
                )
            option_section = {
                "heading": "Contact form options",
                "content": option_blocks,
            }
            sections.append(option_section)
            topics["Contact form options"] = section_text(option_section)
        booking_link = next(
            (
                urljoin(source_url, str(link.get("href")))
                for link in main.find_all("a", href=True)
                if normalize_text(link.get_text(" ", strip=True)).casefold()
                == "book a call"
            ),
            None,
        )
        if booking_link:
            topics["Meeting"] = (
                "The Contact page offers a 30-minute call. Its “Book a Call” "
                f"link points to {booking_link}."
            )

    if not topics:
        raise RuntimeError(f"No relevant content sections were found on {source_url}")

    record: dict[str, object] = {
        "kind": "page",
        "id": page["id"],
        "label": page["label"],
        "name": normalize_text(title.get_text(" ", strip=True)),
        "page_title": page_title(soup),
        "introduction": collect_introduction(main, title),
        "source": source_url,
        "topics": topics,
        "sections": sections,
    }
    record["content_sha256"] = content_hash(record)
    return record


def extract_booking_record(
    session: requests.Session, source_url: str
) -> tuple[dict[str, object], bytes]:
    if not allowed_by_robots(session, source_url):
        raise RuntimeError(f"robots.txt disallows extraction of {source_url}")

    redirect = session.get(source_url, timeout=30, allow_redirects=False)
    if redirect.is_redirect:
        destination = urljoin(source_url, redirect.headers.get("Location", ""))
    else:
        destination = source_url
    parsed_destination = urlparse(destination)
    if parsed_destination.scheme != "https" or not parsed_destination.netloc:
        raise RuntimeError("Booking route did not resolve to a safe HTTPS URL")
    if not allowed_by_robots(session, destination):
        raise RuntimeError(f"robots.txt disallows extraction of {destination}")

    response = session.get(destination, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, "html.parser")
    title = page_title(soup)
    booking_url = response.url
    record: dict[str, object] = {
        "kind": "booking",
        "id": "meeting",
        "label": "Meeting and booking",
        "name": "Book a Call",
        "page_title": title,
        "introduction": (
            "The official Contact page offers a 30-minute call. The ZuiGO "
            "booking route redirects to the verified destination below."
        ),
        "source": source_url,
        "resolved_url": booking_url,
        "evidence_source": f"{BASE_URL}/contact",
        "topics": {
            "Meeting": "ZuiGO's Contact page describes the call as 30 minutes.",
            "Booking URL": booking_url,
            "Availability": (
                "The booking destination requires JavaScript and its appointment "
                "slots and availability could not be verified from the static page."
            ),
        },
        "sections": [
            {
                "heading": "Booking destination",
                "content": [
                    {
                        "type": "link",
                        "text": "Book a Call",
                        "href": booking_url,
                    },
                    {
                        "type": "paragraph",
                        "text": (
                            "The destination page title is "
                            f"{title}. Static extraction did not expose appointment "
                            "slots or availability."
                        ),
                    },
                ],
            }
        ],
    }
    record["content_sha256"] = content_hash(record)
    return record, response.content


def make_snapshot(source_url: str, source_bytes: bytes, record: dict[str, object]) -> dict[str, object]:
    fetched_at = datetime.now(timezone.utc)
    return {
        "schema_version": 1,
        "source": source_url,
        "fetched_at": fetched_at.isoformat(),
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "records": [record],
    }


def save_snapshot(
    slug: str,
    source_url: str,
    source_bytes: bytes,
    record: dict[str, object],
    refresh: bool = False,
) -> Path | None:
    existing = list(OUTPUT_DIR.glob(f"{slug}-*.json"))
    if existing and not refresh:
        print(f"Skipped {slug}: a snapshot already exists")
        return None

    snapshot = make_snapshot(source_url, source_bytes, record)
    errors = validate_snapshot(snapshot)
    if errors:
        raise RuntimeError(
            f"Refusing to save invalid {slug} snapshot: " + "; ".join(errors)
        )
    fetched_at = datetime.fromisoformat(str(snapshot["fetched_at"]))
    if existing:
        if len(existing) != 1:
            raise RuntimeError(
                f"Expected one existing {slug} snapshot, found {len(existing)}"
            )
        output_path = OUTPUT_DIR / (
            f"{slug}-{fetched_at.strftime('%Y%m%dT%H%M%SZ')}.json"
        )
        previous_path = existing[0]
        status = "Updated"
    else:
        output_path = OUTPUT_DIR / (
            f"{slug}-{fetched_at.strftime('%Y%m%dT%H%M%SZ')}.json"
        )
        previous_path = None
        status = "Saved"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=OUTPUT_DIR,
            delete=False,
        ) as file:
            temporary_path = file.name
            json.dump(snapshot, file, ensure_ascii=False, indent=2)
            file.write("\n")
        os.replace(temporary_path, output_path)
        if previous_path is not None and previous_path != output_path:
            previous_path.unlink()
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)
    print(f"{status} {output_path.relative_to(ROOT)}")
    return output_path


def main() -> int:
    if len(sys.argv) > 2 or (len(sys.argv) == 2 and sys.argv[1] != "--refresh"):
        print(
            "Usage: python scripts/extract_additional_pages.py [--refresh]",
            file=sys.stderr,
        )
        return 2
    refresh = len(sys.argv) == 2
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    failures = 0

    try:
        healthcare_response = fetch_page(session, HEALTHCARE_SOURCE_URL)
        healthcare_record = extract_healthcare_record(healthcare_response.content)
        save_snapshot(
            "healthcare",
            HEALTHCARE_SOURCE_URL,
            healthcare_response.content,
            healthcare_record,
            refresh=refresh,
        )
    except (requests.RequestException, OSError, RuntimeError, ValueError) as error:
        failures += 1
        print(
            f"Extraction failed for {HEALTHCARE_SOURCE_URL}: {error}",
            file=sys.stderr,
        )

    for service in SERVICE_PAGES:
        source_url = urljoin(BASE_URL, service["path"])
        try:
            response = fetch_page(session, source_url)
            record = extract_service_record(response.content, source_url, service)
            save_snapshot(
                service["id"], source_url, response.content, record, refresh=refresh
            )
        except (requests.RequestException, OSError, RuntimeError, ValueError) as error:
            failures += 1
            print(f"Extraction failed for {source_url}: {error}", file=sys.stderr)

    for page in INFORMATION_PAGES:
        source_url = urljoin(BASE_URL, page["path"])
        try:
            response = fetch_page(session, source_url)
            record = extract_page_record(response.content, source_url, page)
            save_snapshot(
                page["id"], source_url, response.content, record, refresh=refresh
            )
        except (requests.RequestException, OSError, RuntimeError, ValueError) as error:
            failures += 1
            print(f"Extraction failed for {source_url}: {error}", file=sys.stderr)

    booking_source = urljoin(BASE_URL, BOOKING_PATH)
    try:
        record, source_bytes = extract_booking_record(session, booking_source)
        save_snapshot(
            "meeting", booking_source, source_bytes, record, refresh=refresh
        )
    except (requests.RequestException, OSError, RuntimeError, ValueError) as error:
        failures += 1
        print(f"Extraction failed for {booking_source}: {error}", file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
