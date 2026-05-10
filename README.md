# 姻缘 (YinYuan) - AI 恋爱交友匹配与破冰平台

本项目是一个基于 AI 驱动的 1v1 恋爱交友匹配平台。通过 AI 分析用户画像进行智能匹配，并在专属的 WebSockets 聊天室中，由 AI 僚机引导双方破冰、增进关系，提供全新的交友体验。

## 🚀 核心功能

- **智能匹配**：根据用户的个人信息和偏好，AI 后台进行精准的画像分析与匹配。
- **实时聊天室**：匹配成功的用户将进入专属 1v1 聊天室（基于 Socket.io 的低延迟通讯）。
- **AI 僚机破冰**：在聊天过程中，AI 助手将实时分析语境，在合适的时候提供话题建议、化解尴尬，帮助双方自然交流。

## 🛠️ 技术栈

本项目采用 Monorepo 结构，分为前端移动应用和后端 API 服务。

### 前端 (matchmaker-app)
- **框架**：React Native, Expo
- **语言**：TypeScript
- **网络通信**：Fetch API, Socket.io-client

### 后端 (matchmaker-backend)
- **环境**：Node.js
- **框架**：Express
- **实时通讯**：Socket.io
- **数据库**：PostgreSQL (预留 pgvector 支持), Prisma ORM (本地开发阶段使用 SQLite)
- **AI 引擎**：Qwen (通义千问) 等大语言模型服务

---

## 📂 目录结构

```text
yinyuan/
├── matchmaker-app/         # React Native (Expo) 前端应用
│   ├── assets/             # 静态资源 (图标, 模型文件等)
│   ├── App.tsx             # 应用入口
│   └── package.json
└── matchmaker-backend/     # Node.js + Express 后端服务
    ├── prisma/             # Prisma 数据库架构定义
    ├── src/                # 后端源代码 (API, AI服务, Socket逻辑)
    └── package.json
```

---

## 🏃 快速启动

在本地运行此项目，你需要先配置好 Node.js 和 npm 环境。

### 1. 启动后端 (Backend)

进入后端目录并安装依赖：
```bash
cd matchmaker-backend
npm install
```

配置环境变量：
复制一份环境变量配置文件，并填入你的 AI 密钥等信息：
```bash
cp .env.example .env
```
> **注意**：请在 `.env` 中正确配置 `QWEN_API_KEY` 以开启真实的 AI 僚机服务，否则系统将使用 Mock 服务。

同步本地数据库：
```bash
npx prisma db push
```

启动后端服务 (开发模式)：
```bash
npm run dev
```
后端服务默认将在 `http://localhost:3000` (或控制台输出的指定端口) 运行。

### 2. 启动前端 (Frontend)

进入前端目录并安装依赖：
```bash
cd matchmaker-app
npm install
```

启动 Expo 开发服务器：
```bash
npm run start
```
或者
```bash
npx expo start
```
你可以通过在手机上下载 Expo Go 应用程序，并扫描终端中生成的二维码来预览应用，或者按 `a` 在 Android 模拟器中打开，按 `i` 在 iOS 模拟器中打开。

---

## 📝 开发规范

- 语言统一使用 **TypeScript**。
- 所有的 API 请求响应格式保持一致：`{ success: boolean, data?: any, error?: string }`。
- Socket.io 事件使用清晰的命名规范（如：`chat:message`）。
- 提交代码前，请确保遵循本地的代码风格与规范。

## 🔒 隐私与安全
- **请勿将任何敏感的 `.env` 文件或数据库文件推送到此代码库中**。
- API 密钥需妥善保管。
