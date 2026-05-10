import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { createAIService } from './ai-service.js'; // 依据规范，使用 ES Modules 导入需要 .js 后缀
import { db } from './db.js';
// 加载环境变量
dotenv.config();
// 初始化 Express 应用
const app = express();
// 基础中间件，用于解析 JSON 格式的请求体
app.use(express.json());
// 配置 CORS，允许前端应用跨域访问
app.use(cors());
// 基于 Express 创建 HTTP 服务器
const server = http.createServer(app);
// 初始化 Socket.io 服务
// 根据规范：配置跨域 (CORS) 允许所有来源 '*' 用于本地开发测试
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
// 基础状态检查接口，返回标准的 JSON 格式
app.get('/api/health', (req, res) => {
    const response = {
        success: true,
        data: { message: '服务器运行正常' }
    };
    res.json(response);
});
// ==========================================
// 聊天室状态与 AI 僚机集成
// ==========================================
// 初始化 AI 破冰僚机服务
const aiService = createAIService();
// 内存中维护一个简单的数组记录最近几条聊天消息
const MAX_HISTORY_LENGTH = 10;
// 全局的活跃房间记录
const activeRooms = new Map();
// 初始化或获取房间状态
function getOrInitRoomState(roomId) {
    if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, {
            chatHistory: [],
            silenceTimer: null,
            lastSpeakerId: null,
            aiCooldowns: new Map(),
            lastChatActivityTime: Date.now(),
            gameAnswers: new Map(),
            isGreetingScheduled: false,
            messageTimestamps: [],
            hasEscalated: false
        });
    }
    return activeRooms.get(roomId);
}
// 辅助函数：触发 AI 僚机并私密发送
async function triggerAIWingman(socket, roomId, reasonLog, extraPrompt) {
    console.log(reasonLog);
    const state = activeRooms.get(roomId);
    if (!state)
        return;
    try {
        // 如果有额外的提示词（如沉默提示），附加在历史记录末尾一起发给大模型
        const mappedHistory = state.chatHistory.map(m => `${m.senderId}: ${m.text}`);
        const historyToPass = extraPrompt ? [...mappedHistory, `系统提示: ${extraPrompt}`] : mappedHistory;
        // 开始流式输出前，先发送开始事件
        socket.emit('ai:suggestion:start');
        let fullText = '';
        await aiService.generateIcebreakerStream(historyToPass, (chunk) => {
            fullText += chunk;
            // 每次收到流式数据，就向专属目标发送
            socket.emit('ai:suggestion:chunk', { text: chunk });
        });
        // 流式输出结束，发送结束事件
        socket.emit('ai:suggestion:done');
        console.log(`[Socket] 已向客户端 ${socket.id} (房间: ${roomId}) 完整发送 AI 建议流:`, fullText);
    }
    catch (error) {
        console.error('[Socket] AI 僚机执行异常:', error);
        socket.emit('ai:suggestion:done'); // 异常时也发送结束事件防止前端卡住
    }
}
// 启动/重置沉默定时器
function resetSilenceTimer(socket, roomId) {
    const state = activeRooms.get(roomId);
    if (!state)
        return;
    // 核心 1：记住最后说话的人是谁
    state.lastSpeakerId = socket.id;
    if (state.silenceTimer) {
        clearTimeout(state.silenceTimer);
    }
    // 重新启动一个 30 秒的定时器
    state.silenceTimer = setTimeout(async () => {
        console.log(`[雷达] 触发高情商沉默救场 (房间: ${roomId})`);
        try {
            const historyToPass = [...state.chatHistory.map(m => `${m.senderId}: ${m.text}`), `系统提示: 对方已经等待了30秒没有收到回复，请给出一个自然接话的建议`];
            // 获取该房间内的所有 sockets
            const sockets = await io.in(roomId).fetchSockets();
            const targetSockets = sockets.filter(s => s.id !== state.lastSpeakerId);
            if (targetSockets.length > 0) {
                // 通知目标 Socket 开始流式接收
                targetSockets.forEach(targetSocket => {
                    targetSocket.emit('ai:suggestion:start');
                });
                let fullText = '';
                await aiService.generateIcebreakerStream(historyToPass, (chunk) => {
                    fullText += chunk;
                    targetSockets.forEach(targetSocket => {
                        targetSocket.emit('ai:suggestion:chunk', { text: chunk });
                    });
                });
                // 结束流式接收
                targetSockets.forEach(targetSocket => {
                    targetSocket.emit('ai:suggestion:done');
                    console.log(`[Socket] 高情商出击完毕：已向沉默的客户端 ${targetSocket.id} 递完纸条`);
                });
            }
        }
        catch (error) {
            console.error('[Socket] 沉默救场执行异常:', error);
            io.in(roomId).fetchSockets().then(sockets => {
                sockets.filter(s => s.id !== state.lastSpeakerId).forEach(targetSocket => {
                    targetSocket.emit('ai:suggestion:done');
                });
            });
        }
        state.silenceTimer = null;
    }, 30000); // 30000 毫秒 = 30秒
}
// ==========================================
// 全服 PENDING 异步扫描匹配引擎
// ==========================================
async function runGlobalMatchScan() {
    console.log('[Match] 正在执行全服 PENDING 异步扫描匹配...');
    try {
        const pendingUsers = await db.user.findMany({
            where: { status: 'PENDING' },
            include: { memories: true }
        });
        if (pendingUsers.length < 2) {
            console.log('[Match] PENDING 人数不足 2 人，跳过扫描。');
            return;
        }
        // 取出一个用户作为主体，尝试在剩余的 PENDING 用户中寻找匹配
        for (let i = 0; i < pendingUsers.length; i++) {
            const currentUser = pendingUsers[i];
            const candidates = pendingUsers.filter((_, idx) => idx !== i);
            const matchResult = await aiService.findBestMatch(currentUser, candidates);
            if (matchResult && matchResult.matchedUserId && matchResult.matchedUserId !== "nobody") {
                const userAId = currentUser.id;
                const userBId = matchResult.matchedUserId;
                const newRoomId = `match_${userAId}_${userBId}`;
                // 更新数据库状态为已匹配
                await db.user.updateMany({
                    where: { id: { in: [userAId, userBId] } },
                    data: { status: 'MATCHED' }
                });
                // 神级定向通知：通过个人频道告知双方
                io.to(`user_${userAId}`).emit('match:success', {
                    targetUserId: userBId,
                    newRoomId,
                    matchReason: matchResult.matchReason
                });
                io.to(`user_${userBId}`).emit('match:success', {
                    targetUserId: userAId,
                    newRoomId,
                    matchReason: matchResult.matchReason
                });
                console.log(`[Match] 异步扫描引擎成功撮合：${userAId} & ${userBId}`);
                // 一次扫描可以只撮合一对，也可以递归继续。这里为了效率先处理一对。
                break;
            }
        }
    }
    catch (error) {
        console.error('[Match] 全局扫描引擎异常:', error);
    }
}
// 监听 Socket.io 的连接事件
io.on('connection', (socket) => {
    console.log(`[Socket] 新客户端已连接，ID: ${socket.id}`);
    // 身份核验分流：检查是否已建档
    socket.on('user:check_status', async (data) => {
        try {
            // 加入以用户 ID 命名的专属通知频道
            socket.join(`user_${data.userId}`);
            console.log(`[Socket] 用户 ${data.userId} 已加入个人频道 user_${data.userId}`);
            const user = await db.user.findUnique({
                where: { id: data.userId },
                include: { memories: true }
            });
            if (user && user.memories && user.memories.length > 0) {
                // 已建档的老兵，直接去大厅
                socket.emit('user:status', { status: 'existing', recommendRoom: `match_hall_${data.userId}` });
            }
            else {
                // 纯新兵，分配到自己的新手村房间
                socket.emit('user:status', { status: 'new', recommendRoom: `room_0_${data.userId}` });
            }
        }
        catch (err) {
            console.error('[Socket] 用户状态核验异常:', err);
        }
    });
    // 监听客户端加入房间
    socket.on('join:room', (roomId) => {
        console.log(`[Socket] 客户端 ${socket.id} 加入房间: ${roomId}`);
        socket.join(roomId);
        // 初始化房间状态
        const state = getOrInitRoomState(roomId);
        // 下发历史记录
        socket.emit('room:history', state.chatHistory);
        // 新手村欢迎问候
        if (roomId.startsWith('room_0_') && state.chatHistory.length === 0 && !state.isGreetingScheduled) {
            state.isGreetingScheduled = true; // 上锁防止并发重复打招呼
            setTimeout(() => {
                const welcomeMsg = { text: "Hi！我是你的专属 AI 红娘 🪄。在把你推给别人之前，我得先摸摸你的底：如果周末有一整天完全属于你，你通常会在哪里、干什么？", senderId: 'system' };
                state.chatHistory.push(welcomeMsg);
                io.to(roomId).emit('chat:message', {
                    roomId: 'room_0',
                    ...welcomeMsg
                });
            }, 1000);
        }
    });
    // 接收客户端发来的 chat:message 事件
    socket.on('chat:message', async (data) => {
        // 兼容新旧格式提取 roomId
        const roomId = data.roomId;
        if (!roomId) {
            console.error(`[Socket] 收到的消息缺少 roomId:`, data);
            return;
        }
        const state = getOrInitRoomState(roomId);
        state.lastChatActivityTime = Date.now();
        console.log(`\n=============================================`);
        console.log(`[Socket] 第一时间收到消息 (ID: ${socket.id}, Room: ${roomId}):`, data);
        // 将消息广播给该房间内所有已连接的客户端
        io.to(roomId).emit('chat:message', data);
        // 完美解析文本：不管前端发来的是纯字符串，还是带有 text 属性的对象，统统拿下！
        const text = typeof data === 'string' ? data : (data.text || "");
        const sender = typeof data === 'string' ? socket.id : (data.sender || socket.id);
        // 记录聊天历史
        state.chatHistory.push({ senderId: sender, text });
        if (state.chatHistory.length > MAX_HISTORY_LENGTH) {
            state.chatHistory.shift(); // 保持数组在指定长度内
        }
        const now = Date.now();
        state.messageTimestamps.push(now);
        // 清理 60 秒之前的老时间戳（只保留最近 1 分钟的记忆）
        state.messageTimestamps = state.messageTimestamps.filter(t => now - t < 60000);
        // 触发条件：1分钟内超过 8 条消息，并且还没有触发过升温
        if (state.messageTimestamps.length >= 8 && !state.hasEscalated) {
            state.hasEscalated = true; // 立刻上锁
            console.log(`[升温探测] 房间 ${roomId} 气氛达到临界值，红娘准备破门而入！`);
            // 异步触发大模型，不阻塞当前聊天
            aiService.generateEscalationCard(state.chatHistory.map(m => `${m.senderId}: ${m.text}`))
                .then(cardText => {
                io.to(roomId).emit('ai:escalation', { text: cardText });
            })
                .catch(err => console.error('[升温探测] 生成卡片失败:', err));
        }
        const textTrimmed = text.trim();
        console.log(`[Socket] 正在判断是否触发AI... (提取出的文本内容: "${textTrimmed}")`);
        // 新手村无感建档逻辑拦截
        if (roomId.startsWith('room_0_')) {
            const userMessageCount = state.chatHistory.filter(msg => msg.senderId !== 'system').length;
            if (userMessageCount >= 3) {
                // 调用 extractProfileToDB 异步建档
                aiService.extractProfileToDB(sender, state.chatHistory.map(m => `${m.senderId}: ${m.text}`)).then(async () => {
                    socket.emit('onboarding:complete', { message: "你的灵魂画像已锁定，这就放你去相亲！" });
                    try {
                        // 建档完成后，将用户状态设置为 PENDING，加入匹配池
                        await db.user.update({
                            where: { id: sender },
                            data: { status: 'PENDING' }
                        });
                        // 触发全服异步扫描引擎
                        runGlobalMatchScan();
                    }
                    catch (matchErr) {
                        console.error('[Match] 匹配引擎异常:', matchErr);
                    }
                });
            }
            else {
                aiService.generateOnboardingChat(state.chatHistory.map(m => `${m.senderId}: ${m.text}`)).then(reply => {
                    const aiReplyData = { roomId, sender: 'system', text: reply };
                    socket.emit('chat:message', aiReplyData);
                    state.chatHistory.push({ senderId: 'system', text: reply });
                });
            }
            return;
        }
        // 监听 /game 指令用于触发双人默契测试
        if (textTrimmed === '/game') {
            console.log(`[Socket] 触发 /game 指令，开始生成双人默契测试小游戏... (Room: ${roomId})`);
            try {
                const gameData = await aiService.generateMiniGame();
                io.to(roomId).emit('game:start', gameData);
            }
            catch (error) {
                console.error('[Socket] 生成小游戏异常:', error);
            }
            return;
        }
        // 第一级雷达（沉默检测）：每次收到消息处理完后，重新启动定时器
        resetSilenceTimer(socket, roomId);
        // 获取接收方的 Socket ID (排除当前发送方)
        const socketsInRoom = await io.in(roomId).fetchSockets();
        const targetSockets = socketsInRoom.filter(s => s.id !== socket.id);
        const targetSocketId = targetSockets.length > 0 ? targetSockets[0].id : null;
        if (targetSocketId) {
            const lastTriggerTime = state.aiCooldowns.get(targetSocketId) || 0;
            if (Date.now() - lastTriggerTime < 15000) {
                console.log(`[雷达] 目标客户端 ${targetSocketId} 处于冷却中，跳过情绪分析`);
                return;
            }
        }
        // 第三级雷达（红娘记忆：异步提取事实并存入数据库）
        aiService.extractMemories(textTrimmed).then(async (memories) => {
            if (memories && memories.length > 0) {
                try {
                    // 确保发送消息的用户实体在数据库中存在
                    await db.user.upsert({
                        where: { id: sender },
                        update: {},
                        create: { id: sender }
                    });
                    // 插入提取到的记忆事实
                    for (const mem of memories) {
                        await db.memoryItem.create({
                            data: {
                                userId: sender,
                                category: mem.category,
                                content: mem.content,
                            }
                        });
                        console.log(`[Memory] 已为用户 ${sender} 记录新记忆 -> [${mem.category}] ${mem.content}`);
                    }
                }
                catch (dbError) {
                    console.error('[Memory] 存储记忆失败:', dbError);
                }
            }
        }).catch((err) => {
            console.error('[Memory] 提取记忆异常:', err);
        });
        // 第二级雷达（基于大模型的情绪与知识点前置拦截器）
        const analysisStartTime = Date.now();
        aiService.analyzeMessageVibe(textTrimmed, state.chatHistory.map(m => `${m.senderId}: ${m.text}`)).then(async (vibeResult) => {
            // 方案一：检测到结束语，取消沉默倒计时，并不再往下走
            if (vibeResult.isEnding) {
                console.log(`[雷达] 检测到结束语，取消沉默倒计时`);
                if (state.silenceTimer) {
                    clearTimeout(state.silenceTimer);
                    state.silenceTimer = null;
                }
                return;
            }
            if (vibeResult.shouldIntervene) {
                if (state.lastChatActivityTime > analysisStartTime) {
                    console.log('[拦截] 用户已自行接话，AI 主动销毁迟到的建议纸条');
                    return; // 直接中止，不要发送任何事件，也不要重启沉默定时器
                }
                console.log(`[雷达] 触发情绪/知识点介入，原因: ${vibeResult.reason}`);
                // 立刻清除现有的沉默定时器，让情绪雷达接管当前局面
                if (state.silenceTimer) {
                    clearTimeout(state.silenceTimer);
                    state.silenceTimer = null;
                }
                // 找到房间里不是发送者的那个用户
                const promises = [];
                targetSockets.forEach((targetSocket) => {
                    promises.push(triggerAIWingman(targetSocket, roomId, '[僚机] 正在给接收方递送专属提示纸条', vibeResult.suggestPrompt));
                    state.aiCooldowns.set(targetSocket.id, Date.now());
                });
                // 等待针对目标用户的流式下发完成
                await Promise.all(promises);
                // 重新给用户一个完整的 30 秒去阅读和反应
                resetSilenceTimer(socket, roomId);
            }
        }).catch(err => {
            console.error('[雷达] Vibe 分析失败:', err);
        });
    });
    // 监听客户端发来的 chat:sos 事件
    socket.on('chat:sos', async (data) => {
        const roomId = data?.roomId || Array.from(socket.rooms).find(r => r !== socket.id);
        console.log(`[Socket] 收到客户端 ${socket.id} 的 SOS 救场请求 (Room: ${roomId || '未知'})`);
        const state = roomId ? activeRooms.get(roomId) : null;
        const historyToPass = state ? state.chatHistory.map(m => `${m.senderId}: ${m.text}`) : [];
        try {
            const options = await aiService.generateSOSOptions(historyToPass, socket.id);
            socket.emit('ai:sos_reply', { options });
            console.log(`[Socket] 已向客户端 ${socket.id} 发送 SOS 救场选项:`, options);
        }
        catch (error) {
            console.error('[Socket] SOS 救场执行异常:', error);
            // 可以在异常时给客户端返回备用选项
            socket.emit('ai:sos_reply', {
                options: ["不好意思，僚机暂时离线了", "请稍后再试", "要不发个表情包吧"]
            });
        }
    });
    // 监听双人默契测试客户端答案
    socket.on('game:answer', (data) => {
        const roomId = data.roomId;
        if (!roomId) {
            console.error(`[Socket] game:answer 缺少 roomId`);
            return;
        }
        console.log(`[Socket] 收到客户端 ${socket.id} 的游戏选项: ${data.choice} (Room: ${roomId})`);
        const state = activeRooms.get(roomId);
        if (!state)
            return;
        state.gameAnswers.set(socket.id, data.choice);
        // 判断双方是否都已经作答
        if (state.gameAnswers.size === 2) {
            const answers = Array.from(state.gameAnswers.values());
            const isMatch = answers[0] === answers[1];
            console.log(`[Socket] 双方作答完毕，比对结果: 匹配? ${isMatch} (Room: ${roomId})`);
            io.to(roomId).emit('game:result', { isMatch });
            state.gameAnswers.clear(); // 清理状态准备下一局
        }
    });
    // 监听客户端断开连接
    socket.on('disconnect', () => {
        console.log(`[Socket] 客户端已断开，ID: ${socket.id}`);
        // 遍历清理空房间以及断开用户的状态缓存
        for (const [roomId, state] of activeRooms.entries()) {
            state.aiCooldowns.delete(socket.id);
            state.gameAnswers.delete(socket.id);
            // 判断是否可以销毁空房间
            io.in(roomId).fetchSockets().then(sockets => {
                if (sockets.length === 0) {
                    if (state.silenceTimer) {
                        clearTimeout(state.silenceTimer);
                    }
                    activeRooms.delete(roomId);
                    console.log(`[Socket] 房间 ${roomId} 已为空，销毁状态释放内存`);
                }
            }).catch(err => {
                console.error(`[Socket] 检查空房间异常:`, err);
            });
        }
    });
});
// 设置监听端口为 8080
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`[Server] 后端服务已启动，正在监听端口: ${PORT}`);
});
