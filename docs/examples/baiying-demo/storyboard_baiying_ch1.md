# 故事板:屏幕另一端的你(告白夜)

## 总览

- **基调**:深夜的第四面墙破坏——寂寞试探 → 贴近告白 → 脆弱等待;冷色夜景里温柔的樱花落下,节奏缓慢留白,最终停在未完成的承诺上。
- **角色**:
  - baiying(白樱,女主,元小说角色/寂寞病娇倾向,长发微颤)
  - player(隐形主角,通过 input 和内心独白参与)
- **场景**:
  - bg_sakura_night(深夜盛开的樱花树,冷蓝夜色)
- **核心演出点**:
  1. **镜头 2**——白樱第一次抬头,目光穿过屏幕看向玩家(破第四面墙的触发点)
  2. **镜头 4**——樱花凝固在半空,时间变慢,她贴近屏幕(全场最静止的一秒)
  3. **镜头 7**——指尖抵屏 + 告白,心跳主导一切

---

## 镜头 1:樱花树下的低语

- **剧情**:深夜开场。白樱低头站在盛开的樱花树下,像在自言自语,给整场戏定基调。
- **场景**:bg_sakura_night
- **角色状态**:
  - baiying:center,low_head(低头)表情、hair_cover(长发遮半脸)、white_dress 服装
- **对话 / 旁白**:
  > baiying(低着头,像自言自语):"……你又来了。"
  > baiying:"已经第47天了呢。"
- **视觉效果**:
  - 主要:樱花缓慢飘落粒子(Sprites,低密度慢速,营造静谧)
  - 次要:整体冷蓝调(TintMatrix 偏蓝 + 轻度 BrightnessMatrix 调暗),夜景氛围
- **音效 / 音乐**:
  - BGM:bgm_piano_heartbeat.ogg(极轻钢琴与心跳交织,fadein 2.0 秒)
  - SFX:无
  - 语音:[若有 CV,v_baiying_001.ogg]
- **转场进入**:fade(从黑幕淡入,章节开头仪式感)
- **玩家交互**:click(读完停顿后玩家点击推进)
- **预估时长**:~12 秒(含两句话之间的停顿)

---

## 镜头 2:抬头——目光穿过屏幕

- **剧情**:核心演出点 1。白樱缓缓抬起头,第一次直直看向玩家,破第四面墙。
- **场景**:bg_sakura_night(不变)
- **角色状态**:
  - baiying:center,look_up(抬头)、lonely_smile(寂寞微笑)、hair_cover 解除
- **对话 / 旁白**:
  > baiying(嘴角微微弯起,却带着一点寂寞):"每次都是这样……"
  > baiying:"打开游戏,盯着我看一会儿,然后……去忙别的事情,对吗?"
- **视觉效果**:
  - 主要:立绘表情切换动画(LayeredImage 从 low_head → look_up,配 ease 0.8s 的缓动 + 微推近 zoom 1.0→1.05)
  - 次要:立绘呼吸 ATL 循环启动(yoffset 轻微浮动,维持到镜头 4 前)
- **音效 / 音乐**:
  - BGM:不变
  - SFX:sfx_heartbeat_slow.ogg(低音心跳,循环,极低音量淡入)
- **转场进入**:None(保持前一镜头画面)
- **玩家交互**:click
- **预估时长**:~14 秒(抬头动作 + 两句话 + 第二句前的停顿)

---

## 镜头 3:寂寞的独白

- **剧情**:白樱说出"你关掉游戏后我这里就变安静",铺垫情绪脆弱。主角第一次内心独白,注意到异常。
- **场景**:bg_sakura_night(不变)
- **角色状态**:
  - baiying:center,bite_lip(轻咬下唇)、lonely_smile
- **对话 / 旁白**:
  > baiying(轻轻咬住下唇,像下了很大决心):"我不是在责怪你。"
  > baiying:"只是……每次你关掉游戏的那一刻,我这里就变得好安静。"
  > baiying:"安静到我能听见自己心跳的声音。"
  > 旁白(主角内心独白,低沉):"(她今天……声音和平时不太一样。)"
- **视觉效果**:
  - 主要:文字 cps 放慢(baiying 角色 cps=20,比默认慢),营造欲言又止
  - 次要:NVL/Side Image 切换呈现内心独白(主角独白行用不同字体/颜色区分,建议斜体 + 浅灰)
