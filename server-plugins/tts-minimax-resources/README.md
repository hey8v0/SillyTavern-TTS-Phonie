# MiniMax 安全代理服务

这是 SillyTavern 的轻量服务插件，只复用酒馆自身已经运行的服务和密钥保险箱，不会启动额外黑框或 Python 后端。它负责同步模型、拉取账户音色，并通过当前官方 `/v1/t2a_v2` 接口合成语音。

将 `tts-minimax-resources` 文件夹复制到 SillyTavern 根目录的 `plugins` 文件夹，确认 `config.yaml` 中 `enableServerPlugins: true`，然后重启 SillyTavern 一次。客户端即可从 MiniMax 官方接口同步最新模型、系统音色、快速复刻音色和音色设计结果。
