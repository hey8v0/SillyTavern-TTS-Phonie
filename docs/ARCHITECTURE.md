# Phonie 1.1 架构

## 唯一运行路径

`manifest.json → index.js → src/ui/mobile/index.js`

`style.css` 只导入 `styles/voice-console.css`。运行路径不包含版本号入口、`src/app.js` 或 `src/ui/phone-view.js`，项目检查会把这些文件重新出现视为失败。

## 模块边界

- `src/ui/mobile/index.js`：手机状态、路由协调与 DOM 事件。
- `shell.js`：酒馆原生抽屉、扩展菜单入口与入口显示策略。
- `contacts.js` / `phone.js`：联系人界面、来源合并、电话界面和 1–6 人拨号校验。
- `qq.js` / `qq-data.js`：QQ 好友与群聊界面、消息批删、失效引用、好友批删与群成员同步。
- `stickers.js`：URL 批量解析、稳定 ID、状态、按 ID/URL/名称解析旧消息。
- `novelai.js` / `drawing.js`：模型目录、参数版本、原生接口与可选 V5 服务降级。
- `settings.js`：OpenAI 兼容响应方式规范化。
- `src/dialogue/voice-tools.js`：持久化电话、QQ 线程、提示词工作流及迁移。
- `src/tts/provider-registry.js`：TTS 引擎、联系人来源、隐藏名单、绘图和 QQ 全局设置。

## 联系人数据

可见通讯录是：

`(manualCharacters ∪ bodySpeakers) − hiddenCharacters − userName`

`characterRoutes`、当前角色卡、酒馆角色列表和 QQ 历史都不参与收录。`contactSources` 记录 `manual` / `body`；正文扫描只会把有效 TTS 标签的 speaker 写入 `bodySpeakers`。

删除联系人只更新联系人集合与隐藏名单，不删除声线路由。手动重新添加会解除隐藏。

## QQ 数据

旧线程按联系人名合并到 `contact::<name>`，消息以 ID 去重后按时间排序。好友列表仍由 provider registry 全局保存；群聊和消息统一存于 FrontendVoiceTools。启动时旧 `qqGroups` 会迁移一次并清空旧数据源。

删 QQ 好友只修改好友列表和群成员。私聊线程、通讯录与声线路由不受影响。消息批删会保留线程；引用已删消息显示“原消息已删除”。

私聊使用 `chat` 提示词工作流，QQ群聊使用独立的 `group_chat` 工作流。后者单独约束 speaker 必须来自群成员、允许部分成员保持沉默、禁止机械轮流发言，并明确禁止主动来电；旧设置缺少该工作流时会自动补入默认条目，不覆盖原有单聊提示词。

## 表情包数据

图库项目包含 `id/name/url/status/error`。旧消息迁移为 `stickerId`，仍能按旧名称或 URL 匹配。浏览器真实图片 load/error 更新状态；Catbox 失败会显示“图床不可达”。不使用代理、ZIP 或 Base64 永久保存第三方图片。

## 模型请求

OpenAI 兼容预设新增 `responseMode`，缺失时归一为 `nonstream`。流式解析器支持跨块 SSE、`[DONE]`、错误事件与普通 JSON 回退。

NovelAI V5 使用 `params_version: 4`，其他模型使用 3。先请求酒馆原生端点；V5 遇到明确的不兼容状态后再请求 `phonie-novelai-v5` 服务插件。Token 始终从 SillyTavern Secrets 读取。

## 安全边界

- 数据迁移可重复执行。
- 不清空 IndexedDB 或历史记录。
- 测试只用模拟模型响应，不消耗额度。
- 发布使用普通 fast-forward 合入与推送，不强推。
