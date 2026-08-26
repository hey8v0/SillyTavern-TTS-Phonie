# Phonie MiniMax 安全代理

这个目录属于 Phonie 自己的 TTS 管线，不会调用 SillyTavern 的前端 TTS 扩展。

使用安全代理模式时，将 `tts-minimax-resources` 文件夹复制到 SillyTavern 根目录的 `plugins` 文件夹，确认 `config.yaml` 中 `enableServerPlugins: true`，重启 SillyTavern 一次。随后可在 Phonie 的“声线”App 中保存 MiniMax 密钥、同步模型与账号音色并合成语音。

不想安装服务组件时，可在 MiniMax 配置中选择“浏览器直连”。直连密钥会保存在当前用户的 Phonie 扩展设置中，仅建议在可信的私有 SillyTavern 实例使用。
