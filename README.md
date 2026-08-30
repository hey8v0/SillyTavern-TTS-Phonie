# Phonie 手机 1.1.1

Phonie 是 SillyTavern 的手机式 TTS、电话、QQ 与 NovelAI 绘图扩展。1.1.1 只保留一套手机运行时，入口统一指向 `src/ui/mobile/index.js`，不会在手机端回退到旧 UI。

## 安装与更新

扩展清单已设置 `auto_update: false`。酒馆不会自动检查或安装 Phonie 更新；扩展管理页的手动“检查更新 / 更新”仍然可用。首次取得 1.1.1 需要手动更新一次。

两个入口都使用酒馆原生结构：

- 扩展设置里的原生 inline drawer；
- 酒馆扩展菜单里的 Font Awesome 手机按钮。

设置中可选择悬浮球、扩展菜单或两者都显示，三者都只打开当前新版手机。

## 1.1.1 重点

- 通讯录只显示手动添加与正文有效 `[TTS:角色:情绪:文本]` 标签中真正发声的角色，角色卡、当前角色和声线路由不会自动污染名单。
- 电话严格使用勾选结果：1 人单人通话，2–6 人多人通话；无效角色会报错，不会暗中换人。
- QQ 私聊消息与好友均支持多选、全选、批量删除；删好友不删通讯录、声线路由或私聊历史。
- QQ 群聊使用独立提示词工作流，群消息也支持发送、角色回复、多选、全选与批量删除；群成员可以自然接话或保持沉默，不再套用单聊提示词。
- QQ 线程按联系人统一，好友入口会打开对应联系人，而不是当前酒馆角色。若要让非当前角色生成回复，先在酒馆打开那张角色卡。
- 表情包继续使用 URL 导入，支持名称紧接 URL、逗号或换行分隔；带稳定 ID、加载状态和重试。聊天气泡只显示图片。
- NovelAI 提供 V5 Full / Curated、V4.5 Full / Curated 与旧模型兼容；已保存模型不会被自动切换。V5 请求发送 `params_version: 4`。
- OpenAI 兼容直连预设支持“非流式 / 流式 SSE”，旧预设迁移后默认非流式。

## 数据与迁移

1.1.1 会原地、可重复地迁移联系人来源、QQ 统一线程、`stickerId` 与 API 预设 `responseMode`。不会清空扩展设置、电话/QQ 聊天记录或 `phonie-v2-assets` IndexedDB 缓存。

联系人被移除后进入隐藏名单；已配置的声线路由保留。QQ 好友被移除后，私聊历史仍保留；对应群成员会同步移除，不足两人的群会在确认后解散。

## NovelAI V5 兼容服务

新版 SillyTavern 可直接处理 `params_version: 4`。若当前酒馆核心返回不支持，手机会尝试随项目提供的安全兼容服务，并显示准确安装说明：

1. 复制 `server-plugins/phonie-novelai-v5` 到 SillyTavern 根目录的 `plugins/`。
2. 在 `config.yaml` 开启 `enableServerPlugins: true`。
3. 重启 SillyTavern。

兼容服务只读取酒馆密钥保险箱的 NovelAI Token；手机代码不接触 Token。测试不会发出真实绘图请求。

MiniMax 的安全服务插件位于 `server-plugins/tts-minimax-resources`，安装方式相同。

## 表情图片说明

Phonie 不代理第三方图片，也不导入本地 ZIP。若当前网络拦截 Catbox，管理页会标记“图床不可达”，而不是把 171 张图都当作普通裂图。此时需要更换当前网络可直连的图片 URL。

## 目录

```text
index.js                         唯一扩展入口
style.css                        唯一样式入口
styles/voice-console.css         当前手机样式
src/dialogue/                    正文 TTS、电话/QQ 数据与模型请求
src/tts/                         引擎、路由、缓存与设置迁移
src/ui/mobile/index.js           手机状态、路由与事件协调器
src/ui/mobile/shell.js           酒馆原生入口与启动器
src/ui/mobile/contacts.js        通讯录界面、来源与拨号校验
src/ui/mobile/phone.js           单人/多人电话界面
src/ui/mobile/qq.js              QQ 好友、私聊入口与群聊界面
src/ui/mobile/qq-data.js         QQ 批量删除与线程迁移
src/ui/mobile/stickers.js        表情解析、ID、状态与匹配
src/ui/mobile/drawing.js         NovelAI 请求与 V5 降级
src/ui/mobile/settings.js        模型响应模式规范
server-plugins/                  可选安全服务插件
tests/                           当前运行时测试
```

更完整的数据流与迁移说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

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
