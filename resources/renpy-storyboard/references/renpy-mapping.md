# 故事板效果 → Ren'Py 代码映射

**用途**：写故事板时查这里，确认你规划的效果在 Ren'Py 里确实能实现，并给下游 coding agent 留下实现线索。
**不要**把代码粘进故事板——只确认可行性。

适用 Ren'Py 版本：8.x（8.3 验证）

---

## 1. 转场（Transitions）

| 故事板写法 | Ren'Py 实现 |
|---|---|
| `fade` | `scene bg_xxx with fade`（内置） |
| `dissolve` | `scene bg_xxx with dissolve`（内置） |
| `pixellate` | `scene bg_xxx with pixellate`（内置） |
| `hpunch` / `vpunch` | `with hpunch` / `with vpunch`（震屏） |
| ImageDissolve 特殊形状 | `define myfx = ImageDissolve("mask.png", 1.0)` 然后 `with myfx` |
| PushMove | `define push = PushMove(1.0, "eastwest")` |
| 白闪 flash | `with Fade(0.1, 0.0, 0.5, color="#fff")` |
| 黑幕瞬切 | `with Fade(0.0, 0.5, 0.0, color="#000")` |
| Iris In / Out | 用 `ImageDissolve` + 圆形遮罩图 |
| Blinds 百叶窗 | 用 `ImageDissolve` + 横条/竖条遮罩图 |

---

## 2. 立绘动作（ATL / Transforms）

| 故事板写法 | Ren'Py 实现 |
|---|---|
| 左/右滑入 ease | `transform slide_in: xpos -0.3 ypos 1.0 ease 0.5 xpos 0.2 ypos 1.0`，然后 `show eileen at slide_in` |
| 弹跳登场 ease_bounce | `transform bouncein: alpha 0 yoffset -100 ease_bounce 0.8 alpha 1 yoffset 0` |
| 呼吸动画（循环） | `transform breath: linear 2.0 yoffset 3 linear 2.0 yoffset 0 repeat` |
| 颤抖 | `transform shake: linear 0.05 xoffset 5 linear 0.05 xoffset -5 repeat` |
| 心跳脉动 | `transform pulse: ease 0.3 zoom 1.05 ease 0.3 zoom 1.0 repeat` |
| 移动（MoveTransition） | `with MoveTransition(0.5)` 当 `show` 时自动插值 |
| 淡入 + 缩放 | `transform approach: alpha 0 zoom 0.5 ease 1.0 alpha 1 zoom 1.0` |
| offscreen 滑出 | `hide eileen` 或内置位置 `at offscreenright` |
| 急推 zoomin | `transform zoomin: ease 0.3 zoom 1.5` |
| 急拉 zoomout | `transform zoomout: ease 0.5 zoom 0.5` |

---

## 3. 粒子 / 环境（Sprites）

粒子特效需要自定义 `ParticleBurst` 或用社区 `particle` 框架。Ren'Py 8 里常见做法：

| 效果 | 实现方式 |
|---|---|
| 樱花飘落 | `SnowBlossom("sakura.png", count=15, xspeed=(-20, 20), yspeed=(50, 100))` |
| 雪花 | `SnowBlossom("snow.png", count=50)` |
| 雨 | `SnowBlossom("rain.png", count=80, yspeed=(800, 900), border=0)` |
| 光斑 | 半透明圆形图 + `SnowBlossom` 或自写 sprite manager |
| 萤火虫 | 发光点图 + 自写 sprite manager（带缓动） |
| 花瓣 | 同樱花，换贴图 |
| 血雾 / 黑雾 | 半透明云雾图 + 慢速 ATL 循环 |

注意：`SnowBlossom` 在老版本 Ren'Py 有；新版需要自定义 `Particle` 或用 [Ren'Py 官方 particle 示例](renpy-8.3.4-sdk/doc/sprites.html)。

---

## 4. 滤镜 / 调色（Matrixcolor）

| 效果 | Ren'Py 实现 |
|---|---|
| 黑白 | `show bg_xxx matrixcolor SaturationMatrix(0.0)` |
| 棕褐 Sepia | `matrixcolor SepiaMatrix()` |
| 降饱和 | `matrixcolor SaturationMatrix(0.5)` |
| 色相偏移 | `matrixcolor HueMatrix(30)` |
| 亮度 | `matrixcolor BrightnessMatrix(-0.3)` |
| 对比度 | `matrixcolor ContrastMatrix(1.5)` |
| 反色 | `matrixcolor InvertMatrix()` |
| 冷蓝调 | `matrixcolor TintMatrix("#6080ff")` |
| 暖橙调 | `matrixcolor TintMatrix("#ffb060")` |
| 红色滤镜 | `matrixcolor TintMatrix("#ff4040")` |

---

## 5. 模糊 / Shader

