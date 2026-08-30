# Phonie 手机 1.2.0

Phonie 是 SillyTavern 的手机式 TTS、QQ、联系人、正文语音与 NovelAI 绘图扩展。本仓库是公开发行线，只加载 `src/ui/mobile/index.js` 这一套手机运行时，不会在手机端回退到旧 UI。

## 公开版功能边界

公开版继续维护以下功能：

- 多供应商 TTS、MiniMax、前端 Provider 与角色声线路由；
- QQ 私聊、QQ群聊、联系人与可见译文；
- 正文 TTS、Prompt 工作流、表情包、绘图和手机 UI；
- 现有单人电话。

多人电话与多人语音通话不再作为公开 Phonie 的功能开发或提供。旧多人电话记录不会被迁移脚本删除，但公开界面不再生成、重听或重新生成这些记录。QQ 群聊及其独立 `group_chat` 提示词不属于电话功能，继续保留。

当前单人电话只是过渡实现。这一版不会仓促重写它；后续会重新设计为 Phonie 自己的实时、多轮通话系统，让用户可输入文字或语音，并由 LLM、TTS 和播放流程逐轮响应。README 不把这项未来工作写成已经完成。

## 安装与更新

扩展清单已设置 `auto_update: false`。酒馆不会自动检查或安装 Phonie 更新；扩展管理页的手动“检查更新 / 更新”仍然可用。首次取得 1.2.0 需要手动更新一次。

两个入口都使用酒馆原生结构：

- 扩展设置里的原生 inline drawer；
- 酒馆扩展菜单里的 Font Awesome 手机按钮。

设置中可选择悬浮球、扩展菜单或两者都显示，所有入口都只打开当前新版手机。

## 1.2.0 重点

- 公开电话拨号严格单选。点击通讯录号码会选中对应角色；号码与角色不匹配时会明确报错，不会暗中换人。
- 通讯录只显示手动添加与正文有效 `[TTS:角色:情绪:文本]` 标签中真正发声的角色；角色卡、当前角色和声线路由不会自动污染名单。
- QQ 私聊消息与好友支持多选、全选和批量删除。好友删除只在“管理”中出现并有二次确认，不删除通讯录、声线路由或私聊历史。
- QQ 群聊使用独立提示词工作流，创建时可以选择当前角色卡；群成员可以自然接话或保持沉默，不套用单聊或电话提示词。
- 正文 TTS 修复含 `「」` 台词时播放条缺失的问题。按钮只显示 `➤`，但为读屏保留角色名；未渲染、已渲染、生成中、播放中和播放后使用不同状态色与音波效果，并跟随手机主题。
- 表情包继续使用 URL 导入，支持名称紧接 URL、逗号或换行分隔；带稳定 ID、加载状态和重试，聊天气泡只显示图片。
- NovelAI 提供 V5 Full / Curated、V4.5 Full / Curated 与旧模型兼容；已保存模型不会被自动切换。V5 请求发送 `params_version: 4`。
- OpenAI 兼容直连预设支持“非流式 / 流式 SSE”，旧预设迁移后默认非流式。

## 数据与迁移

1.2.0 的迁移可重复执行，不会清空扩展设置、电话/QQ 聊天记录或 `phonie-v2-assets` IndexedDB 缓存。

联系人被移除后进入隐藏名单，已配置的声线路由保留。QQ 好友被移除后，私聊历史仍保留；对应群成员会同步移除，不足两人的群会在确认后解散。

旧多人电话数据仅作为兼容历史保留。它不会进入公开电话列表，也不会重新调用多人电话生成或播放链。

## 项目历史与上游致谢

Phonie 的开发历史源于对 [SillyTavern-GPT-SoVITS / EchoCore](https://github.com/haide-D/SillyTavern-EchoCore) 的长期个人魔改与重构。感谢原作者 haide-D：早期上游提供了 GPT-SoVITS 基础能力，以及电话、主动来电、窃听、`TTSVoice` 等接口与业务思路；这些历史来源应被明确保留，而不是被 Phonie 的后续重构掩盖。

在个人魔改阶段及后续 Phonie 重构中，项目又新增或大幅重做了多供应商前端 TTS Provider、MiniMax、IndexTTS2 / VoxCPM2 / Edge 等接入、正文 TTS、手机 UI、QQ、联系人、可见译文、Prompt 工作流、绘图及数据迁移。这里的说明是来源审计与开发沿革记录，不替代对每一行代码的法律归属判断，也不把整个 Phonie 简化成上游镜像。

上游 EchoCore 以 MIT License 发布，原版权声明为：

```text
MIT License
Copyright (c) 2026 [haide-D]
```

上游派生部分继续遵守其 MIT 条款。完整许可文本见 [EchoCore LICENSE](https://github.com/haide-D/SillyTavern-EchoCore/blob/main/LICENSE)。如果来源说明仍有遗漏，欢迎提交 issue 补充证据与修正。

## NovelAI V5 兼容服务

新版 SillyTavern 可直接处理 `params_version: 4`。若当前酒馆核心返回不支持，手机会尝试随项目提供的安全兼容服务，并显示安装说明：

1. 复制 `server-plugins/phonie-novelai-v5` 到 SillyTavern 根目录的 `plugins/`。
2. 在 `config.yaml` 开启 `enableServerPlugins: true`。
3. 重启 SillyTavern。

兼容服务只读取酒馆密钥保险箱的 NovelAI Token；手机代码不接触 Token。测试不会发出真实绘图请求。MiniMax 的安全服务插件位于 `server-plugins/tts-minimax-resources`，安装方式相同。

## 表情图片说明

Phonie 不代理第三方图片，也不导入本地 ZIP。若当前网络拦截 Catbox，管理页会标记“图床不可达”，而不是把整批图片都当作普通裂图。此时需要更换当前网络可直连的图片 URL。

## 目录

```text
index.js                         唯一扩展入口
style.css                        唯一样式入口
styles/voice-console.css         当前手机样式
src/dialogue/                    正文 TTS、电话/QQ 数据与模型请求
src/tts/                         引擎、路由、缓存与设置迁移
src/ui/mobile/index.js           手机状态、路由与事件协调器
src/ui/mobile/shell.js           酒馆原生入口与启动器
src/ui/mobile/contacts.js        通讯录来源与公共电话单选边界
src/ui/mobile/phone.js           当前单人电话界面
src/ui/mobile/qq.js              QQ 好友、私聊入口与群聊界面
src/ui/mobile/qq-data.js         QQ 批量删除与线程迁移
src/ui/mobile/stickers.js        表情解析、ID、状态与匹配
src/ui/mobile/drawing.js         NovelAI 请求与 V5 降级
src/ui/mobile/settings.js        模型响应模式规范
server-plugins/                  可选安全服务插件
tests/                           当前运行时测试
```

更完整的数据流与边界说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 验证

```bash
npm test
npm run check
```

本地预览：

```bash
python -m http.server 8910
# 打开 http://localhost:8910/preview/index.html
```
