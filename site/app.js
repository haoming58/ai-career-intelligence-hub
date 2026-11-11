"use strict";

const kinds = {job: "岗位", paper: "论文", project: "开源项目", company: "企业", report: "产业报告"};
const topics = {timeseries: "时序算法", applied: "Applied Scientist", research: "Research Engineer",
  mle: "MLE", inference: "LLM 推理", telecom: "通信 AI"};
const regions = {CN: "中国大陆", UK: "英国", Global: "全球"};
const states = {listed: "官方职位板在列", observed: "人工核验样本", unlisted: "已从职位板移除",
  out_of_scope: "已超出监测范围", reference: "资料"};
const workTypes = {skill: "能力", research: "科研项目", engineering: "工程项目", learning: "学习计划"};
const workStates = {planned: "待开始", active: "进行中", done: "已完成"};
const views = new Set(["overview", "companies", "job", "catalog", "workspace", "reports"]);
const storeKey = "career-intelligence-hub:v1";
const undisclosedDepartment = "部门未公开";

function html(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
}

function dateLabel(value) {
  return value ? value.slice(0, 10) : "未公开";
}

function timeLabel(value) {
  return value ? value.slice(0, 19).replace("T", " ") + " UTC" : "—";
}

function options(labels, active, all) {
  const prefix = all ? '<option value="">' + html(all) + '</option>' : "";
  return prefix + Object.entries(labels).map(([value, label]) =>
    '<option value="' + value + '"' + (value === active ? " selected" : "") + '>' + html(label) + '</option>'
  ).join("");
}

function viewUrl(view, filters = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  return "#" + view + (query.size ? "?" + query.toString() : "");
}

function catalogUrl(filters = {}) {
  return viewUrl("catalog", filters);
}