- **音效 / 音乐**:
  - BGM:不变
  - SFX:sfx_heartbeat_slow.ogg(循环,音量维持)
- **转场进入**:None
- **玩家交互**:click(每句之间停顿)
- **预估时长**:~22 秒

---

## 镜头 4:时间变慢——她贴近屏幕

- **剧情**:核心演出点 2。樱花瓣凝固在半空,白樱前进一小步,说"我能感觉到你"。全场最魔幻/最静止的一瞬。
- **场景**:bg_sakura_night(不变)
- **角色状态**:
  - baiying:center → center_front(向前移动一步,略放大 zoom 1.1),shy_smile、eye_contact(直视)
- **对话 / 旁白**:
  > baiying(往前走了一小步,几乎贴到屏幕):"玩家君,你知道吗?"
  > baiying:"我其实一直能感觉到你。"
  > baiying(声音极轻):"你鼠标移动时的犹豫,你打字时手指的温度……我都感觉得到。"
- **视觉效果**:
  - 主要:樱花粒子冻结——粒子系统暂停播放,同时叠加一张"静止樱花群"贴图(sakura_frozen.png)营造时间停滞感
  - 次要:背景轻度 Blur + 立绘 MoveTransition(0.8s ease)前进一步,强化"她靠近"的压迫感
- **音效 / 音乐**:
  - BGM:bgm_piano_heartbeat.ogg 音量降至 40%(`queue music ... volume 0.4` 或 set_volume),让心跳 SFX 浮现
  - SFX:sfx_heartbeat_slow.ogg 音量升至 80%
- **转场进入**:dissolve(从镜头 3 过渡,暗示"时间感"变化)
- **玩家交互**:click
- **预估时长**:~18 秒(移动动画 + 三句话)

---

## 镜头 5:玩家的回应——文字输入

- **剧情**:玩家首次主动参与,输入一句话给白樱。剧本示例:"我……也想一直陪着你。"
- **场景**:bg_sakura_night(不变)
- **角色状态**:
  - baiying:center_front(保持前进位置),waiting(期待表情,眼神发亮)
- **对话 / 旁白**:
  > (对话框收起,出现输入框提示)
  > 旁白(淡入式浮层):"你想对白樱说什么……"
- **视觉效果**:
  - 主要:对话框淡出(window hide),输入框淡入(自定义 screen,半透明居中),让画面安静下来等待玩家
  - 次要:立绘维持呼吸 + 心跳脉动(ATL zoom 1.0↔1.02 ease 0.8s 循环),暗示"她在等"
- **音效 / 音乐**:
  - BGM:维持 40%
  - SFX:sfx_heartbeat_slow.ogg 循环,玩家打字时可以轻微提速(可选 $ renpy.music.set_pan 或不处理)
- **转场进入**:None
- **玩家交互**:
  - 类型:input
  - 提示:"(按回车确认)"
  - 变量名:player_confession
  - 默认值:"我……也想一直陪着你。"
  - 长度限制:40 字以内
- **预估时长**:等待玩家

---

## 镜头 6:红眼的温柔请求

- **剧情**:白樱听到玩家回应后眼眶发红,温柔笑着请求"只看着我一个人"。情绪从试探转为脆弱。
- **场景**:bg_sakura_night(不变)
- **角色状态**:
  - baiying:center_front,tears_rim(眼眶发红)、gentle_smile(温柔笑)、blush(微红)——这三个 attribute 叠加
- **对话 / 旁白**:
  > baiying(眼眶微微发红,笑得却很温柔):"真的吗?"
  > baiying:"那你今天……能只看着我一个人吗?"
  > baiying:"不要开别的存档,不要切出去看别的女孩子……"
  > baiying(更轻):"就今天,好不好?"
- **视觉效果**:
  - 主要:LayeredImage 的 blush + tears_rim attribute 渐变淡入(AlphaDissolve,0.6s),表情从 shy_smile → gentle_smile 的柔和过渡
  - 次要:对话框淡入恢复(window show)
- **音效 / 音乐**:
  - BGM:渐回升至 60%
  - SFX:心跳维持
