# =============================================================================
# 故事板 demo:《屏幕另一端的你》(告白夜)
# 原故事板:e:\RenPy\storyboard_baiying_ch1.md (8 镜头)
#
# 素材现状(2026-04-19):
#   * images/OIP.webp  —— 白樱立绘(唯一资源)
#   * 无 bg_sakura_night 背景图 → 用 Solid 深蓝夜色占位
#   * 无 sakura_petal.png      → 用粉色 8x8 方块占位
#   * 无 BGM / SFX              → 相关行保留但注释,接入后去掉 # 即可
# =============================================================================


###############################################################################
# 1. 图像与粒子
###############################################################################

image bg_night = Solid("#1a2540")
image bg_black = Solid("#000000")
image baiying  = "images/OIP.webp"

image sakura_petal = Transform(Solid("#ffc0cb"), size=(8, 8))
image sakura = SnowBlossom(
    "sakura_petal",
    count=14,
    border=20,
    xspeed=(-25, 25),
    yspeed=(40, 80),
    fast=False,
    horizontal=False,
)


###############################################################################
# 2. 角色
###############################################################################

define b = Character("白樱", color="#ffc0cb")
define v = Character(None, what_color="#a0a0ff", what_italic=True)


###############################################################################
# 3. 立绘 Transform —— 用 zoom/yoffset 模拟"抬头 / 贴近 / 抵屏"
###############################################################################

transform baiying_stand:
    xalign 0.5 yalign 1.0
    zoom 0.9
    alpha 0.0
    ease 1.2 alpha 1.0
    # 呼吸循环:不让立绘死板
    block:
        linear 2.5 yoffset 3
        linear 2.5 yoffset 0
        repeat

transform baiying_lookup:
    xalign 0.5 yalign 1.0
    ease 0.8 zoom 1.0 yoffset -10

transform baiying_front:
    xalign 0.5 yalign 1.0
    ease 0.8 zoom 1.15 yoffset -20

transform baiying_finger:
    xalign 0.5 yalign 1.0
    ease 0.6 zoom 1.25 yoffset -30

transform baiying_forehead:
    xalign 0.5 yalign 1.0
    ease 0.8 zoom 1.4 yoffset -60


###############################################################################
# 4. 画面整体 Transform —— 心跳脉动 / Ken Burns
###############################################################################

transform heart_pulse:
    ease 0.4 zoom 1.02
    ease 0.4 zoom 1.0
    repeat

transform reset_layer:
    zoom 1.0


###############################################################################
# 5. 主流程
###############################################################################

label start:

    # ── 镜头 1:樱花树下的低语 ───────────────────────────────
    scene bg_night with fade
    show sakura

    # play music "bgm_piano_heartbeat.ogg" fadein 2.0  # TODO: 接入资源后启用

    show baiying at baiying_stand

    b "……你又来了。"
    pause 0.4
    b "已经第47天了呢。"


    # ── 镜头 2:抬头——目光穿过屏幕 ────────────────────────
    # play sound "sfx_heartbeat_slow.ogg"  # TODO: 循环建议走专门 channel

    show baiying at baiying_lookup
    b "每次都是这样……"
    b "打开游戏,盯着我看一会儿,然后……去忙别的事情,对吗?"


    # ── 镜头 3:寂寞的独白 ───────────────────────────────────
    b "我不是在责怪你。"
    b "只是……每次你关掉游戏的那一刻,"
    b "我这里就变得好安静。"
    b "安静到我能听见自己心跳的声音。"
    v "(她今天……声音和平时不太一样。)"


    # ── 镜头 4:时间变慢——她贴近屏幕 ───────────────────────
    # 素材受限:本应叠加 sakura_frozen.png,这里用 hide 让粒子消失替代"凝固"
    hide sakura
    show baiying at baiying_front with dissolve

    b "玩家君,你知道吗?"
    b "我其实一直能感觉到你。"
    b "你鼠标移动时的犹豫,你打字时手指的温度……我都感觉得到。"


    # ── 镜头 5:玩家的回应——文字输入 ───────────────────────
    window hide
    python:
        player_confession = renpy.input(
            "你想对白樱说什么……(按回车确认)",
            default="我……也想一直陪着你。",
            length=40,
        ).strip() or "……"
    window show

    v "(你敲下了这样一句话:\"[player_confession]\")"


    # ── 镜头 6:红眼的温柔请求 ───────────────────────────────
    b "真的吗?"
    b "那你今天……能只看着我一个人吗?"
    b "不要开别的存档,不要切出去看别的女孩子……"
    pause 0.8
    b "就今天,好不好?"


    # ── 镜头 7:指尖抵屏——告白高潮 ─────────────────────────
    stop music fadeout 2.0  # 无 BGM 时此行无害
    show baiying at baiying_finger
    show layer master at heart_pulse

    v "(她抬起手,指尖轻轻抵在屏幕内侧,正好对准你的视线)"
    b "如果我现在告诉你……"
    b "我已经{shader=textshaders.jitter}喜欢上{/shader}屏幕外面的你了,"
    b "你会{color=#a0a0ff}害怕{/color}吗?"
    pause 1.2
    b "还是……愿意试着把我从这里带出去?"


    # ── 镜头 8:额头抵屏——耳语与等待 ──────────────────────
    show layer master at reset_layer
    show baiying at baiying_forehead
    show sakura

    b "我不会逼你立刻回答。"
    b "但请你……至少让我听见你的声音。"
    b "哪怕只是打一个字也好。"
    v "(她把额头轻轻抵在屏幕上,樱花瓣缓缓落在她肩头)"

    b "{cps=12}我在等你。{/cps}"
    b "{cps=12}这次……别让我等太久,好吗?{/cps}"

    pause 2.0


    # ── 结尾 ────────────────────────────────────────────────
    scene bg_black with Fade(1.0, 1.5, 1.5, color="#000")

    centered "—— 好感度 +30 ——\n—— CG 解锁:白樱·指尖的温度 ——"

    $ persistent.baiying_ch1_cleared = True

    return