function filterCatalog(records, filters = {}) {
  const terms = (filters.q || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  return records.filter(row => {
    const kindMatch = !filters.kind || row.kind === filters.kind ||
      (filters.kind === "technical" && ["paper", "project"].includes(row.kind));
    if (!kindMatch ||
        (filters.region && row.region !== filters.region) ||
        (filters.topic && !row.topics.includes(filters.topic)) ||
        (filters.status && row.status !== filters.status)) return false;
    const haystack = [row.title, row.organization, row.department, row.location, row.summary, row.id,
      ...(row.requirements || []),
      kinds[row.kind], regions[row.region], ...row.topics.map(topic => topics[topic])].join(" ").toLowerCase();
    return terms.every(term => haystack.includes(term));
  }).sort((a, b) => b.first_seen.localeCompare(a.first_seen) ||
    (b.published_at || "").localeCompare(a.published_at || "") || a.title.localeCompare(b.title));
}

function route(hash) {
  const [view, query] = hash.slice(1).split("?", 2);
  return {view: views.has(view) ? view : "overview", params: Object.fromEntries(new URLSearchParams(query))};
}

function link(row, label = row.title, className = "") {
  const url = new URL(row.url);
  if (url.protocol !== "https:") return html(label);
  return '<a href="' + html(url.href) + '" target="_blank" rel="noopener noreferrer"' +
    (className ? ' class="' + html(className) + '"' : "") + '>' + html(label) + '</a>';
}

function pageLink(view, params, label, className = "") {
  return '<a href="' + html(viewUrl(view, params)) + '"' + (className ? ' class="' + className + '"' : "") +
    '>' + html(label) + '</a>';
}

function jobLink(row, label = row.title) {
  return pageLink("job", {id: row.id}, label);
}

function department(row) {
  return row.department || undisclosedDepartment;
}

function recruiting(row) {
  return row.status === "listed" || row.status === "observed";
}

function jobState(row) {
  const color = row.status === "listed" ? "green" : recruiting(row) ? "" : "amber";
  return chip(states[row.status], color);
}

function chip(label, color = "") {
  return '<span class="chip' + (color ? " chip-" + color : "") + '">' + html(label) + '</span>';
}

function intro(title, description) {
  return '<header class="intro"><h1>' + title + '</h1><p>' + description + '</p></header>';
}

function counts(records, key) {
  const result = {};
  for (const row of records) {
    const values = [].concat(row[key]);
    for (const value of values) result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function plot(labels, totals) {
  const max = Math.max(1, ...Object.values(totals));
  return '<div class="plot">' + Object.entries(labels).map(([key, label]) => {
    const value = totals[key] || 0;
    return '<div class="plot-row"><span>' + html(label) + '</span><span class="bar" aria-hidden="true"><b style="width:' +
      Math.round(value / max * 100) + '%"></b></span><strong>' + value + '</strong></div>';
  }).join("") + '</div>';
}

function overview(catalog) {
  const {records, sources} = catalog;
  const openings = filterCatalog(records, {kind: "job"}).filter(recruiting);
  const sourceChecks = Object.entries(sources);
  const failed = sourceChecks.filter(([, value]) => value.error);
  const latest = sourceChecks.map(([, value]) => value.success_at || "").sort().at(-1);
  const marketSections = ["CN", "UK"].map(region => {
    const jobs = openings.filter(row => row.region === region);
    const employers = new Set(jobs.map(row => row.organization)).size;
    return '<section class="market"><div class="market-heading"><div><h2>' + regions[region] + '</h2><p>' +
      jobs.length + ' 个在列或人工核验岗位 / ' + employers + ' 家雇主</p></div>' +
      pageLink("companies", {region}, "浏览公司", "button secondary") + '</div>' +
      (jobs.length ? '<ul class="feed">' + jobs.slice(0, 4).map(row => '<li>' + jobLink(row) + '<small>' +
        html([row.organization, department(row), row.location].filter(Boolean).join(" / ")) + '</small></li>').join("") + '</ul>' :
        '<p class="muted">暂无在列或人工核验样本。</p>') + '</section>';
  }).join("");
  return '<header class="hero"><div><h1>AI 职业情报站</h1><p>按公司与部门找岗位，查看官方申请入口，准备技术面试。</p></div>' +
    '<a class="button" href="#companies?region=CN">探索中国大陆岗位</a></header>' +
    '<div class="market-grid">' + marketSections + '</div>' +
    '<section class="direction-section" aria-label="按方向查找岗位"><h2>按方向查找岗位</h2><div class="tiles">' +
    Object.entries(topics).map(([key, label]) => '<a class="tile" href="' + html(catalogUrl({kind: "job", topic: key})) + '">' +
      label + '</a>').join("") + '</div></section>' +
    '<section class="panel"><div class="heading"><h2>研究与产业</h2><a href="#catalog">查看完整情报库</a></div>' +
    '<div class="resource-links"><a href="#catalog?kind=technical">论文与开源项目</a><a href="#catalog?kind=report">产业报告</a>' +
    '<a href="#catalog?kind=company">企业资料</a></div></section>' +
    '<section class="source-panel"><div class="heading"><h2>采集状态</h2></div>' +
    (sourceChecks.length ? '<p class="meta">最近成功采集 ' + html(timeLabel(latest)) + '</p><details><summary>查看 ' +
      sourceChecks.length + ' 个接口</summary><ul class="source-list">' + sourceChecks.map(([name, source]) =>
        '<li>' + html(name) + '<small>' + (source.error ? "请求失败 · " + html(source.error) : "请求成功") +
        (source.mode === "rss" ? " · RSS 最新公告" : "") +
        ' · ' + html(timeLabel(source.checked_at)) + '</small></li>').join("") + '</ul></details>' :
      '<p class="meta">当前显示人工核验的初始数据。公开接口状态将在采集后显示。</p>') +
    (failed.length ? '<p class="notice">' + failed.length + ' 个接口采集失败，相关记录沿用上次核验结果。</p>' : "") + '</section>';
}

function entry(row) {
  return '<article class="entry"><div class="chips">' + chip(kinds[row.kind]) +
    (row.kind === "job" ? jobState(row) : "") + chip("证据 " + row.evidence) +
    '</div><h3>' + (row.kind === "job" ? jobLink(row) : link(row)) + '</h3><p class="meta">' +
    html([row.organization, row.department, regions[row.region], row.location].filter(Boolean).join(" / ")) + '</p>' +
    (row.summary ? '<p class="summary">' + html(row.summary) + '</p>' : "") +
    '<div class="chips">' + row.topics.map(topic => chip(topics[topic])).join("") + '</div>' +
    '<p class="meta">发布 ' + html(dateLabel(row.published_at)) + ' · 最近采集 ' + html(timeLabel(row.last_seen)) + '</p>' +
    recordHistory(row) + '</article>';
}

function recordHistory(row) {
  return '<details><summary>来源与历史 (' + row.history.length + ')</summary><p>' + link(row, "打开原始来源") +
    ' · ' + html(row.source) + '</p><ol class="history">' + row.history.map(event =>
      '<li>' + html(timeLabel(event.at)) + ' · ' + html(states[event.value.status]) + ' · ' +
      html(event.value.title) + '</li>').join("") + '</ol></details>';
}

function hiringGuides(guides, row) {
  return guides.filter(guide => guide.organization === row.organization &&
    (!guide.region || guide.region === row.region) &&
    (!guide.roleIds || guide.roleIds.includes(row.id)) &&
    (!guide.topics || guide.topics.some(topic => row.topics.includes(topic))));
}

function crumbs(items) {
  return '<nav class="crumbs" aria-label="当前位置"><ol>' + items.map(item =>
    '<li>' + item + '</li>').join("") + '</ol></nav>';
}

function vacancyList(rows) {
  return '<ul class="vacancy-list">' + rows.map(row => '<li><div>' + jobLink(row) +
    '<p>' + html([row.location, ...row.topics.map(topic => topics[topic])].filter(Boolean).join(" / ")) +
    '</p></div>' + jobState(row) + '</li>').join("") + '</ul>';
}

function companyDirectory(records, params) {
  const region = ["CN", "UK"].includes(params.region) ? params.region : "";
  const jobs = filterCatalog(records, {kind: "job", region});
  const groups = Map.groupBy(jobs, row => row.organization);
  const directory = pageLink("companies", {region}, region ? regions[region] + "公司" : "公司与岗位");
  if (params.org) {
    const companyJobs = groups.get(params.org) || [];
    const profile = records.find(row => row.kind === "company" && row.organization === params.org);
    const departments = Map.groupBy(companyJobs, department);
    const activeDepartment = departments.has(params.dept) ? params.dept : "";
    const selected = activeDepartment ? [[activeDepartment, departments.get(activeDepartment)]] : [...departments];
    return crumbs([directory, '<span aria-current="page">' + html(params.org) + '</span>']) +
      intro(html(params.org), profile?.summary ? html(profile.summary) : "查看该公司公开的部门、招聘分组与岗位。") +
      (profile ? '<p class="company-source">' + link(profile, "公司官方资料") + '</p>' : "") +
      (companyJobs.length ? '<div class="segments" aria-label="部门或招聘分组筛选">' +
        [["", "全部部门"], ...[...departments.keys()].map(name => [name, name])].map(([value, name]) =>
          '<a href="' + html(viewUrl("companies", {region, org: params.org, dept: value})) + '"' +
          (value === activeDepartment ? ' aria-current="true"' : "") + '>' + html(name) + '</a>').join("") + '</div>' +
        '<div class="department-list">' + selected.map(([name, rows]) =>
          '<section class="department"><div class="heading"><h2>' + html(name) + '</h2><span class="meta">' +
          rows.length + ' 个岗位记录</span></div>' + vacancyList(rows) + '</section>').join("") + '</div>' :
        '<p class="empty">该公司在当前地区暂无岗位记录。</p>');
  }
  const ordered = [...groups].sort((a, b) =>
    b[1].filter(recruiting).length - a[1].filter(recruiting).length || a[0].localeCompare(b[0], "zh-CN"));
  return intro("公司与岗位", "按地区查看雇主，再进入部门和具体岗位。数量来自本站已核验的招聘样本。") +
    '<div class="segments" aria-label="地区筛选">' + [["", "全部地区"], ["CN", regions.CN], ["UK", regions.UK]]
      .map(([value, name]) => '<a href="' + html(viewUrl("companies", {region: value})) + '"' +
        (value === region ? ' aria-current="true"' : "") + '>' + name + '</a>').join("") + '</div>' +
    (ordered.length ? '<div class="company-list"><p class="meta list-caption">' + ordered.length +
      ' 家雇主 / ' + jobs.length + ' 个岗位记录</p><ul>' + ordered.map(([organization, rows]) => {
      const places = [...new Set(rows.map(row => regions[row.region]))].join(" / ");
      const known = new Set(rows.filter(row => row.department).map(department)).size;
      return '<li><a class="company-row" href="' + html(viewUrl("companies", {region, org: organization})) +
        '"><span><strong>' + html(organization) + '</strong><small>' + html(places) +
        (known ? " / " + known + " 个已知部门" : "") + '</small></span><span class="company-count"><strong>' +
        rows.filter(recruiting).length + '</strong><small>在列或人工核验</small></span></a></li>';
    }).join("") + '</ul></div>' : '<p class="empty">当前地区暂无岗位记录。</p>');
}

function jobDetail(row, guides, questions, roleQuestions = {}) {
  if (!row) return intro("岗位详情", "未找到该岗位记录。") + '<a href="#companies">返回公司与岗位</a>';
  const org = {region: row.region, org: row.organization};
  const matchingGuides = hiringGuides(guides, row);
  const exercises = questions.filter(question => row.topics.includes(question.topic));
  const specificExercise = roleQuestions[row.id];
  const qualifications = row.requirements || [];
  const steps = matchingGuides.map(guide => {
    const list = guide.ordered === false ? "ul" : "ol";
    return '<section class="guide"><h3>' + html(guide.title) + '</h3><p class="meta">' + html(guide.scope) +
      '</p><' + list + ' class="hiring-steps">' + guide.stages.map(stage =>
        '<li><strong>' + html(stage.title) + '</strong><p>' + html(stage.description) + '</p></li>').join("") +
      '</' + list + '>' + (guide.note ? '<p class="meta">' + html(guide.note) + '</p>' : "") +
      '<p class="guide-source">' + link(guide, "查看官方流程说明") +
      ' <span class="meta">核验 ' + html(dateLabel(guide.checked_at)) + '</span></p></section>';
  }).join("");
  return crumbs([pageLink("companies", {region: row.region}, "公司与岗位"),
    pageLink("companies", org, row.organization), pageLink("companies", {...org, dept: department(row)}, department(row)),
    '<span aria-current="page">岗位详情</span>']) +
    '<header class="job-header"><div><div class="chips">' + jobState(row) + chip("证据 " + row.evidence) +
    '</div><h1>' + html(row.title) + '</h1><p>' + html([row.organization, department(row), row.location]
      .filter(Boolean).join(" / ")) + '</p></div>' +
    link(row, recruiting(row) ? "打开官方岗位与投递入口" : "查看原始岗位页", "button") + '</header>' +
    '<div class="job-layout"><div class="job-main"><section class="panel job-section"><h2>岗位职责与要求</h2>' +
    (row.summary ? '<p>' + html(row.summary) + '</p>' : '<p>岗位职责以官方职位描述为准。</p>') +
    (qualifications.length ? '<ul>' + qualifications.map(item => '<li>' + html(item) + '</li>').join("") + '</ul>' :
      '<p class="meta">具体资格要求请查看官方岗位页。</p>') +
    '<div class="chips">' + row.topics.map(topic => chip(topics[topic])).join("") + '</div></section>' +
    '<section class="panel job-section"><h2>官方申请与面试流程</h2>' +
    (steps || '<p>当前没有核验到适用于该岗位的公开面试流程。可从官方岗位页投递，并向招聘方确认是否有笔试、面试轮次和考察方式。</p>') +
    '</section><section class="panel job-section"><h2>面试准备</h2><p>根据公开岗位描述与技术方向设计的练习。</p>' +
    '<ul><li>对照职位要求，准备一段能说明你的贡献、实验结果和取舍的项目经历。</li>' +
    '<li>准备一份可展示的论文、代码或系统指标，并能解释局限和后续实验。</li></ul>' +
    (specificExercise ? '<div class="role-exercise"><h3>岗位场景练习</h3>' +
      '<details class="question"><summary>' + html(specificExercise.title) + '</summary><p>' +
      html(specificExercise.answer) + '</p></details></div>' : "") +
    (exercises.length ? '<div class="questions">' + exercises.map(question =>
      '<details class="question"><summary>' + html(question.title) + '</summary><p>' + html(question.answer) +
      '</p></details>').join("") + '</div>' : "") + '<p>' +
    pageLink("workspace", {topic: row.topics[0]}, "在面试题库中复习") + '</p></section></div>' +
    '<aside class="panel job-section job-meta"><h2>岗位来源</h2><dl><dt>地区</dt><dd>' + html(regions[row.region]) +
    '</dd><dt>发布时间</dt><dd>' + html(dateLabel(row.published_at)) + '</dd><dt>最近核验</dt><dd>' +
    html(timeLabel(row.last_seen)) + '</dd><dt>记录编号</dt><dd>' + html(row.id) + '</dd></dl>' +
    recordHistory(row) + '</aside></div>';
}

function renderCatalog(app, records, params) {
  app.innerHTML = intro("情报库", "搜索岗位、论文、开源项目、企业与产业报告。证据 A 来自雇主、维护者或发布机构，证据 B 为论文预印本。") +
    '<form class="filters" id="filters"><label class="search">关键词<input name="q" type="search" value="' +
    html(params.q || "") + '" placeholder="搜索标题、公司、地点或方向"></label>' +
    '<label>地区<select name="region">' + options(regions, params.region, "全部地区") + '</select></label>' +
    '<label>类型<select name="kind">' + options({...kinds, technical: "论文与项目"}, params.kind, "全部类型") + '</select></label>' +
    '<label>方向<select name="topic">' + options(topics, params.topic, "全部方向") + '</select></label>' +
    '<label>岗位状态<select name="status">' + options(
      {listed: states.listed, observed: states.observed, unlisted: states.unlisted,
        out_of_scope: states.out_of_scope}, params.status, "全部状态") + '</select></label>' +
    '<div class="filter-footer"><span id="result-count" role="status"></span><button type="button" class="button secondary" id="clear">清除筛选</button></div></form>' +
    '<section id="entries" class="entries" aria-label="情报搜索结果"></section>';
  const form = app.querySelector("#filters");
  const results = app.querySelector("#entries");
  const count = app.querySelector("#result-count");
  function refresh(syncUrl) {
    const filters = Object.fromEntries(new FormData(form));
    const matches = filterCatalog(records, filters);
    count.textContent = matches.length + " 条记录";
    results.innerHTML = matches.length ? matches.map(entry).join("") :
      '<p class="empty">没有匹配记录。请调整关键词或筛选条件。</p>';
    if (syncUrl) history.replaceState(null, "", catalogUrl(filters));
  }
  form.addEventListener("input", () => refresh(true));
  form.addEventListener("submit", event => event.preventDefault());
  app.querySelector("#clear").addEventListener("click", () => {
    for (const control of form.querySelectorAll("input,select")) control.value = "";
    refresh(true);
    form.elements.q.focus();
  });
  refresh(false);
}

function readWorkspace() {
  try {
    const value = JSON.parse(localStorage.getItem(storeKey) || "null");
    if (value && Array.isArray(value.items) && Array.isArray(value.doneQuestions)) return value;
  } catch {
    // A blocked browser store still permits a temporary workspace.
  }
  return {items: [], doneQuestions: []};
}

function renderWorkspace(app, starter, workspace, initialTopic = "") {
  let editId = null;
  let confirmDeleteId = null;
  let typeFilter = "";
  app.innerHTML = intro("个人工作台", "记录个人能力、科研与工程项目，跟踪学习计划与面试练习。数据保存在当前浏览器。") +
    '<p class="notice" role="status" id="storage-note" hidden></p>' +
    '<div class="columns"><section class="panel"><div class="heading"><h2>能力与项目</h2><button type="button" class="button secondary" id="load-templates">添加示例计划</button></div>' +
    '<form class="form-grid" id="work-form"><label>类别<select name="type">' + options(workTypes) + '</select></label>' +
    '<label>方向<select name="topic">' + options(topics) + '</select></label>' +
    '<label class="wide">标题<input name="title" maxlength="140" required></label>' +
    '<label>状态<select name="status">' + options(workStates) + '</select></label><label>目标日期<input type="date" name="due"></label>' +
    '<label class="wide">计划与成果<textarea name="notes" rows="3" maxlength="2000"></textarea></label>' +
    '<div class="action-row wide"><button class="button" id="save-item">添加记录</button><button type="button" class="button secondary" id="cancel-edit" hidden>取消编辑</button></div></form>' +
    '<div class="workspace-list"><label>按类别查看<select id="work-filter">' + options(workTypes, "", "全部类别") + '</select></label>' +
    '<div class="workspace-list" id="work-items"></div></div></section>' +
    '<section class="panel"><div class="heading"><h2>面试题库</h2><span id="practice-count" class="meta"></span></div>' +
    '<label>题目方向<select id="question-filter">' + options(topics, initialTopic, "全部方向") + '</select></label>' +
    '<div class="questions workspace-list" id="questions"></div></section></div>';

  const form = app.querySelector("#work-form");
  const list = app.querySelector("#work-items");
  const questionList = app.querySelector("#questions");
  const practiceCount = app.querySelector("#practice-count");
  const storageNote = app.querySelector("#storage-note");

  function persist() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(workspace));
      storageNote.hidden = true;
    } catch {
      storageNote.hidden = false;
      storageNote.textContent = "浏览器拒绝本地存储，本次修改仅在当前页面会话有效。";
    }
  }

  function reset() {
    form.reset();
    editId = null;
    app.querySelector("#save-item").textContent = "添加记录";
    app.querySelector("#cancel-edit").hidden = true;
  }

  function renderItems() {
    const items = workspace.items.filter(item => !typeFilter || item.type === typeFilter);
    list.innerHTML = items.length ? items.map(item =>
      '<article class="entry"><div class="chips">' + chip(workTypes[item.type]) + chip(topics[item.topic]) +
      chip(workStates[item.status], item.status === "done" ? "green" : "") + '</div><h3>' + html(item.title) +
      '</h3>' + (item.due ? '<p class="meta">目标日期 ' + html(item.due) + '</p>' : "") +
      (item.notes ? '<p class="summary">' + html(item.notes) + '</p>' : "") +
      '<div class="action-row">' + (confirmDeleteId === item.id ?
        '<span class="meta">删除这条记录？</span><button type="button" class="button danger" data-confirm-delete="' +
        html(item.id) + '">确认删除</button><button type="button" class="button secondary" data-cancel-delete>取消</button>' :
        '<button type="button" class="button secondary" data-edit="' + html(item.id) +
        '">编辑</button><button type="button" class="button danger" data-delete="' + html(item.id) + '">删除</button>') +
      '</div></article>'
    ).join("") : '<p class="meta">当前类别暂无记录。</p>';
    app.querySelector("#load-templates").disabled = workspace.items.some(item => item.template);
  }

  function renderQuestions() {
    const topic = app.querySelector("#question-filter").value;
    practiceCount.textContent = workspace.doneQuestions.length + " / " + starter.questions.length + " 已复习";
    questionList.innerHTML = starter.questions.filter(q => !topic || q.topic === topic).map(q =>
      '<details class="question"><summary>' + html(q.title) + '</summary><p>' + html(q.answer) +
      '</p><label><input type="checkbox" value="' + html(q.id) + '"' +
      (workspace.doneQuestions.includes(q.id) ? " checked" : "") + '> 标记已复习</label></details>'
    ).join("");
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    fields.title = fields.title.trim();
    if (!fields.title) {
      form.elements.title.focus();
      return;
    }
    if (editId) {
      const item = workspace.items.find(row => row.id === editId);
      Object.assign(item, fields);
    } else {
      workspace.items.unshift({...fields, id: crypto.randomUUID()});
    }
    if (typeFilter && typeFilter !== fields.type) {
      typeFilter = fields.type;
      app.querySelector("#work-filter").value = typeFilter;
    }
    reset();
    persist();
    renderItems();
    form.elements.title.focus();
  });

  list.addEventListener("click", event => {
    const {edit, delete: remove, confirmDelete, cancelDelete} = event.target.dataset;
    if (edit) {
      const item = workspace.items.find(row => row.id === edit);
      editId = edit;
      for (const key of ["type", "topic", "title", "status", "due", "notes"]) {
        form.elements[key].value = item[key] || "";
      }
      app.querySelector("#save-item").textContent = "保存修改";
      app.querySelector("#cancel-edit").hidden = false;
      form.elements.title.focus();
    }
    if (remove) {
      confirmDeleteId = remove;
      renderItems();
      list.querySelector("[data-cancel-delete]").focus();
    }
    if (cancelDelete !== undefined) {
      const cancelledId = confirmDeleteId;
      confirmDeleteId = null;
      renderItems();
      list.querySelector("[data-delete=" + CSS.escape(cancelledId) + "]").focus();
    }
    if (confirmDelete && confirmDeleteId === confirmDelete) {
      workspace.items = workspace.items.filter(row => row.id !== confirmDelete);
      if (editId === confirmDelete) reset();
      confirmDeleteId = null;
      persist();
      renderItems();
      app.querySelector("#work-filter").focus();
    }
  });
  app.querySelector("#cancel-edit").addEventListener("click", reset);
  app.querySelector("#load-templates").addEventListener("click", () => {
    workspace.items.push(...starter.templates.map(item => ({...item, id: crypto.randomUUID(), template: true})));
    persist();
    renderItems();
  });
  app.querySelector("#work-filter").addEventListener("change", event => {
    typeFilter = event.target.value;
    renderItems();
  });
  app.querySelector("#question-filter").addEventListener("change", renderQuestions);
  questionList.addEventListener("change", event => {
    const id = event.target.value;
    workspace.doneQuestions = workspace.doneQuestions.filter(value => value !== id);
    if (event.target.checked) workspace.doneQuestions.push(id);
    persist();
    practiceCount.textContent = workspace.doneQuestions.length + " / " + starter.questions.length + " 已复习";
  });
  renderItems();
  renderQuestions();
}