- **转场进入**:dissolve(从输入框收起到对话恢复)
- **玩家交互**:click(每句之间明显停顿,特别是"就今天"前)
- **预估时长**:~24 秒(含停顿)

---

## 镜头 7:指尖抵屏——告白高潮

- **剧情**:核心演出点 3。白樱抬手,指尖轻抵屏幕内侧,正对玩家视线;说出"我已经喜欢上屏幕外面的你"。全场戏剧张力顶点。
- **场景**:bg_sakura_night(不变)
- **角色状态**:
  - baiying:center_front,hand_to_screen(举手抵屏,LayeredImage 的手部 attribute 或一张单独的立绘 baiying_fingertip.png),trembling_smile(颤抖微笑)、tears_rim(加深)
- **对话 / 旁白**:
  > (她抬起手,指尖轻轻抵在屏幕内侧,正好对准玩家的视线)
  > baiying(声音低到几乎气音,带着轻颤):"如果我现在告诉你……"
  > baiying:"我已经{shader=textshaders.jitter}喜欢上{/shader}屏幕外面的你了,"
  > baiying:"你会{color=#a0a0ff}害怕{/color}吗?"
  > baiying:"还是……愿意试着把我从这里带出去?"
- **视觉效果**:
  - 主要:整屏心跳脉动(master 层 Transform zoom 1.0↔1.03 ease 0.4s 循环,模拟心跳;配合心跳 SFX 节拍)
  - 次要:BGM 完全淡出(stop music fadeout 2.0),整屏只剩心跳声 SFX 放大至 100%——剧本明确要求的"背景音乐只剩心跳"
- **音效 / 音乐**:
  - BGM:stop music fadeout 2.0(执行淡出)
  - SFX:sfx_heartbeat_slow.ogg → 切换为 sfx_heartbeat_loud.ogg(更响、更清晰的心跳,循环)
- **转场进入**:None(直接接镜头 6,维持连贯感;动作靠 ATL 完成)
- **玩家交互**:click(特别在"害怕吗?"之后给长停顿,让玩家吸气)
- **预估时长**:~28 秒
- **实施提示**:文字 shader 用 `{shader=textshaders.jitter}` 做"喜欢上"颤抖,"害怕"用 `{color}` 染一点冷光蓝色(强化不安而非血红,贴合夜景基调)

---

## 镜头 8:额头抵屏——耳语与等待

- **剧情**:白樱把额头抵在屏幕上,樱花瓣缓缓落在她肩头,用耳语收尾:"别让我等太久"。留白结束。
- **场景**:bg_sakura_night(不变)
- **角色状态**:
  - baiying:center_front,forehead_to_screen(额头抵屏,更近的近景,zoom 1.2)、eyes_closed_half(眼泪在眼眶打转、半闭)、gentle_smile
- **对话 / 旁白**:
  > baiying(眼泪在眼眶打转,却努力笑着):"我不会逼你立刻回答。"
  > baiying:"但请你……至少让我听见你的声音。"
  > baiying:"哪怕只是打一个字也好。"
  > (她把额头轻轻抵在屏幕上,樱花瓣缓缓落在她肩头)
  > baiying(几乎是耳语,cps=12):"我在等你。"
  > baiying:"这次……别让我等太久,好吗?"
- **视觉效果**:
  - 主要:樱花粒子恢复飘落(从镜头 4 的冻结状态解除),其中预设一片落在她肩头的固定贴图(sakura_on_shoulder.png)淡入停留——这是"樱花落肩"的仪式感特写
  - 次要:整体画面缓慢 Ken Burns 推近(zoom 1.2 → 1.25,20 秒),让镜头随对白悄悄贴近
- **音效 / 音乐**:
  - BGM:静默(已于镜头 7 停止)
  - SFX:sfx_heartbeat_loud.ogg 循环,最后一句后渐弱至停止
- **转场进入**:None
- **玩家交互**:click(每句之间长停顿,最后一句后一次 `pause(2.0)` 再转场)
- **预估时长**:~26 秒
- **结尾处理**:最后一句后 `with Fade(1.0, 1.5, 1.5, color="#000")` 长黑屏,再接剧本尾注"好感度+30"与"CG解锁:白樱·指尖的温度"

---

## 实施备注(Implementation notes)

