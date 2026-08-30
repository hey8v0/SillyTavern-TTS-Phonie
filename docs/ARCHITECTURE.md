# Phonie 1.2 架构

## 唯一运行路径

`manifest.json → index.js → src/ui/mobile/index.js`

`style.css` 只导入 `styles/voice-console.css`。运行路径不包含版本号入口、`src/app.js` 或 `src/ui/phone-view.js`，项目检查会把这些文件重新出现视为失败。

## 公开发行边界

公开版继续包含多供应商 TTS、MiniMax、QQ、联系人、正文 TTS、可见译文、Prompt 工作流、绘图与手机 UI。多人电话和多人语音播放不再是公开功能；QQ 群聊仍是独立功能。

当前单人电话仍使用一次生成完整脚本、再按 TTS 路由顺序播放的过渡实现。未来实时多轮电话会另行设计，本版不包含半成品实时实现。

旧多人电话记录不会被清除。`isPublicSingleCall()` 在 UI、重听和重新生成入口建立统一边界：旧多人数据可继续随备份保存，但不会进入公开执行链。服务层的 `generatePhonePlan()` 同样要求恰好一位联系人，避免绕过 UI 恢复多人拨号。

## 模块边界

- `src/ui/mobile/index.js`：手机状态、路由协调与 DOM 事件。
- `shell.js`：酒馆原生抽屉、扩展菜单入口与入口显示策略。
- `contacts.js` / `phone.js`：联系人界面、来源合并、单人拨号校验和公开电话记录边界。
- `qq.js` / `qq-data.js`：QQ 好友与群聊界面、消息批删、失效引用、好友批删与群成员同步。
- `stickers.js`：URL 批量解析、稳定 ID、状态、按 ID/URL/名称解析旧消息。
- `novelai.js` / `drawing.js`：模型目录、参数版本、原生接口与可选 V5 服务降级。
- `settings.js`：OpenAI 兼容响应方式规范化。
- `src/dialogue/voice-tools.js`：持久化电话、QQ 线程、提示词工作流及迁移；公开电话生成只走 `single_call`。
- `src/tts/provider-registry.js`：TTS 引擎、联系人来源、隐藏名单、绘图和 QQ 全局设置。

## 联系人数据

可见通讯录是：

`(manualCharacters ∪ bodySpeakers) − hiddenCharacters − userName`

`characterRoutes`、当前角色卡、酒馆角色列表和 QQ 历史都不参与收录。`contactSources` 记录 `manual` / `body`；正文扫描只会把有效 TTS 标签的 speaker 写入 `bodySpeakers`。

删除联系人只更新联系人集合与隐藏名单，不删除声线路由。手动重新添加会解除隐藏。

## QQ 数据

旧线程按联系人名合并到 `contact::<name>`，消息以 ID 去重后按时间排序。好友列表仍由 provider registry 全局保存；群聊和消息统一存于 FrontendVoiceTools。启动时旧 `qqGroups` 会迁移一次并清空旧数据源。

删 QQ 好友只修改好友列表和群成员。私聊线程、通讯录与声线路由不受影响。消息批删会保留线程；引用已删消息显示“原消息已删除”。

私聊使用 `chat` 提示词工作流，QQ群聊使用独立的 `group_chat` 工作流。后者约束 speaker 必须来自群成员、允许部分成员保持沉默、禁止机械轮流发言，并明确禁止主动来电；它不依赖已经退出公开线的 `group_call` 电话工作流。

## 正文 TTS

正文 TTS 先替换单一文字节点中的标签，再用 DOM Range 处理被 Markdown/正则拆到多个节点的标签，因此台词含 `「」` 也不会丢失播放条。

播放条视觉只显示 `➤`，角色名保留在读屏文本中。状态分为未渲染、已渲染、生成中、播放中和播放后；主题由 `body[data-tts-voice-theme]` 与自定义 CSS 变量同步手机主题。

## 表情包数据

图库项目包含 `id/name/url/status/error`。旧消息迁移为 `stickerId`，仍能按旧名称或 URL 匹配。浏览器真实图片 load/error 更新状态；Catbox 失败会显示“图床不可达”。不使用代理、ZIP 或 Base64 永久保存第三方图片。

## 模型请求

OpenAI 兼容预设包含 `responseMode`，缺失时归一为 `nonstream`。流式解析器支持跨块 SSE、`[DONE]`、错误事件与普通 JSON 回退。

NovelAI V5 使用 `params_version: 4`，其他模型使用 3。先请求酒馆原生端点；V5 遇到明确的不兼容状态后再请求 `phonie-novelai-v5` 服务插件。Token 始终从 SillyTavern Secrets 读取。

## 安全边界

- 数据迁移可重复执行。
- 不清空 IndexedDB、旧多人记录或其他历史数据。
- 测试只用模拟模型响应，不消耗额度。
- 发布使用普通提交与推送，不强推。
