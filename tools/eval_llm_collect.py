#!/usr/bin/env python3
"""평가 문장을 실제 모델에 보내 응답을 tools/llm_outputs.json 에 모은다(키는 .env 에서만 읽음, 파일에 남지 않음).
무료 모델은 분당 20회, 크레딧 10 미만이면 하루 50회라서 한 번에 N개만 보낸다.
실행: python3 tools/eval_llm_collect.py <세트: paraphrase|fresh|dev|test> [최대 문장 수=20]
이미 모은 문장은 건너뛰므로 다음 날 이어서 실행해도 된다. 그 뒤 jsc tools/eval_text.js 로 비교한다."""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dev_server as ds

ds.load_env()
if not os.environ.get("OPENROUTER_API_KEY"):
    sys.exit(".env 에 OPENROUTER_API_KEY 가 없습니다.")
setname = sys.argv[1] if len(sys.argv) > 1 else "paraphrase"
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
data = json.load(open(os.path.join(HERE, "text_eval.json"), encoding="utf-8"))
catalog = json.load(open(os.path.join(HERE, "intent_catalog.json"), encoding="utf-8"))
path = os.path.join(HERE, "llm_outputs.json")
store = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {"outputs": {}}
model = os.environ.get("OPENROUTER_MODEL", ds.DEFAULT_MODEL)
if store.get("__model") not in (None, model):
    sys.exit("저장된 응답은 다른 모델(%s)로 모은 것입니다. 파일을 지우고 다시 시작하세요." % store.get("__model"))
store["__model"] = model
done = 0
for g in data[setname]:
    if g["t"] in store["outputs"]: continue
    if done >= limit: break
    try:
        store["outputs"][g["t"]] = ds.call_model(g["t"], catalog)
    except Exception as e:
        print("실패(%s): %s" % (type(e).__name__, g["t"])); 
        if "429" in str(e): break
        continue
    done += 1
    json.dump(store, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("%d/%d %s" % (done, limit, g["t"]))
    time.sleep(3.5)   # 분당 20회 한도 아래로
print("저장된 문장 %d개 (모델 %s)" % (len(store["outputs"]), model))
