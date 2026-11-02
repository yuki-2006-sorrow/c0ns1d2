# c0ns1d2 · 我的生活

私人生活记录与计划工具，仅本人站主账号可用。

- 今天：每日任务、完成与改期、日常记录。
- 计划：项目进度、下一步、关键日期、DeepSeek 任务拆解。
- 记录：日常、每周回顾和 Siri 随手想法。
- 我：个人方向、iPhone 凭证、DeepSeek 设置与账号。

AI 拆解发送选定项目、补充说明，以及本人勾选的个人背景与相关可用资源；发送前可展开预览。生成后可修改、选择并安排日期。“我”页面支持时间、能力与限制，以及可关联项目的资源清单。API Key 在“我 → AI 管家”填写，仅服务端保存到被 Git 忽略的 .local-collaboration/ai-config.json，也支持 DEEPSEEK_API_KEY 环境变量。不会自动向 AI 发送其他项目详情、日记或凭证。

原共同创作、作品发布、素材库、邀请注册和相关接口已退出运行网站。旧链接跳转个人空间，旧内容接口返回410。历史备份保留，不重新导入。

## 使用与运行

双击“启动.bat”启动当前电脑后台和既有 Cloudflare 通道。正式入口 https://c0ns1d2.com/personal 。电脑与网络需保持在线。默认后台端口4324；4327为隔离预览，不保存正式密钥。

私人资料位于 .local-collaboration/archive.json。备份时先停止后台，复制整个 .local-collaboration/；密钥配置不进入 Git、公开构建或文字导出。原素材备份位于 .material-backups/。

## 验证

- npm run test:personal：个人存储、权限、手机写入、AI 请求与失败处理。
- node --test scripts/remote-entry.test.mjs：公网网关。
- npm run build：构建与公开范围检查。

历史协作测试与文档仅供旧版本追溯。当前功能见 docs/项目进度与每日计划-2026-11-02.md 和 docs/iPhone与Siri记录-2026-11-02.md。
