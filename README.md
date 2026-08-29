# Phonie 手机

SillyTavern 扩展：一个拟真的「小手机」界面 —— 兼具 TTS / 聊天 / 绘图的声纹手机。

实现以 `PLAN.md` 为最高产品契约，并吸收 `PHOEN_ORIGINAL_HANDOFF_2026-08-25` 中可复用的 SVG 路径、提示词规则、结构化解析、情绪归一化、MiniMax 安全服务和测试场景。交接包与 PLAN 冲突的豆包、红包、两页桌面、自动跨引擎回退和 `TTSVoice` 新写入格式均未恢复。

## 当前进度

已完成一轮可运行的 1.0 纵向实现：

- 真实手机外壳：类 iPhone 钛金属边框、圆角玻璃屏、音量 / 电源实体按键、Home Indicator。
- 状态栏：真实本地时间、Battery API 电量与充电、`online + effectiveType` 网络；无数据时诚实降级。
- 灵动岛：六个状态与波形 / 脉冲动画，点击可回到进行中的页面。
- 主页：一页两行四列，固定顺序 QQ、电话、通讯录、追踪、引擎、绘画、主题、设置；底部四图标 Dock。
- 导航：进入应用后 Dock 消失，保留左上角返回与 Home Indicator。
- 主题：日间 / 夜间 / 跟随酒馆 / 自定义，语义化颜色令牌（60/30/7/3）。
- 图标：八个 APP、六个引擎专属图标与交接包通用 SVG 全部收口到同一内联注册表，无 emoji、无字体图标。
- 入口：悬浮球（可拖动）、酒馆魔棒菜单、扩展设置面板。
- 适配：桌面居中 390×844；移动端缩放保留细窄外壳；横屏居中竖屏。
- 精修视觉：暖瓷白 / 深松石日间主题、墨黑 / 青绿夜间主题、雾面卡片、编辑感首页和统一按压反馈。
- QQ：好友与群聊、连续 user 消息、结构化角色回复、文字 / 语音 / 图片 / 转账 / 表情包、撤回和聊天管理。
- 电话与追踪：虚拟号码、通讯录多选、单人 / 多人脚本、来电 / 外呼、字幕、TTS 队列、收藏 / 重播 / 重渲染。
- 通讯录与引擎：联系人声线绑定、六引擎独立配置、连接检测通过后启用。
- 绘画：固定前后缀与负面词、动态 Tag、三种安全尺寸、Sampler / Scheduler / Seed / Steps / Guidance / Decrisper。
- 设置：模型来源、五类提示词、正文 TTS、主动来电、表情包和缓存管理；每类提示词支持多个命名预设与当前预设。

## 目录结构

```
index.js                扩展入口（init）
style.css               全部样式
src/
  app.js                应用工厂（store、actions、挂载）
  core/                 常量、store、图标
  device/               状态栏设备监控（时间 / 电量 / 网络）
  integrations/         SillyTavern 桥接
  ui/                   手机外壳视图渲染
tests/                  单元测试（npm test）
scripts/check-project.mjs 项目结构检查（npm run check）
preview/                本地可视化预览（开发用，不随扩展加载）
```

## 验证

```bash
npm test        # 单元测试
npm run check   # 结构 + 语法检查
```

## MiniMax 引擎（服务插件）

MiniMax 合成只通过随项目交付的安全服务插件进行，浏览器端不直接接触密钥：

1. 把 `server-plugins/tts-minimax-resources` 整个文件夹复制到 SillyTavern 根目录的 `plugins/`。
2. 在 `config.yaml` 里确认 `enableServerPlugins: true`，重启 SillyTavern。
3. 在手机「引擎 → MiniMax」里选择服务区域（国际站 / 大陆站）、填写语音模型与音色 ID。
4. 「连接检测」通过后即可「设为当前引擎」；点「同步模型与音色」拉取官方模型目录与账户音色。
5. API Key 保存在 SillyTavern 密钥保险箱的 MiniMax 槽位，扩展设置中不保存任何密钥。

## 提示词默认条目

每类工作流（正文注入 / 单人电话 / 多人电话 / QQ 聊天）的默认预设都带一条可关闭的「MiniMax 适配」条目：情绪规范（happy / sad / angry / fearful / disgusted / surprised / calm / fluent）与 Sound Tags（`(laughs)`、`(sighs)`、`<#0.3#>` 停顿等）。使用其他引擎时可随时关闭。

提示词条目保留 `system / user / assistant` 角色与 0–20 深度，按深度插入真实生成消息列表。公共变量使用 `{{char}}`、`{{user}}`、`{{storyHistory}}`、`{{worldbook}}`、`{{qqHistory}}`、`{{pendingMessages}}`、`{{imageIntent}}`、`{{outputSchema}}` 等 PLAN 变量；未知变量保留供编辑器诊断。输出 Schema 由插件独立追加，不依赖用户条目。

## 密钥边界

自定义 OpenAI 和 ElevenLabs 只在设置中保存 `secretId`。输入的 API Key 会写入 SillyTavern Secrets；删除 OpenAI 预设时同步删除对应密钥。直连接口需要读取密钥时，若 `allowKeysExposure` 未开启，会显示准确配置提示，不会回退到酒馆主 API，也不会把密钥重新写回扩展设置。

## 本地预览（无需启动酒馆）

```bash
cd <本目录>
python -m http.server 8910
# 浏览器打开 http://localhost:8910/preview/index.html
```