function renderReports(reports) {
  return intro("月度报告", "按 UTC 月统计首次收录和岗位状态变化。样本量随采集范围变化。") +
    (reports.length ? '<div class="report-list">' + reports.map(report =>
      '<article class="panel report"><h2>' + html(report.month) + (report.partial ? ' · 月内快照' : '') + '</h2><p class="meta">' +
      report.additions.length + ' 条首次收录 · ' + report.changes.length + ' 次岗位状态变化</p>' +
      '<div class="columns"><div><h3>地区分布</h3>' + plot(regions, report.by_region) +
      '</div><div><h3>类型分布</h3>' + plot(kinds, report.by_kind) + '</div></div>' +
      '<details><summary>方向分布</summary>' + plot(topics, report.by_topic) + '</details>' +
      '<details><summary>首次收录来源</summary><ul class="plain-list">' +
      report.additions.map(row => '<li>' + link(row) + ' · ' + html(kinds[row.kind]) + '</li>').join("") +
      '</ul></details><details><summary>岗位状态变化</summary><ul class="plain-list">' +
      report.changes.map(change => '<li>' + html(change.title) + ' · ' + html(timeLabel(change.at)) + ' · ' +
        html(states[change.old]) + ' → ' + html(states[change.new]) + '</li>').join("") +
      '</ul></details></article>').join("") + '</div>' :
      '<p class="empty">暂无月度报告。每月工作流会统计上月记录。</p>');
}