| 效果 | Ren'Py 实现 |
|---|---|
| Blur 模糊 | `show bg_xxx at blur`（需 model-based rendering 开启） |
| Pixellate 马赛克 | `transform pix: Pixellate(1.0, 5)` 或转场用 |
| 水波 / 扭曲 | 自定义 GLSL shader，见 [model.html](renpy-8.3.4-sdk/doc/model.html) |
| 发光 | Shader 或 additive blend 贴图 |

---

## 6. 分层立绘（LayeredImage）

```renpy
layeredimage eileen:
    always "eileen/base.png"

    group outfit:
        attribute uniform default
        attribute casual

    group face:
        attribute happy default
        attribute sad
        attribute blush   # 脸红是独立图层，可叠加
```

使用：`show eileen happy uniform` / `show eileen sad blush`

---

## 7. Live2D

```renpy
image eileen = Live2D("live2d/eileen/eileen.model3.json", zoom=0.5)
show eileen at live2d_idle
```

需要 Live2D Cubism SDK 放到 `game/python-packages/`，详见 [live2d.html](renpy-8.3.4-sdk/doc/live2d.html)。

---

## 8. 视频 / 电影

| 效果 | Ren'Py 实现 |
|---|---|
| 全屏 OP/ED | `play movie "op.webm"` 或 `renpy.movie_cutscene("op.webm")` |
| 视频当背景 | `image bg_rain = Movie(play="rain.webm", loop=True)` 然后 `scene bg_rain` |
| Movie Sprite | `image fire_sprite = Movie(play="fire.webm", size=(200,200))` |

---

## 9. 3D Stage（伪 3D 镜头）

```renpy
camera:
    perspective True
    xzoom 1.0 yzoom 1.0
    rotate 15  # 倾斜

# 推近
show layer master at Transform(zoom=1.5)
```

详见 [3dstage.html](renpy-8.3.4-sdk/doc/3dstage.html)。

---

## 10. 文字效果

| 故事板写法 | Ren'Py 实现 |
|---|---|
| 逐字显示 | `define e = Character("艾琳", cps=30)` |
| 放大粗体 | `"{size=40}{b}走开！{/b}{/size}"` |
| 变色 | `"{color=#ff0000}危险！{/color}"` |
| 颤抖文字 | `"{shader=textshaders.jitter}害怕……{/shader}"` |
| 波浪文字 | `"{shader=textshaders.wave}晕……{/shader}"` |
| 打字机 | `"{shader=textshaders.typewriter}系统启动…{/shader}"` |
| Ruby 注音 | `"{rb}漢字{/rb}{rt}かんじ{/rt}"` |
| Side Image | `define e = Character("艾琳", image="eileen")` + `show eileen happy` |

内置 Text Shaders 见 [textshaders.html](renpy-8.3.4-sdk/doc/textshaders.html)。

---

## 11. 音频

| 故事板写法 | Ren'Py 实现 |
|---|---|
| BGM 播放 | `play music "bgm.ogg" fadein 1.0` |
| BGM 减弱 | `queue music "bgm.ogg" volume 0.5` 或 `set_volume` |
| BGM 停止 | `stop music fadeout 2.0` |
| SFX 音效 | `play sound "sfx.ogg"` |
| 角色语音 | `voice "v_001.ogg"` + 台词行 |
| 循环 SFX | `play sound "rain.ogg" loop` |

---

## 12. 玩家交互

| 故事板写法 | Ren'Py 实现 |
|---|---|
| click（等点击） | 默认对话行为，或 `$ renpy.pause()` |
| menu 分支选择 | `menu:` 然后列选项 |
| input 文本输入 | `$ name = renpy.input("你的名字？")` |
| imagemap 点击区域 | `screen imagemap_xxx` 用 `imagebutton` |
| drag 拖拽 | `DragGroup` + `Drag` displayable |
| 计时选择 | `menu` + `$ renpy.pause(5.0)` 超时跳转 |

menu 示例（故事板 → 代码）：

故事板：
```
玩家交互：
  类型：menu
  选项：
    - "告白" → 跳转到 label route_confession
    - "说点别的" → 跳转到 label route_friend
```

代码：
```renpy
menu:
    "告白":
        jump route_confession
    "说点别的":
        jump route_friend
```

---

## 13. 场景/角色定义（每个故事板开头的 setup）

故事板提到的所有 `bg_xxx` 和角色应该在 `.rpy` 顶部定义：

```renpy
image bg_classroom_afternoon = "images/bg/classroom_afternoon.jpg"
image eileen happy = "images/chara/eileen_happy.png"
image eileen sad = "images/chara/eileen_sad.png"

define e = Character("艾琳", color="#ffcc00", image="eileen")
define narrator = Character(None, kind=nvl)
```

---

## 难度标注说明

故事板里的 ★/★★/★★★ 对应实现难度：

- ★ 一行内置代码能做
- ★★ 需要几行自定义 transform / 贴图素材
- ★★★ 需要 shader、Live2D SDK、3D stage、或大量自定义 Python

如果故事板里出现 ★★★ 效果，实施备注里必须明确列出依赖（"需要 Live2D 模型"、"需要编写 GLSL shader"）。
