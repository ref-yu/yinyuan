\# 项目背景：AI 恋爱/交友匹配与破冰平台

核心功能：通过 AI 分析用户画像进行 1v1 匹配，并在专属的 WebSockets 聊天室中，由 AI 助手引导双方增进关系。



\# 技术栈

\- 语言：严格使用 TypeScript

\- 前端：Next.js (App Router), Tailwind CSS

\- 后端：Node.js, Express, Socket.io (处理实时通讯)

\- 数据库：PostgreSQL (预留 pgvector 支持), 使用 Prisma ORM

\- AI 集成：Google Gen AI SDK



\# 开发规范

1\. 所有接口请求必须返回标准的 JSON 格式。

2\. Socket.io 的事件必须有清晰的命名规范（例如：chat:message, agent:intervention）。

3\. 关键的 AI 调用逻辑必须写在单独的 Service 层中。

4\. 提供代码时，请包含详细的中文注释，解释背后的业务逻辑。

