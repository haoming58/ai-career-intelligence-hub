import copy
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import hub

FIRST = "2026-11-11T18:46:00Z"
LATER = "2026-11-18T07:17:00Z"
BOARD = "anthropic"
JOB_ID = "greenhouse:anthropic:10"


def state():
    return {"records": {}, "sources": {}}


def job(id=10, location="London, UK", title="Research Engineer, Pretraining"):
    return {"id": id, "title": title, "location": {"name": location}, "first_published": "2026-10-01"}


def board(*jobs):
    return {"jobs": list(jobs), "meta": {"total": len(jobs)}}


class HubTests(unittest.TestCase):
    def test_seed_is_verified_catalog_shape(self):
        catalog = state()
        hub.seed_records(catalog)
        records = list(catalog["records"].values())
        self.assertEqual(len(records), len(hub.load(hub.DATA / "seed.json")))
        self.assertEqual({r["kind"] for r in records}, hub.KINDS)
        self.assertEqual({topic for r in records for topic in r["topics"]}, hub.TOPICS)
        self.assertTrue({"CN", "UK"} <= {r["region"] for r in records if r["kind"] == "job"})
        self.assertTrue(all(r["first_seen"] and r["url"].startswith("https://") for r in records))
        previous = copy.deepcopy(catalog)
        hub.seed_records(catalog)
        self.assertEqual(previous, catalog)

    def test_stable_url_dedupe_and_history(self):
        records = {}
        row = hub.record("paper", "paper", "A title", "Author", "https://arxiv.org/abs/2403.07815",
                         "Global", ["timeseries"], "B", "arxiv")
        hub.merge(records, [row], FIRST)
        hub.merge(records, [row], LATER)
        self.assertEqual(len(records["paper"]["history"]), 1)
        self.assertEqual(records["paper"]["last_seen"], LATER)
        revised = {**row, "id": "duplicate", "title": "Revised", "url": row["url"] + "?utm_medium=test"}
        hub.merge(records, [revised], LATER)
        self.assertEqual(list(records), ["paper"])
        self.assertEqual([e["value"]["title"] for e in records["paper"]["history"]], ["A title", "Revised"])

    def test_arxiv_parses_versionless_ids(self):
        feed = b"""<feed xmlns="http://www.w3.org/2005/Atom">
        <entry><id>http://arxiv.org/abs/2403.07815v3</id><title>Chronos:  Learning</title>
        <published>2024-03-12T00:00:00Z</published><updated>2024-11-04T00:00:00Z</updated>
        <author><name>Abdul Fatir Ansari</name></author></entry></feed>"""
        row, = hub.arxiv_records(feed, ["timeseries"])
        self.assertEqual(row["id"], "arxiv:2403.07815")
        self.assertEqual(row["title"], "Chronos: Learning")
        self.assertEqual(row["evidence"], "B")
        self.assertEqual(row["published_at"][:10], "2024-03-12")

    def test_arxiv_rate_limit_uses_official_rss(self):
        rss = b"""<rss xmlns:arxiv="http://arxiv.org/schemas/atom"><channel>
        <item><title>Time Series Forecasting Method</title><link>https://arxiv.org/abs/2611.12927</link>
        <arxiv:announce_type>new</arxiv:announce_type><pubDate>Wed, 11 Nov 2026 00:00:00 -0500</pubDate></item>
        <item><title>Time Series Forecasting Revision</title><link>https://arxiv.org/abs/2611.12928</link>
        <arxiv:announce_type>replace</arxiv:announce_type></item></channel></rss>"""
        rate_limit = HTTPError("https://export.arxiv.org", 429, "rate limit", {}, None)
        catalog = state()
        config = {"github": [], "arxiv": [{"phrase": "time series forecasting", "topics": ["timeseries"]}],
                  "greenhouse": {}, "govuk": []}
        with patch.object(hub, "read_api", side_effect=[rate_limit, rss]):
            self.assertEqual(hub.update(catalog, config), [])
        self.assertEqual(list(catalog["records"]), ["arxiv:2611.12927"])
        self.assertEqual(catalog["records"]["arxiv:2611.12927"]["published_at"], "2026-11-11")
        self.assertEqual(catalog["sources"]["arxiv"]["mode"], "rss")

    def test_board_filters_by_location_title_and_prospect(self):
        jobs = board(job(), job(20, "San Francisco, CA"), job(30, title="Office Manager"),
                     job(40, title="[Expression of Interest] Research Engineer"),
                     {**job(50), "internal_job_id": None})
        rows, present = hub.greenhouse_records(BOARD, "Anthropic", jobs)
        self.assertEqual([row["id"] for row in rows], [JOB_ID])
        self.assertEqual(len(present), 5)
        self.assertEqual(rows[0]["published_at"], "2026-10-01")

    def test_closed_and_reopened_job_keeps_observations(self):
        catalog = state()
        sources = hub.greenhouse_records(BOARD, "Anthropic", board(job()))
        hub.apply_board(catalog, BOARD, *sources, FIRST)
        hub.apply_board(catalog, BOARD, [], set(), LATER)
        self.assertEqual(catalog["records"][JOB_ID]["last_seen"], FIRST)
        hub.apply_board(catalog, BOARD, *sources, "2026-11-25T00:00:00Z")
        history = catalog["records"][JOB_ID]["history"]
        self.assertEqual([e["value"]["status"] for e in history], ["listed", "unlisted", "listed"])

    def test_board_move_outside_scope(self):
        catalog = state()
        hub.apply_board(catalog, BOARD, *hub.greenhouse_records(BOARD, "Anthropic", board(job())), FIRST)
        outside = board(job(location="San Francisco, CA"))
        hub.apply_board(catalog, BOARD, *hub.greenhouse_records(BOARD, "Anthropic", outside), LATER)
        self.assertEqual(catalog["records"][JOB_ID]["status"], "out_of_scope")

    def test_failed_source_does_not_close_vacancies(self):
        catalog = state()
        hub.apply_board(catalog, BOARD, *hub.greenhouse_records(BOARD, "Anthropic", board(job())), FIRST)
        catalog["sources"]["greenhouse:anthropic"] = {"success_at": FIRST}
        config = {"github": [], "arxiv": [], "greenhouse": {BOARD: "Anthropic"}, "govuk": []}
        with patch.object(hub, "read_api", side_effect=[b'<feed xmlns="http://www.w3.org/2005/Atom"/>',
                                                         {"jobs": [job()], "meta": {"total": 2}}]):
            failures = hub.update(catalog, config)
        self.assertEqual(failures, ["greenhouse:anthropic"])
        self.assertEqual(catalog["records"][JOB_ID]["status"], "listed")
        self.assertEqual(catalog["sources"]["greenhouse:anthropic"]["success_at"], FIRST)

    def test_month_report_uses_original_observation_and_state_changes(self):
        catalog = state()
        hub.apply_board(catalog, BOARD, *hub.greenhouse_records(BOARD, "Anthropic", board(job())), FIRST)
        hub.apply_board(catalog, BOARD, [], set(), LATER)
        report = hub.monthly_report(catalog, "2026-11")
        self.assertEqual(report["by_region"], {"UK": 1})
        self.assertEqual(report["additions"][0]["status"], "listed")
        self.assertEqual(report["changes"][0]["new"], "unlisted")
        self.assertEqual(hub.previous_month(date(2027, 1, 1)), "2026-12")
        with self.assertRaises(ValueError):
            hub.monthly_report(catalog, "2026-19")

    def test_build_contains_data_assets_and_only_public_content(self):
        catalog = state()
        hub.seed_records(catalog)
        with tempfile.TemporaryDirectory() as folder, patch.object(hub, "DIST", Path(folder)):
            hub.build(catalog)
            built = hub.load(Path(folder) / "catalog.json")
            self.assertEqual(len(built["records"]), len(catalog["records"]))
            for path in ("index.html", "style.css", "app.js", "starter.json"):
                self.assertTrue((Path(folder) / path).is_file())
            self.assertNotIn("workspace", built)
