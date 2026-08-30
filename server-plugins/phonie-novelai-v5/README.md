# Phonie NovelAI V5 兼容服务

仅当当前 SillyTavern 核心不接受 `params_version: 4` 时需要安装：

1. 把 `phonie-novelai-v5` 文件夹复制到 SillyTavern 根目录的 `plugins/`。
2. 在 `config.yaml` 启用 `enableServerPlugins: true`。
3. 重启 SillyTavern。

服务只读取酒馆密钥保险箱内的 NovelAI Token，只接受 V5 Full / Curated 请求，并把 Steps 限制为 28。支持 V5 的新版酒馆会继续优先使用原生 `/api/novelai/generate-image`，不会经过该服务。
