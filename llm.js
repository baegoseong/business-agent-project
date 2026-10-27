// 선택 기능: 로컬 서버(tools/dev_server.py)가 있고 .env 에 키가 있을 때만 글 해석에 LLM을 쓴다.
// 키는 서버만 알고 이 파일은 /api/interpret 만 부른다. 서버가 없거나 실패하면 규칙 방식으로 돌아간다.
var LLM = (function () {
  var available = false, model = "", cache = {}, failed = {}, inflight = {};

  function init() {
    return fetch("/api/status").then(function (r) { return r.ok ? r.json() : { llm: false }; })
      .then(function (s) { available = !!s.llm; model = s.model || ""; })
      .catch(function () { available = false; });
  }

  function key(text) { return String(text || "").trim(); }

  // 성공하면 clauses, 실패하면 null 로 풀리는 약속
  function interpret(text, catalog) {
    var k = key(text);
    if (!available || !k) return Promise.resolve(null);
    if (cache[k]) return Promise.resolve(cache[k]);
    if (failed[k]) return Promise.resolve(null);
    if (inflight[k]) return inflight[k];
    inflight[k] = fetch("/api/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: k, catalog: catalog }) })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (d) { cache[k] = d.clauses; delete inflight[k]; return d.clauses; })
      .catch(function () { failed[k] = true; delete inflight[k]; return null; });
    return inflight[k];
  }

  return {
    init: init, interpret: interpret,
    isAvailable: function () { return available; }, model: function () { return model; },
    cached: function (t) { return cache[key(t)] || null; },
    failed: function (t) { return !!failed[key(t)]; },
    settled: function (t) { return !!(cache[key(t)] || failed[key(t)]); }
  };
})();
