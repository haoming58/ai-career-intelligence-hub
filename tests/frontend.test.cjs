const {test} = require("node:test");
const assert = require("node:assert/strict");
const {filterCatalog, catalogUrl, route, overview, entry, renderReports} = require("../site/app.js");
const seed = require("../data/seed.json");
const rows = seed.map(({collected_at, ...row}) => ({
  ...row,
  first_seen: collected_at,
  last_seen: collected_at,
  history: [{at: collected_at, value: row}]
}));

test("search combines bilingual keywords and filters", () => {
  const matches = filterCatalog(rows, {q: "amazon 时序", region: "UK", kind: "job", topic: "timeseries"});
  assert.deepEqual(matches.map(row => row.id), ["amazon:10556295"]);
  assert.ok(filterCatalog(rows, {q: "北京", kind: "job", status: "observed"}).length);
  assert.equal(filterCatalog(rows, {q: "amazon", region: "CN", kind: "job"}).length, 0);
});

test("technical total links to paper and project only", () => {
  const matches = filterCatalog(rows, {kind: "technical"});
  assert.equal(matches.length, rows.filter(row => ["paper", "project"].includes(row.kind)).length);
  assert.match(overview({records: rows, sources: {}}), /#catalog\?kind=technical/);
});

test("filter URL preserves Chinese search terms", () => {
  assert.deepEqual(route(catalogUrl({q: "伦敦 推理", kind: "job", region: ""})),
    {view: "catalog", params: {q: "伦敦 推理", kind: "job"}});
});

test("catalog renders escaped content and evidence with source links", () => {
  const card = entry({...rows[0], title: '<img src=x onerror=alert(1)>'});
  assert.ok(card.includes("&lt;img"));
  assert.ok(!card.includes("<img"));
  assert.ok(card.includes("证据 A"));
  assert.ok(card.includes('rel="noopener noreferrer"'));
});

test("reports expose empty and partial states", () => {
  assert.match(renderReports([]), /暂无月度报告/);
  assert.match(renderReports([{month: "2026-11", partial: true, additions: rows.slice(0, 1), changes: [],
    by_region: {CN: 1}, by_kind: {job: 1}, by_topic: {mle: 1}}]), /月内快照/);
});
