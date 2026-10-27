#!/usr/bin/env python3
"""dev_server.py 점검: 키를 보호하는지, 모델 응답 처리와 실패 처리가 맞는지. 실제 네트워크는 쓰지 않는다. 실행: python3 tools/test_server.py"""
import io, json, os, sys, threading, urllib.request, urllib.error, socketserver
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dev_server as ds

fails = 0
def check(name, cond):
    global fails
    print(("PASS " if cond else "FAIL ") + name)
    if not cond: fails += 1

real = urllib.request.urlopen

class FakeResp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False

def fake_urlopen(content):
    def f(req, timeout=0):
        if isinstance(req, str) or "openrouter" not in req.full_url:   # 시험용 클라이언트의 요청은 진짜로 보낸다
            return real(req, timeout=timeout) if timeout else real(req)
        f.last = json.loads(req.data); f.auth = req.headers.get("Authorization")
        return FakeResp(json.dumps({"choices": [{"message": {"content": content}}]}).encode())
    return f

cat = [{"id": "light", "kind": "need", "meaning": "조명이 필요해요"}]
os.environ["OPENROUTER_API_KEY"] = "TESTKEY-NOT-REAL"
ok = fake_urlopen('설명입니다 {"clauses":[{"phrase":"어두워요","intents":["light"],"negated":false}]} 끝')
ds.urllib.request.urlopen = ok
r = ds.call_model("방이 어두워요", cat)
check("모델 응답 앞뒤의 설명 글이 있어도 JSON만 읽음", r[0]["intents"] == ["light"])
check("요청에 키·JSON 모드·온도 0·카탈로그가 들어감", ok.auth == "Bearer TESTKEY-NOT-REAL" and ok.last["response_format"] == {"type": "json_object"} and ok.last["temperature"] == 0 and "light (need)" in ok.last["messages"][0]["content"])
ds.urllib.request.urlopen = fake_urlopen("JSON이 아님")
try: ds.call_model("x", cat); bad = False
except Exception: bad = True
check("JSON이 아닌 응답은 예외(서버가 502로 바꿈)", bad)

ds.urllib.request.urlopen = ok
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), ds.Handler); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
def get(path):
    try: return urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path)).status
    except urllib.error.HTTPError as e: return e.code
def post(body):
    req = urllib.request.Request("http://127.0.0.1:%d/api/interpret" % port, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req); return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
check("화면 파일은 내줌", get("/index.html") == 200)
check(".env, .env.example, .git, data/raw 는 내주지 않음", all(get(p) == 404 for p in ["/.env", "/.env.example", "/.git/config", "/data/raw/x"]))
check("/api/status 는 키 값을 알리지 않음", b"TESTKEY" not in urllib.request.urlopen("http://127.0.0.1:%d/api/status" % port).read())
code, body = post({"text": "방이 어두워요", "catalog": cat})
check("정상 요청은 clauses 를 돌려줌", code == 200 and json.loads(body)["clauses"][0]["intents"] == ["light"])
check("빈 글은 400", post({"text": "  ", "catalog": cat})[0] == 400)
ds.urllib.request.urlopen = fake_urlopen("깨진 응답")
code, body = post({"text": "방이 어두워요", "catalog": cat})
check("모델 실패는 502 이고 응답에 키가 섞이지 않음", code == 502 and "TESTKEY" not in body)
del os.environ["OPENROUTER_API_KEY"]
check("키가 없으면 503, status 는 llm:false", post({"text": "a", "catalog": cat})[0] == 503 and json.load(urllib.request.urlopen("http://127.0.0.1:%d/api/status" % port))["llm"] is False)
srv.shutdown(); ds.urllib.request.urlopen = real
print("\nALL PASSED" if not fails else "\n%d FAILED" % fails); sys.exit(1 if fails else 0)
