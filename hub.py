"""Collect public metadata, retain observations, and build a static Pages site."""
import argparse
import json
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SITE = ROOT / "site"
DIST = ROOT / "dist"
ATOM = "{http://www.w3.org/2005/Atom}"
KINDS = {"job", "paper", "project", "report", "company"}
REGIONS = {"CN", "UK", "Global"}
TOPICS = {"timeseries", "applied", "research", "mle", "inference", "telecom"}
STATES = {"listed", "observed", "unlisted", "out_of_scope", "reference"}
LONDON = re.compile(r"\b(?:london|united kingdom|uk)\b", re.I)
ALLOWED_HOSTS = {"export.arxiv.org", "rss.arxiv.org", "api.github.com",
                 "boards-api.greenhouse.io", "www.gov.uk"}


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return
    with NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8", newline="\n") as handle:
        handle.write(content)
    try:
        Path(handle.name).replace(path)
    finally:
        Path(handle.name).unlink(missing_ok=True)


def now():
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def record(id, kind, title, organization, url, region, topics, evidence, source,
           published_at=None, status="reference", summary="", location="", updated_at=None):
    return dict(id=id, kind=kind, title=title, organization=organization, url=url,
                region=region, topics=topics, evidence=evidence, source=source,
                published_at=published_at, status=status, summary=summary,
                location=location, updated_at=updated_at)


def text(value):
    return " ".join(value.split())


