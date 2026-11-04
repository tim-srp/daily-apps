"""投放参谋 AdPilot — server side. stream(payload, emit) → SSE via server.py /d02/stream.
Real mode: ZooWork Managed Agents (key server-side only). Demo mode: realistic canned outputs, labelled demo."""
import os, sys, json, time, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zoowork, demo

# Reference character limits (平台规范会变，以后台为准). unit: "char" = 1/汉字; "w" = 半角宽度(汉字=2)
LIMITS = {
 "抖音": [("视频标题", 55, "char"), ("口播字幕/贴纸", 15, "char")],
 "小红书": [("笔记标题", 20, "char"), ("正文", 1000, "char")],
 "微信朋友圈": [("外层文案", 40, "char"), ("行动按钮", 4, "char")],
 "千川": [("创意标题", 30, "char"), ("直播间/商品卖点", 12, "char")],
 "巨量": [("创意标题", 30, "char"), ("来源/品牌名", 10, "char")],
 "Meta": [("Primary text", 125, "char"), ("Headline", 40, "char")],
 "Google": [("Headline", 30, "w"), ("Description", 90, "w")],
}

def status(): return {"mode": "real" if zoowork.enabled() else "demo", "limits": LIMITS}
def handle(p):
    if p.get("op") == "status": return status()
    return {"error": "unknown op"}

SCHEMAS = {
"creative": '''{"insights":["3-5 条受众/市场洞察"],"angles":[{"name":"角度名","insight":"依据","hook":"前3秒钩子","headline":"主标题","why":"为何能打"}],
"scripts":[{"angle":"对应角度名","title":"脚本名","duration":"15s","shots":[{"t":"0-3s","visual":"画面","voice":"口播/字幕","note":"拍摄提示"}]}],
"copies":[{"channel":"渠道","field":"字段名(用给定字段)","text":"文案"}],"risks":["广告法/平台审核风险提示"]}''',
"matrix": '''{"hypotheses":["可证伪的假设"],"variables":[{"name":"变量(如 钩子/卖点/画面/CTA)","variants":["A 变体","B 变体"]}],
"metrics":{"primary":"主指标","secondary":["次指标"],"guardrail":["护栏指标"]},"design":"实验设计说明(分层/顺序/停止规则)","notes":["执行注意事项"]}''',
"report": '''{"summary":"一段话总结(含关键数字)","findings":[{"title":"发现","detail":"依据数据","severity":"high|mid|low"}],
"suggestions":[{"action":"具体动作","reason":"原因","impact":"预期影响","priority":"P0|P1|P2"}],"plan":[{"day":"周一","task":"任务","owner":"投手/设计/运营"}],"risks":["风险"]}''',
}

def build_prompt(task, p):
    head = ("你是资深中国效果广告投放参谋（熟悉抖音/巨量/千川/小红书/腾讯广告/Meta/Google）。"
            "严格遵守《广告法》（不用最高级/绝对化用语、不做功效承诺）。只输出一个 JSON 对象，不要 markdown 代码块、不要额外解释。\n")
    if task == "creative":
        lim = {c: LIMITS.get(c, []) for c in p.get("channels", [])}
        return head + f"""任务：输出创意方案。输入：{json.dumps(p, ensure_ascii=False)}
各渠道字段与字数上限（"w" 表示半角宽度，汉字算2）：{json.dumps(lim, ensure_ascii=False)}
要求：4 个差异化创意角度；每个角度 1 条 15s 分镜脚本（4-6 镜）；每个渠道每个字段至少 2 条文案且不得超过上限。
JSON 结构：{SCHEMAS['creative']}"""
    if task == "matrix":
        return head + f"""任务：基于选定创意角度设计 A/B 实验矩阵（样本量与预算已由前端按统计公式算好，你负责变量设计与解释）。输入：{json.dumps(p, ensure_ascii=False)}
要求：2-4 个变量、每变量 2-3 个变体，一次只测一个主变量为主。JSON 结构：{SCHEMAS['matrix']}"""
    return head + f"""任务：解读广告投放报表（指标已在本地精确计算，勿重算或编造数字，只引用给定数据）。输入：{json.dumps(p, ensure_ascii=False)[:60000]}
要求：指出异常原因假设、给出可执行的优化建议、下周 5 天计划。JSON 结构：{SCHEMAS['report']}"""

def parse_json(t):
    t = re.sub(r"^```(json)?|```$", "", t.strip(), flags=re.M).strip()
    i, j = t.find("{"), t.rfind("}")
    return json.loads(t[i:j + 1])

def stream(payload, emit):
    task = payload.get("task")
    if task not in SCHEMAS: return emit("error", {"message": "未知任务"})
    inp = payload.get("input") or {}
    if not zoowork.enabled() or payload.get("forceDemo"):
        emit("mode", {"mode": "demo"})
        for s in demo.STEPS[task]:
            emit("step", {"text": s}); time.sleep(0.45)
        return emit("result", {"data": demo.build(task, inp), "demo": True})
    emit("mode", {"mode": "real"})
    emit("step", {"text": "连接 ZooWork Managed Agent…"})
    last = [0.0]; seen = set()
    MILES = {"creative": [('"insights"', "提炼受众洞察"), ('"angles"', "构思创意角度"), ('"scripts"', "撰写分镜脚本"), ('"copies"', "生成分渠道文案"), ('"risks"', "合规自检")],
             "matrix": [('"hypotheses"', "提出实验假设"), ('"variables"', "拆解变量与变体"), ('"metrics"', "设定成功/护栏指标"), ('"design"', "编写实验设计")],
             "report": [('"summary"', "总结核心表现"), ('"findings"', "定位关键发现"), ('"suggestions"', "生成优化建议"), ('"plan"', "排期下周计划")]}[task]
    def on(ev, d):
        if ev == "session": emit("step", {"text": f"会话已创建 {d['session_id'][:8]}…，Agent 开始工作"})
        elif ev == "delta":
            for k, label in MILES:
                if k not in seen and k in d["text"]: seen.add(k); emit("step", {"text": label})
            if time.time() - last[0] > 0.25: last[0] = time.time(); emit("delta", {"chars": len(d["text"]), "tail": d["text"][-120:]})
        else: emit(ev, d)
    try:
        text = zoowork.run(build_prompt(task, inp), on)
        emit("step", {"text": "解析结构化结果…"})
        emit("result", {"data": parse_json(text), "demo": False})
    except Exception as e:
        emit("step", {"text": f"真实 Agent 调用失败（{str(e)[:120]}），已回退演示数据"})
        emit("result", {"data": demo.build(task, inp), "demo": True, "fallback": True})
