"""Template/formula headline engine (no LLM). handle({topic, audience, platform, style}) -> {titles:[{t,why}]}"""
import random, re
N = ["3","5","7","10"]; D = ["7 天","30 天","1 个月","3 个月"]
F = {
 "好奇": [("为什么{a}都在偷偷用{k}？","悬念提问"),("关于{k}，没人告诉你的 {n} 件事","信息差"),("{k}的真相，我花了{d}才搞懂","个人经历+悬念"),
         ("我终于知道{k}为什么总做不好了","痛点共鸣"),("别再瞎折腾{k}了，先看完这篇","制止式开头"),("{k}还能这么玩？看完我沉默了","意外感"),
         ("一个被严重低估的{k}方法","低估效应"),("{k}到底值不值？说点大实话","真诚感")],
 "干货": [("{k}保姆级教程：从 0 到 1 一次讲透","完整承诺"),("{k}全攻略｜建议收藏","收藏驱动"),("新手做{k}，按这个清单走就够了","降低门槛"),
         ("{n} 步搞定{k}，{a}也能直接上手","步骤清晰"),("{k}避坑指南：这 {n} 个错误我全踩过","避坑价值"),("一张图看懂{k}","极简承诺"),
         ("{k}实操模板，拿走直接用","即用价值"),("把{k}讲明白，只需要这 {n} 个框架","结构化")],
 "数字": [("{n} 个{k}技巧，第 {m} 个最实用","数字+悬念"),("{d}，我用{k}实现了{x}","时间+结果"),("{k}：{n} 个工具，{m} 个免费","具体数字"),
         ("90% 的{a}都不知道的 {n} 个{k}细节","比例冲击"),("花 3 分钟，学会{k}的 {n} 个核心","时间成本低"),("{k}效率提升 10 倍的 {n} 个习惯","量化收益"),
         ("从 0 到 1 万：我的{k}复盘","里程碑数字"),("{n} 条{k}经验，每条都是真金白银换的","稀缺感")],
 "反差": [("越努力做{k}，越失败？问题出在这","反常识"),("我放弃了所有{k}技巧，结果反而{x}","反转结局"),("{k}不难，难的是没人教你这一步","颠覆认知"),
         ("别学{k}了，先学这个","否定式钩子"),("同样做{k}，为什么别人轻松你很累？","对比冲突"),("{k}最大的误区，就是太认真","反直觉"),
         ("看似简单的{k}，99% 的人都做错了","高门槛暗示"),("不花一分钱，我把{k}做成了{x}","低投入高产出")],
 "情绪": [("做{k}的第{d}，我差点放弃","情绪共鸣"),("如果你也在为{k}焦虑，请看完这篇","被理解感"),("{k}这件事，我真的后悔没早点知道","后悔情绪"),
         ("致每一个在{k}路上死磕的{a}","身份认同"),("{k}救了我，真的","强烈情感"),("太爽了！{k}终于被我搞定了","爽感释放"),
         ("{a}们，{k}这一关一定要过","鼓舞号召"),("看完这条，你对{k}的焦虑会少一半","安抚承诺")],
}
F["混合"] = [x for v in F.values() for x in v]
XR = ["效率翻倍","涨粉 1 万","每天多出 2 小时","收入翻倍","彻底躺平","零失误"]
PLAT = {"小红书": lambda t: random.choice(["✨","🔥","💡","📌","‼️"]) + t.replace("：","｜") + random.choice(["","🔥","✅","💯"]),
        "公众号": lambda t: t, "抖音": lambda t: re.sub(r"，看完.*$|，先看完这篇$","",t),
        "X": lambda t: t}
def short(topic):
    t = re.split(r"[，。,.!！?？\n；;]", topic.strip())[0].strip()
    return t[:14] if t else "这件事"
def handle(p):
    k = short(str(p.get("topic",""))[:300]); a = (str(p.get("audience","")).strip()[:8] or "普通人")
    plat = p.get("platform","X"); style = p.get("style","混合")
    pool = list(F.get(style, F["混合"])); random.shuffle(pool)
    if style != "混合":
        extra = [x for x in F["混合"] if x not in pool]; random.shuffle(extra); pool += extra[:4]
    out, seen = [], set()
    for tpl, why in pool:
        n = random.choice(N); m = str(random.randint(1, int(n)))
        t = tpl.format(k=k, a=a, n=n, m=m, d=random.choice(D), x=random.choice(XR)).replace("第30 天","第 30 天")
        t = t.replace("用用", "用").replace("做做", "做")
        t = PLAT.get(plat, PLAT["X"])(t)
        if t not in seen: seen.add(t); out.append({"t": t, "why": why, "len": len(t)})
        if len(out) == 10: break
    return {"titles": out, "keyword": k}