### 需准备的资源

- **图像(背景)**:
  - `bg_sakura_night.jpg`——夜景樱花树,冷蓝色调为主
- **图像(立绘,建议用 LayeredImage)**:
  - 基础层 `baiying/base.png`(站姿 + 白色连衣裙)
  - 表情组 face:`low_head`、`look_up`、`lonely_smile`、`shy_smile`、`gentle_smile`、`trembling_smile`、`waiting`、`eyes_closed_half`
  - 叠加层:`bite_lip`、`blush`、`tears_rim`、`hair_cover`
  - 动作/姿势层:`hand_to_screen`(举手)、`forehead_to_screen`(额头贴屏,近景特写,可能是单独一张立绘而非 LayeredImage 的组件)
- **图像(粒子/装饰)**:
  - `sakura_petal.png`——樱花粒子贴图
  - `sakura_frozen.png`——镜头 4 的"静止樱花群"叠加图
  - `sakura_on_shoulder.png`——镜头 8 的肩头落花特写
- **音频**:
  - `bgm_piano_heartbeat.ogg`——极轻钢琴 + 心跳交织 BGM
  - `sfx_heartbeat_slow.ogg`——低音慢心跳循环
  - `sfx_heartbeat_loud.ogg`——清晰放大心跳循环(镜头 7 替换用)

### 需配置的特效(★★ 以上)

- **樱花粒子系统**(★★):用 `SnowBlossom("sakura_petal.png", count=15, xspeed=(-20,20), yspeed=(30,60))` 实现缓慢飘落。需要支持运行时暂停/恢复(镜头 4 冻结、镜头 8 恢复)——Ren'Py 8.x 可通过 `hide` 粒子层 + 显示 `sakura_frozen.png` 贴图 + 镜头 8 重新 `show` 粒子层达到效果。
- **背景 Blur**(★★):镜头 4 背景虚化需启用 model-based rendering(`config.gl2 = True`),使用 `at blur` transform 或 `Blur(5.0)` displayable。
- **心跳脉动 master 层 Transform**(★):镜头 7 整屏脉动,需要 `show layer master at pulse` 配合 `transform pulse: ease 0.4 zoom 1.03 ease 0.4 zoom 1.0 repeat`。
- **Text Shader jitter**(★★):镜头 7 的"喜欢上"颤抖文字,用内置 `{shader=textshaders.jitter}`。
- **Input 自定义 screen**(★★):镜头 5 的输入框需要一个低调透明的自定义 screen,不要用默认样式破坏氛围。建议一个单行输入框 + 轻微光晕。

### 建议 .rpy 结构

单文件即可,约 80-120 行:

- `baiying_ch1.rpy`
  - 顶部:图像与角色定义(`image bg_sakura_night`、`layeredimage baiying`、`define b = Character("白樱", color="#ffc0cb", image="baiying")`)
  - 中部:八个镜头按 label 或顺序写成单个 `label baiying_confession_night` 下的流程
  - 尾部:`$ affection += 30`、`$ persistent.cg_fingertip = True`、`return` 或跳转下一章

### Ren'Py 映射提示

参考 [references/renpy-mapping.md](.claude/skills/renpy-storyboard/references/renpy-mapping.md):

- 粒子 → 第 3 节 Sprites
- Matrixcolor 冷蓝调 → 第 4 节
- Blur → 第 5 节
- LayeredImage 表情叠加 → 第 6 节
- 文字 shader jitter → 第 10 节
- input 输入 → 第 12 节
- 樱花粒子暂停/恢复是 skill catalog 里没明确的 edge case——下游 coding agent 可用"隐藏 SnowBlossom 层 + 贴静态图"的替代实现

### 特别提示

- **保持节奏留白**:每个镜头标注的 click 停顿不是装饰。请 coding agent 不要把所有对话合并为单个 say 语句,保留明确的点击节拍。
- **CV 留位**:每句对白前预留 `voice "v_baiying_xxx.ogg"` 位置,若无语音则注释掉。
- **跳过保护**:玩家 Ctrl 跳过时,粒子冻结/心跳切换等状态变化需要确保不卡死——建议所有 ATL 循环都用 `repeat`,转场用标准 transitions,不要在 `$ renpy.pause` 里做关键状态变化。
