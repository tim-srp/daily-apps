"""演示模式：结构与真实 Agent 相同的示例输出（会在界面上标注为演示数据）。"""
STEPS = {
 "creative": ["解析品牌与受众输入", "检索品类常见痛点与竞品话术（演示）", "提炼 4 个差异化创意角度", "撰写 15s 分镜脚本", "按渠道字数上限生成文案变体", "广告法合规自检"],
 "matrix": ["读取已选创意角度", "拆解可测变量", "设计变体与对照组", "校验样本量与预算可行性", "生成执行说明"],
 "report": ["读取本地计算的指标", "对比近 7 天与前 7 天", "定位异常日与异常计划", "归因假设", "生成优化建议与下周计划"],
}

def _cut(s, n): return s if len(s) <= n else s[:n]

def creative(p):
    b = p.get("brand") or "轻研所"; prod = p.get("product") or "氨基酸洁面慕斯"
    aud = p.get("audience") or "22-30岁一二线通勤女性"; goal = p.get("goal") or "转化"
    chans = p.get("channels") or ["抖音", "小红书"]
    angles = [
     {"name": "痛点放大", "insight": f"{aud}普遍在意“洗完紧绷、泛红”，但很少主动关注成分", "hook": "洗完脸三分钟就发紧？问题可能出在洁面", "headline": f"换掉让你紧绷的洁面，{prod}温和洗净", "why": "直击可感知体验，前3秒留存高"},
     {"name": "成分党背书", "insight": "小红书成分科普笔记互动率显著高于纯种草", "hook": "翻过 30 款洁面配料表后，我只留下这一种", "headline": f"{b}{prod}：看得懂的配料表", "why": "建立信任，适合高客单与复购"},
     {"name": "场景对比", "insight": "通勤早晨时间紧，追求“一步到位”", "hook": "早上 7:40，30 秒完成洁面", "headline": "绵密泡沫按一下就出，赶早八也来得及", "why": "画面感强，适合信息流快节奏"},
     {"name": "真实测评", "insight": "用户对达人口播信任度高于品牌自说自话", "hook": "用了 21 天，我把真实变化拍下来了", "headline": f"21 天真实记录：{prod}使用体验", "why": "UGC 质感，适合千川直播间引流"},
    ]
    scripts = [{"angle": a["name"], "title": f"{a['name']}·15s", "duration": "15s", "shots": [
        {"t": "0-3s", "visual": "特写：人物皱眉摸脸/对镜", "voice": a["hook"], "note": "大字幕，首帧即出现产品色"},
        {"t": "3-7s", "visual": f"{prod}按压出泡，泡沫细节微距", "voice": "绵密泡沫，轻轻打圈就够", "note": "慢动作 0.5x"},
        {"t": "7-11s", "visual": "冲洗后上手触感、肤感特写", "voice": "洗完是润润的，不拔干", "note": "避免“治疗/修复”等功效词"},
        {"t": "11-15s", "visual": "产品+价格利益点+购物车引导", "voice": "现在下单享首单福利，点击左下角", "note": "CTA 贴纸停留≥2s"}]} for a in angles]
    from api import LIMITS
    copies = []
    for c in chans:
        for field, lim, unit in LIMITS.get(c, []):
            n = lim if unit == "char" else lim // 2
            for a in angles[:2]:
                base = {"视频标题": a["hook"] + f" #{prod}", "口播字幕/贴纸": "洗完不紧绷", "笔记标题": a["hook"],
                        "正文": f"{a['insight']}。\n我的使用感受：{a['headline']}。泡沫细腻、冲洗快，适合早晚日常使用。\n#洁面 #{b}",
                        "外层文案": a["headline"], "行动按钮": "立即购买", "创意标题": a["headline"], "直播间/商品卖点": "温和洗净不紧绷",
                        "来源/品牌名": b, "Primary text": f"{a['hook']} {prod} by {b}.", "Headline": a["headline"], "Description": f"{a['insight']}。点击了解。"}.get(field, a["headline"])
                copies.append({"channel": c, "field": field, "text": _cut(base, n)})
    return {"insights": [f"{aud}的决策链路短，信息流前3秒决定是否停留", "品类竞争集中在“温和”，差异化需落到可感知体验与证据", f"目标为“{goal}”，建议角度与落地页利益点保持一致", "达人/UGC 质感素材在千川、小红书的 CTR 通常优于品牌片"],
            "angles": angles, "scripts": scripts, "copies": copies,
            "risks": ["避免“最温和”“100%不过敏”等绝对化用语", "化妆品不得宣称医疗作用（如“治疗痘痘”）", "使用前后对比画面需真实可追溯"]}