def canonical_url(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError(f"Expected public HTTPS URL: {url}")
    path = parsed.path.rstrip("/")
    if parsed.hostname == "github.com":
        path = path.casefold()
    tracking = {"gh_src", "team", "ref", "source"}
    query = urlencode(sorted((key, value) for key, value in parse_qsl(parsed.query)
                              if not key.lower().startswith("utm_") and key.lower() not in tracking))
    return f"https://{parsed.netloc.lower()}{path}" + (f"?{query}" if query else "")


def validate_record(row):
    if (row["kind"] not in KINDS or row["region"] not in REGIONS
            or row["status"] not in STATES or row["evidence"] not in {"A", "B"}
            or not row["topics"] or not set(row["topics"]) <= TOPICS):
        raise ValueError(f"Invalid vocabulary: {row['id']}")
    if (row["status"] == "reference") != (row["kind"] != "job"):
        raise ValueError(f"Invalid state for record type: {row['id']}")
    if not all(isinstance(row[key], str) and row[key].strip()
               for key in ("id", "title", "organization", "source")):
        raise ValueError("Missing required record metadata")
    canonical_url(row["url"])
    for key in ("published_at", "updated_at"):
        if row.get(key):
            date.fromisoformat(row[key][:10])


def read_api(url, *, json_response=True):
    host = urlsplit(url).hostname
    if host not in ALLOWED_HOSTS or urlsplit(url).scheme != "https":
        raise ValueError(f"Unconfigured API host: {host}")
    request = Request(url, headers={
        "User-Agent": "AI-Career-Intelligence-Hub/1.0",
        "Accept": "application/json" if json_response else "application/atom+xml",
    })
    if host == "api.github.com" and os.getenv("GITHUB_TOKEN"):
        request.add_unredirected_header("Authorization", f"Bearer {os.environ['GITHUB_TOKEN']}")
    with urlopen(request, timeout=35) as response:
        if urlsplit(response.geturl()).hostname != host:
            raise ValueError("API response moved to a different host")
        body = response.read(4_000_001)
    if len(body) > 4_000_000:
        raise ValueError("API response exceeded size limit")
    return json.loads(body) if json_response else body


def arxiv_records(feed, topics):
    root = ET.fromstring(feed)
    if root.tag != ATOM + "feed":
        raise ValueError("Invalid arXiv Atom response")
    for entry in root.findall(ATOM + "entry"):
        arxiv_id = re.sub(r"v\d+$", "", entry.findtext(ATOM + "id").split("/abs/", 1)[-1])
        if not re.fullmatch(r"\d{4}\.\d{4,5}", arxiv_id):
            raise ValueError(f"Unexpected arXiv ID: {arxiv_id}")
        authors = ", ".join(node.findtext(ATOM + "name") for node in entry.findall(ATOM + "author")[:3])
        yield record(f"arxiv:{arxiv_id}", "paper", text(entry.findtext(ATOM + "title")),
                     authors or "arXiv", f"https://arxiv.org/abs/{arxiv_id}", "Global",
                     topics, "B", "arxiv", entry.findtext(ATOM + "published"),
                     updated_at=entry.findtext(ATOM + "updated"))


def arxiv_rss_records(feed):
    root = ET.fromstring(feed)
    if root.tag != "rss" or root.find("channel") is None:
        raise ValueError("Invalid arXiv RSS response")
    for item in root.findall("channel/item"):
        if item.findtext("{http://arxiv.org/schemas/atom}announce_type") != "new":
            continue
        url = item.findtext("link")
        arxiv_id = urlsplit(url).path.rsplit("/", 1)[-1]
        if urlsplit(url).hostname != "arxiv.org" or not re.fullmatch(r"\d{4}\.\d{4,5}", arxiv_id):
            continue
        authors = item.findtext("{http://purl.org/dc/elements/1.1/}creator", "arXiv")
        published = parsedate_to_datetime(item.findtext("pubDate")).date().isoformat()
        yield record(f"arxiv:{arxiv_id}", "paper", text(item.findtext("title")),
                     ", ".join(authors.split(", ")[:3]), f"https://arxiv.org/abs/{arxiv_id}",
                     "Global", ["research"], "B", "arxiv:rss", published)


def project_record(repo, topics, region, summary):
    if repo["private"]:
        raise ValueError("Only public repositories can be published")
    return record(f"github:{repo['full_name'].lower()}", "project", repo["full_name"],
                  repo["owner"]["login"], repo["html_url"], region, topics, "A", "github",
                  repo["created_at"], summary=summary, updated_at=repo["pushed_at"])


def greenhouse_records(board, company, payload):
    jobs = payload["jobs"]
    if not isinstance(jobs, list) or not jobs:
        raise ValueError("Empty or malformed board; preserve previous vacancy statuses")
    if payload["meta"]["total"] != len(jobs) or len({job["id"] for job in jobs}) != len(jobs):
        raise ValueError("Incomplete board or duplicate IDs; preserve previous vacancy statuses")
    present = {f"greenhouse:{board}:{job['id']}" for job in jobs}
    records = []
    for job in jobs:
        location = job["location"]["name"]
        if not LONDON.search(location) or job.get("internal_job_id", True) is None:
            continue
        title = job["title"]
        title_lower = title.casefold()
        if "expression of interest" in title_lower:
            continue
        topics = []
        for topic, pattern in {
            "research": r"research (engineer|scientist)|research resident",
            "applied": r"applied (scientist|ai engineer)|forward deployed engineer",
            "mle": r"machine learning engineer|engineer, machine learning|\bmle\b",
            "inference": r"\binference\b|\bserving\b",
        }.items():
            if re.search(pattern, title_lower):
                topics.append(topic)
        if topics:
            records.append(record(
                f"greenhouse:{board}:{job['id']}", "job", title, company,
                f"https://job-boards.greenhouse.io/{board}/jobs/{job['id']}", "UK",
                topics, "A", f"greenhouse:{board}", job.get("first_published"),
                "listed", location=location, updated_at=job.get("updated_at")
            ))
    return records, present


def govuk_record(path, payload, summary):
    return record(f"govuk:{path.rsplit('/', 1)[-1]}", "report", payload["title"],
                  "GOV.UK", f"https://www.gov.uk{path}", "UK", ["applied"], "A",
                  "govuk", payload.get("first_published_at"),
                  summary=summary, updated_at=payload.get("public_updated_at"))


def merge(records, incoming, observed_at):
    """Keep one canonical record per stable source ID or canonical source URL."""
    urls = {canonical_url(row["url"]): key for key, row in records.items()}
    for row in incoming:
        validate_record(row)
        url = canonical_url(row["url"])
        original_id = urls.get(url, row["id"])
        previous = records.get(original_id)
        if previous and previous["id"] != row["id"]:
            row = {**row, "id": original_id}
        if previous and not row["summary"] and previous["summary"]:
            row = {**row, "summary": previous["summary"]}
        if previous and not row["published_at"] and previous["published_at"]:
            row = {**row, "published_at": previous["published_at"]}
        if previous and previous["url"] != row["url"]:
            urls.pop(canonical_url(previous["url"]), None)
        urls[url] = original_id
        history = list(previous["history"]) if previous else []
        if not history or history[-1]["value"] != row:
            history.append({"at": observed_at, "value": row})
        records[original_id] = {
            **row, "first_seen": previous["first_seen"] if previous else observed_at,
            "last_seen": previous["last_seen"] if previous and row["status"] == "unlisted" else observed_at,
            "history": history,
        }


def seed_records(state):
    for raw in load(DATA / "seed.json"):
        row = dict(raw)
        observed = row.pop("collected_at")
        previous = state["records"].get(row["id"])
        if not previous or observed > previous["history"][-1]["at"]:
            merge(state["records"], [row], observed)


def apply_board(state, board, incoming, present, observed_at):
    records = state["records"]
    for row in incoming:
        validate_record(row)
    merge(records, incoming, observed_at)
    matched = {row["id"] for row in incoming}
    for previous in list(records.values()):
        if previous["source"] != f"greenhouse:{board}" or previous["id"] in matched:
            continue
        status = "out_of_scope" if previous["id"] in present else "unlisted"
        if previous["status"] != status:
            last_value = previous["history"][-1]["value"]
            merge(records, [{**last_value, "status": status}], observed_at)


def update(state, sources):
    observed = now()
    failures = []

    def run(name, fetch, apply):
        try:
            result = fetch()
            apply(result)
        except (OSError, ValueError, KeyError, TypeError, AttributeError, ET.ParseError) as error:
            failures.append(name)
            state["sources"].setdefault(name, {}).update(
                checked_at=observed, error=type(error).__name__
            )
            print(f"{name}: {type(error).__name__}", file=sys.stderr)
        else:
            state["sources"].setdefault(name, {}).update(
                checked_at=observed, success_at=observed, error=None
            )

    def merge_source(rows):
        for row in rows:
            validate_record(row)
        merge(state["records"], rows, observed)

    for item in sources["github"]:
        repo = item["repo"]
        run(f"github:{repo}", lambda: [project_record(
            read_api(f"https://api.github.com/repos/{repo}"),
            item["topics"], item["region"], item["summary"]
        )], merge_source)
    queries = sources["arxiv"]
    query = " OR ".join(f"ti:\"{item['phrase']}\"" for item in queries)
    args = urlencode(dict(search_query=query, sortBy="submittedDate",
                          sortOrder="descending", max_results=24))

    def new_papers():
        try:
            feed = read_api(f"https://export.arxiv.org/api/query?{args}", json_response=False)
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504}:
                raise
            print(f"arxiv: Atom HTTP {error.code}, using latest official RSS announcements")
            rss = read_api("https://rss.arxiv.org/rss/cs.LG+cs.AI+cs.IT", json_response=False)
            candidates = arxiv_rss_records(rss)
            mode = "rss"
        else:
            candidates = arxiv_records(feed, ["research"])
            mode = "atom"
        papers = []
        for row in candidates:
            topics = {topic for item in queries if item["phrase"].casefold() in row["title"].casefold()
                      for topic in item["topics"]}
            previous = state["records"].get(row["id"])
            if topics and not (mode == "rss" and previous and previous["source"] == "arxiv"):
                row["topics"] = sorted(topics)
                papers.append(row)
        return papers[:24], mode

    def apply_papers(result):
        papers, mode = result
        merge_source(papers)
        state["sources"].setdefault("arxiv", {})["mode"] = mode

    run("arxiv", new_papers, apply_papers)
    for board, company in sources["greenhouse"].items():
        run(f"greenhouse:{board}", lambda: greenhouse_records(
            board, company, read_api(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs")
        ), lambda result: apply_board(state, board, *result, observed))
    for item in sources["govuk"]:
        path = item["path"]
        run(f"govuk:{path}", lambda: [govuk_record(
            path, read_api(f"https://www.gov.uk/api/content{path}"), item["summary"]
        )], merge_source)
    return failures


def previous_month(today):
    return (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")


def monthly_report(state, month):
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("Month must be YYYY-MM")
    date.fromisoformat(month + "-01")
    rows = list(state["records"].values())
    additions = [row["history"][0]["value"] for row in rows if row["first_seen"][:7] == month]
    transitions = []
    for row in rows:
        for previous, event in zip(row["history"], row["history"][1:]):
            if event["at"][:7] == month and previous["value"]["status"] != event["value"]["status"]:
                transitions.append(dict(id=row["id"], at=event["at"], title=event["value"]["title"],
                                        old=previous["value"]["status"], new=event["value"]["status"]))
    return dict(month=month, partial=month >= datetime.now(UTC).strftime("%Y-%m"),
                additions=sorted(additions, key=lambda row: row["id"]),
                changes=sorted(transitions, key=lambda row: (row["at"], row["id"])),
                by_kind=dict(Counter(row["kind"] for row in additions)),
                by_region=dict(Counter(row["region"] for row in additions)),
                by_topic=dict(Counter(topic for row in additions for topic in row["topics"])))


def build(state):
    shutil.copytree(SITE, DIST, dirs_exist_ok=True)
    reports = [load(path) for path in sorted((DATA / "reports").glob("????-??.json"), reverse=True)]
    dump(DIST / "catalog.json", {
        "records": sorted(state["records"].values(), key=lambda row: row["id"]),
        "sources": state["sources"], "reports": reports,
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["update", "report", "build"])
    parser.add_argument("--month", help="Report month YYYY-MM (default: previous UTC month)")
    args = parser.parse_args()
    state_path = DATA / "catalog.json"
    state = load(state_path) if state_path.exists() else {"records": {}, "sources": {}}
    seed_records(state)
    if args.command == "update":
        config = load(DATA / "sources.json")
        failures = update(state, config)
        dump(state_path, state)
        if failures:
            print(f"::warning::{len(failures)} source(s) failed; last verified records retained")
        source_count = len(config["github"]) + len(config["greenhouse"]) + len(config["govuk"]) + 1
        if len(failures) == source_count:
            return 2
    elif args.command == "report":
        month = args.month or previous_month(datetime.now(UTC).date())
        report = monthly_report(state, month)
        dump(DATA / "reports" / f"{month}.json", report)
        print(f"{month}: {len(report['additions'])} additions, {len(report['changes'])} status changes")
    else:
        build(state)
        print(f"{len(state['records'])} records built in {DIST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
