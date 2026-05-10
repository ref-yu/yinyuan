\# 项目背景：AI 交友 App 后端 API

这是一个为移动端（React Native）提供支持的后端 API。



\# 技术栈

\- 语言：TypeScript

\- 框架：Node.js, Express

\- 实时通讯：Socket.io

\- 数据库：PostgreSQL (预留 Prisma 和 pgvector 支持)



\# 开发规范

1\. 使用 ES Modules (import/export)。

2\. 所有 API 响应格式统一为：{ success: boolean, data?: any, error?: string }。

3\. 代码需包含详细的中文注释。

4\. Socket.io 服务需要配置跨域 (CORS) 允许所有来源 `\*` 用于本地开发测试。

