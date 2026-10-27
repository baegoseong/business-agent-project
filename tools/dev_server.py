#!/usr/bin/env python3
"""로컬 개발 서버: 정적 파일을 내주고, /api/interpret 요청만 OpenRouter로 대신 보낸다.

API 키는 환경변수 또는 .env 파일(git 제외)에서 서버만 읽고 브라우저로는 나가지 않는다.
.env 와 점(.)으로 시작하는 파일, data/raw 는 내주지 않는다. 키가 없으면 /api/status 가 llm:false 를 알려
화면은 규칙 방식으로만 동작한다.

실행: python3 tools/dev_server.py [포트=8765]
.env 예:  OPENROUTER_API_KEY=...   (선택) OPENROUTER_MODEL=google/gemma-4-31b-it:free
"""
import http.server
import json
import os
import socketserver
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "google/gemma-4-31b-it:free"
MAX_TEXT = 400


def load_env():
    path = os.path.join(ROOT, ".env")
    if os.path.isfile(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def build_messages(text, catalog):
    lines = "\n".join("- %s (%s): %s" % (c["id"], c["kind"], c["meaning"]) for c in catalog)
    system = (
        "너는 자취방 꾸미기 서비스의 문장 해석기다. 사용자가 쓴 글을 문장(절) 단위로 나누고, 각 절이 아래 목록의 어떤 항목에 해당하는지 고른다.\n"
        "목록에 있는 id만 쓴다. 해당하는 항목이 없으면 intents를 빈 배열로 둔다. 한 절이 여러 항목에 해당할 수 있다.\n"
        "need 항목이 '필요 없다/충분하다/괜찮다'는 뜻으로 부정되면 negated를 true로 한다.\n"
        "'방이 어두워서 불편하다'는 불편함(조명 필요)이고 '어두운 분위기를 원한다'는 취향이다. 둘을 구별한다.\n"
        "단어가 달라도 뜻이 통하면 고른다(예: 해가 지면 안 보인다 → 조명). 글에 근거가 없는 항목은 고르지 않는다.\n"
        "반드시 JSON 객체 하나만 출력한다: {\"clauses\":[{\"phrase\":\"원문 일부\",\"intents\":[\"id\"],\"negated\":false}]}\n\n"
        "항목 목록:\n" + lines
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": text}]


def call_model(text, catalog):
    key = os.environ.get("OPENROUTER_API_KEY", "")
    body = json.dumps({
        "model": os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL),
        "messages": build_messages(text, catalog),
        "temperature": 0,
        "max_tokens": 3000,   # 생각하는 모델은 답을 쓰기 전에 토큰을 쓴다. 600이면 생각만 하다 끊겨 content가 비었다
        "reasoning": {"effort": "low"},
        "response_format": {"type": "json_object"},
    }).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json",
        "X-Title": "room-decor-agent"})
    with urllib.request.urlopen(req, timeout=40) as r:
        data = json.load(r)
    choice = data["choices"][0]
    content = choice["message"].get("content") or ""
    if not content.strip():
        raise ValueError("모델이 빈 답을 줌(finish_reason=%s)" % choice.get("finish_reason"))
    a, b = content.find("{"), content.rfind("}")   # 앞뒤에 설명이 붙어도 JSON 부분만 쓴다
    return json.loads(content[a:b + 1])["clauses"]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _blocked(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]
        return any(p.startswith(".") for p in parts) or parts[:2] == ["data", "raw"]

    def do_GET(self):
        if self.path.split("?")[0] == "/api/status":
            return self._json(200, {"llm": bool(os.environ.get("OPENROUTER_API_KEY")),
                                    "model": os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL)})
        if self._blocked():
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if self._blocked():
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        if self.path != "/api/interpret":
            return self.send_error(404)
        if not os.environ.get("OPENROUTER_API_KEY"):
            return self._json(503, {"error": "no key"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(min(n, 20000)))
            text = str(req.get("text", ""))[:MAX_TEXT]
            catalog = [{"id": str(c["id"])[:40], "kind": str(c["kind"])[:20], "meaning": str(c["meaning"])[:60]}
                       for c in req.get("catalog", [])[:80]]
            if not text.strip() or not catalog:
                return self._json(400, {"error": "empty"})
            return self._json(200, {"clauses": call_model(text, catalog)})
        except urllib.error.HTTPError as e:
            # OpenRouter가 돌려준 이유(한도 초과인지 등)를 터미널과 응답에 남긴다. 키는 들어 있지 않다.
            try:
                err = json.load(e).get("error", {}); meta = err.get("metadata") or {}
                detail = ("%s %s %s" % (err.get("message", ""), meta.get("provider_name", ""), str(meta.get("raw", ""))[:200])).strip()[:300]
            except Exception: detail = ""
            print("OpenRouter %d: %s" % (e.code, detail), file=sys.stderr, flush=True)
            return self._json(502, {"error": "upstream %d" % e.code, "detail": detail})
        except Exception as e:   # 키 값이 응답에 섞이지 않도록 응답에는 종류만 담고, 자세한 내용은 터미널에만 남긴다
            print("해석 실패 %s: %s" % (type(e).__name__, str(e)[:200]), file=sys.stderr, flush=True)
            return self._json(502, {"error": type(e).__name__})

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    load_env()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), Handler) as srv:
        print("http://localhost:%d/index.html  (LLM %s)" % (port, "켜짐" if os.environ.get("OPENROUTER_API_KEY") else "꺼짐: .env 에 OPENROUTER_API_KEY 없음"))
        srv.serve_forever()