def matrix(p):
    angles = p.get("angles") or ["痛点放大", "成分党背书"]
    return {"hypotheses": [f"“{angles[0]}”钩子比“{angles[-1]}”钩子 3 秒完播率更高", "首帧出现产品能提升 CTR 且不降低 CVR", "明确价格利益点的 CTA 提升转化率"],
            "variables": [{"name": "开头钩子", "variants": [f"A：{a}" for a in angles[:3]]},
                          {"name": "首帧画面", "variants": ["A：人物痛点特写", "B：产品微距"]},
                          {"name": "CTA", "variants": ["A：首单福利", "B：限时赠品"]}],
            "metrics": {"primary": p.get("metric") or "CTR", "secondary": ["3s 完播率", "CVR", "CPA"], "guardrail": ["CPM 不高于基线 20%", "退款率", "负反馈率"]},
            "design": "先跑“开头钩子”单变量（其余保持一致），各变体同计划同定向均分预算；达到样本量或 7 天后判定，未显著则延长或合并结论。第二轮在胜出钩子上测首帧，再测 CTA。",
            "notes": ["每个变体至少 2 条素材，避免单条素材偶然性", "不要在测试期调整出价与定向", "节假日/大促期间数据单独标记"]}

def report(p):
    t = p.get("totals") or {}; w = p.get("wow") or {}; camps = p.get("byCampaign") or []; an = p.get("anomalies") or []
    f = lambda k, d=2: round(t.get(k) or 0, d)
    worst = sorted([c for c in camps if c.get("conv")], key=lambda c: -(c.get("cpa") or 0))[:1]
    best = sorted(camps, key=lambda c: -(c.get("roas") or 0))[:1]
    findings = [{"title": "整体效率", "detail": f"总消耗 ¥{f('spend',0)}，ROAS {f('roas')}，CPA ¥{f('cpa')}，CTR {f('ctr',2)}%", "severity": "mid"}]
    if w: findings.append({"title": "环比变化", "detail": "近7天 vs 前7天：" + "，".join(f"{k} {v:+.1f}%" for k, v in list(w.items())[:5]), "severity": "high" if abs(w.get("CPA", 0)) > 15 else "mid"})
    if worst: findings.append({"title": "高成本计划", "detail": f"「{worst[0]['name']}」CPA ¥{worst[0]['cpa']:.2f}，为全账户最高", "severity": "high"})
    if best: findings.append({"title": "高效计划", "detail": f"「{best[0]['name']}」ROAS {best[0]['roas']:.2f}，可承接放量", "severity": "low"})
    for a in an[:3]: findings.append({"title": f"异常：{a.get('date')}", "detail": a.get("desc", ""), "severity": "high"})
    return {"summary": f"本周期总消耗 ¥{f('spend',0)}，带来 {int(t.get('conv') or 0)} 次转化、ROAS {f('roas')}。" + (f"检测到 {len(an)} 个异常点，" if an else "") + "建议预算向高 ROAS 计划倾斜，并对高 CPA 计划更换素材。",
            "findings": findings,
            "suggestions": [{"action": f"将「{best[0]['name'] if best else '高效计划'}」日预算上调 20%（分 2 次，每次间隔≥24h）", "reason": "ROAS 高于账户均值且量级未饱和", "impact": "预计转化 +10~15%", "priority": "P0"},
                            {"action": f"「{worst[0]['name'] if worst else '高成本计划'}」暂停 CTR 低于均值 50% 的素材并补充 3 条新钩子", "reason": "素材疲劳导致 CPM 上升、CTR 下滑", "impact": "CPA 预计回落 10%+", "priority": "P0"},
                            {"action": "异常日排查：核对出价修改记录、落地页可用性与库存", "reason": "单日指标突变多为人为操作或外部因素", "impact": "避免重复损失", "priority": "P1"},
                            {"action": "建立 A/B 实验：钩子单变量测试", "reason": "当前素材同质化", "impact": "沉淀可复用的创意规律", "priority": "P2"}],
            "plan": [{"day": "周一", "task": "执行预算调整与素材下线", "owner": "投手"}, {"day": "周二", "task": "上新 3 条钩子素材（创意方案模块产出）", "owner": "设计"},
                     {"day": "周三", "task": "复盘新素材 24h 数据，排查异常日原因", "owner": "投手"}, {"day": "周四", "task": "落地页首屏利益点 A/B", "owner": "运营"},
                     {"day": "周五", "task": "周报 + 下周预算分配", "owner": "投手"}],
            "risks": ["放量期 CPA 波动属正常，48h 内勿频繁调价", "样本量不足的计划结论仅供参考"]}

def build(task, p): return {"creative": creative, "matrix": matrix, "report": report}[task](p)