async function fetchJson(path) {
  const response = await fetch(path, {cache: "no-cache"});
  if (!response.ok) throw new Error(path + " HTTP " + response.status);
  return response.json();
}

async function start() {
  const app = document.querySelector("#app");
  try {
    const [catalog, starter, guides] = await Promise.all([
      fetchJson("./catalog.json"), fetchJson("./starter.json"), fetchJson("./hiring.json")
    ]);
    const workspace = readWorkspace();
    function render() {
      const {view, params} = route(location.hash);
      document.querySelectorAll(".nav a").forEach(a => {
        if (a.hash === "#" + view || (view === "job" && a.hash === "#companies")) {
          a.setAttribute("aria-current", "page");
        }
        else a.removeAttribute("aria-current");
      });
      if (view === "catalog") renderCatalog(app, catalog.records, params);
      else if (view === "companies") app.innerHTML = companyDirectory(catalog.records, params);
      else if (view === "job") {
        const job = catalog.records.find(row => row.kind === "job" && row.id === params.id);
        app.innerHTML = jobDetail(job, guides, starter.questions, starter.roleQuestions);
      }
      else if (view === "workspace") renderWorkspace(app, starter, workspace, params.topic);
      else if (view === "reports") app.innerHTML = renderReports(catalog.reports);
      else app.innerHTML = overview(catalog);
      app.setAttribute("aria-busy", "false");
    }
    render();
    window.addEventListener("hashchange", () => {
      render();
      document.querySelector("main").focus();
      window.scrollTo(0, 0);
    });
    document.querySelector(".skip").addEventListener("click", event => {
      event.preventDefault();
      document.querySelector("main").focus();
    });
  } catch (error) {
    app.setAttribute("aria-busy", "false");
    app.innerHTML = '<p class="notice" role="alert">读取数据失败。请检查站点构建与连接后重新加载。</p>';
    console.error(error);
  }
}

if (typeof document !== "undefined") start();
if (typeof module !== "undefined") {
  module.exports = {filterCatalog, catalogUrl, route, overview, entry, renderReports,
    companyDirectory, hiringGuides, jobDetail};
}
