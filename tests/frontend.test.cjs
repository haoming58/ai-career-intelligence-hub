const {test} = require("node:test");
const assert = require("node:assert/strict");
const {filterCatalog, catalogUrl, route, overview, entry, renderReports,
  companyDirectory, hiringGuides, jobDetail} = require("../site/app.js");
const seed = require("../data/seed.json");
const guides = require("../site/hiring.json");
const {questions, roleQuestions} = require("../site/starter.json");
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
  const mainland = filterCatalog(rows, {q: "amazon", region: "CN", kind: "job"});
  assert.ok(!mainland.some(row => row.id === "amazon:10556295"));
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

test("mainland company directory opens departments and specific jobs", () => {
  const mainland = companyDirectory(rows, {region: "CN"});
  const row = rows.find(job => job.organization === "百度" && job.department);
  assert.ok(row);
  assert.match(mainland, /百度/);
  assert.doesNotMatch(mainland, /Anthropic/);
  const company = companyDirectory(rows, {region: "CN", org: row.organization, dept: row.department});
  assert.ok(company.includes("#job?id=" + encodeURIComponent(row.id)));
  assert.ok(company.includes(row.department));
});

test("specific vacancy preserves qualifications, sources and scoped guides", () => {
  const row = rows.find(job => job.organization === "百度" && job.requirements?.length);
  assert.ok(row);
  const detail = jobDetail(row, guides, questions, roleQuestions);
  assert.ok(detail.includes(row.requirements[0]));
  assert.match(detail, /百度招聘流程/);
  assert.match(detail, /talent\.baidu\.com\/mobile\/recruit\/help\.html/);
  assert.match(detail, /官方岗位与投递入口/);
  assert.match(detail, /#workspace\?topic=/);
  const bosch = rows.find(job => job.id === "bosch:744000046275615");
  assert.ok(jobDetail(bosch, guides, questions, roleQuestions).includes(roleQuestions[bosch.id].title));
  const amazon = rows.find(job => job.id === "amazon:10504493");
  assert.ok(amazon);
  assert.ok(hiringGuides(guides, amazon).length);
  assert.ok(hiringGuides(guides, amazon).every(guide => guide.region === "CN"));
});

test("every posting-specific hiring guide refers to a matching seed vacancy", () => {
  for (const guide of guides) {
    assert.equal(new URL(guide.url).protocol, "https:");
    assert.ok(guide.stages.length > 0);
    for (const id of guide.roleIds || []) {
      const row = rows.find(job => job.id === id && job.kind === "job");
      assert.ok(row, id);
      assert.ok(hiringGuides([guide], row).length, id);
    }
  }
  for (const id of Object.keys(roleQuestions)) {
    assert.ok(rows.some(job => job.id === id && job.kind === "job"), id);
  }
});
