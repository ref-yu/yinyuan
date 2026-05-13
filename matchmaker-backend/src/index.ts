import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
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

// 根据规范 2 定义统一的 API 响应格式类型
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// 基础状态检查接口，返回标准的 JSON 格式
app.get('/api/health', (req, res) => {
  const response: ApiResponse = {
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

// 定义房间状态模型
interface RoomState {
  chatHistory: Array<{ senderId: string, text: string }>;
  silenceTimer: NodeJS.Timeout | null;
  lastSpeakerId: string | null;
  aiCooldowns: Map<string, number>;
  lastChatActivityTime: number;
  gameAnswers: Map<string, string>;
  isGreetingScheduled: boolean;
  messageTimestamps: number[];
  hasEscalated: boolean;
}

// 全局的活跃房间记录
const activeRooms = new Map<string, RoomState>();

// 初始化或获取房间状态
function getOrInitRoomState(roomId: string): RoomState {
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
  return activeRooms.get(roomId)!;
}

// 辅助函数：触发 AI 僚机并私密发送
async function triggerAIWingman(socket: Socket, roomId: string, reasonLog: string, extraPrompt?: string) {
  console.log(reasonLog);
  const state = activeRooms.get(roomId);
  if (!state) return;

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
  } catch (error) {
    console.error('[Socket] AI 僚机执行异常:', error);
    socket.emit('ai:suggestion:done'); // 异常时也发送结束事件防止前端卡住
  }
}

// 启动/重置沉默定时器
function resetSilenceTimer(socket: Socket, roomId: string) {
  const state = activeRooms.get(roomId);
  if (!state) return;

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
    } catch (error) {
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

// 辅助函数：生成固定的匹配房间号
function getMatchRoomId(id1: string, id2: string): string {
  const sortedIds = [id1, id2].sort();
  return `match_${sortedIds[0]}_${sortedIds[1]}`;
}

let isScanning = false;

async function runGlobalMatchScan() {
  if (isScanning) {
    console.log('[Match] 扫描引擎正在运行中，跳过本次触发...');
    return;
  }
  isScanning = true;
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

    // 不漏掉任何一人的算法：从等待最久（最靠前）的用户开始，遍历整个池子
    let unassignedUsers = [...pendingUsers];

    while (unassignedUsers.length >= 2) {
      // 取出等待最久的用户
      const currentUser = unassignedUsers.shift();
      if (!currentUser) break;

      const candidates = unassignedUsers.filter(u => {
        if (u.id === currentUser.id) return false; // 排除自己
        // 判断当前用户是否接受对方的性别
        const matchUserPreference = currentUser.lookingFor === '不限' || currentUser.lookingFor === u.gender;
        // 判断对方是否接受当前用户的性别
        const matchTargetPreference = u.lookingFor === '不限' || u.lookingFor === currentUser.gender;
        // 必须双向奔赴才算符合硬条件
        return matchUserPreference && matchTargetPreference;
      });

      if (candidates.length === 0) continue; // 如果硬过滤后没人了，直接跳过这个用户的 AI 匹配

      const matchResult = await aiService.findBestMatch(currentUser, candidates);

      if (matchResult && matchResult.matchedUserId && matchResult.matchedUserId !== "nobody") {
        const userAId = currentUser.id;
        const userBId = matchResult.matchedUserId;
        const newRoomId = getMatchRoomId(userAId, userBId);

        // 匹配成功原子化：在一个事务中更新状态、保存对方 ID，并创建 MatchRecord
        await db.$transaction([
          db.user.update({
            where: { id: userAId },
            data: { status: 'MATCHED', matchedWithId: userBId }
          }),
          db.user.update({
            where: { id: userBId },
            data: { status: 'MATCHED', matchedWithId: userAId }
          }),
          db.matchRecord.create({
            data: {
              userAId: userAId,
              userBId: userBId,
              matchReason: matchResult.matchReason
            }
          })
        ]);

        // 从候选池中剔除被选走的用户B
        unassignedUsers = unassignedUsers.filter(u => u.id !== userBId);

        // 实时通知：确保精准触达正在“等待大厅”刷手机的用户
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
      } else {
        console.log(`[Match] 用户 ${currentUser.id} 暂无合适候选人，继续在池中等待`);
      }
    }
  } catch (error) {
    console.error('[Match] 全局扫描引擎异常:', error);
  } finally {
    isScanning = false;
    console.log('[Match] 异步扫描引擎执行完毕，锁已释放。');
  }
}

// 监听 Socket.io 的连接事件
io.on('connection', (socket) => {
  console.log(`[Socket] 新客户端已连接，ID: ${socket.id}`);

  // 接收前端提交的基础档案
  socket.on('update:basic_info', async (data: { userId: string, gender: string, age: number, lookingFor: string }) => {
    try {
      const { userId, gender, age, lookingFor } = data;
      await db.user.upsert({
        where: { id: userId },
        update: {
          gender: String(gender),
          age: Number(age),
          lookingFor: String(lookingFor)
        },
        create: {
          id: userId,
          gender: String(gender),
          age: Number(age),
          lookingFor: String(lookingFor),
          status: 'ONBOARDING'
        }
      });
      console.log(`[档案建立] 用户 ${userId} 基础信息已入库`);
    } catch (err) {
      console.error(`[档案建立] 用户 ${data.userId} 基础信息入库异常:`, err);
    }
  });

  // 身份核验分流：检查是否已建档
  socket.on('user:check_status', async (data: { userId: string }) => {
    try {
      // 加入以用户 ID 命名的专属通知频道
      socket.join(`user_${data.userId}`);
      console.log(`[Socket] 用户 ${data.userId} 已加入个人频道 user_${data.userId}`);

      const user = await db.user.findUnique({
        where: { id: data.userId },
        include: { memories: true }
      });

      if (user && user.status === 'MATCHED' && user.matchedWithId) {
        // 使用 getMatchRoomId 函数生成唯一的房间号，并下发给前端
        const roomId = getMatchRoomId(data.userId, user.matchedWithId);
        socket.emit('user:status', { status: 'MATCHED', recommendRoom: roomId });
      } else if (user && user.status === 'PENDING') {
        // 告诉前端去 waiting 状态，并加入 match_hall_用户ID
        socket.emit('user:status', { status: 'PENDING', recommendRoom: `match_hall_${data.userId}` });
        runGlobalMatchScan();
      } else {
        // 纯新兵或 ONBOARDING 状态，分配到自己的新手村房间
        socket.emit('user:status', { status: 'ONBOARDING', recommendRoom: `room_0_${data.userId}` });
      }
    } catch (err) {
      console.error('[Socket] 用户状态核验异常:', err);
    }
  });

  // 监听客户端加入房间
  socket.on('join:room', async (roomId: string) => {
    console.log(`[Socket] 客户端 ${socket.id} 加入房间: ${roomId}`);
    socket.join(roomId);
    // 初始化房间状态
    const state = getOrInitRoomState(roomId);
    
    try {
      // 历史记录回溯：从数据库查询该 roomId 下最新的 50 条消息
      const messages = await db.chatMessage.findMany({
        where: { roomId },
        take: 50,
        orderBy: { createdAt: 'asc' }
      });
      
      const history = messages.map(m => ({ senderId: m.senderId, text: m.text }));
      
      // 更新内存状态（最多保留最近 MAX_HISTORY_LENGTH 条），供 AI 上下文使用
      if (history.length > 0) {
        state.chatHistory = history.slice(-MAX_HISTORY_LENGTH);
      }
      
      // 下发历史记录给前端
      socket.emit('room:history', history);
    } catch (err) {
      console.error('[Socket] 加载历史记录异常:', err);
      socket.emit('room:history', state.chatHistory);
    }

    console.log(`[新手村] 检查欢迎条件: roomId=${roomId}, starts=${roomId.startsWith('room_0_')}, historyLen=${state.chatHistory.length}, scheduled=${state.isGreetingScheduled}`);
    // 新手村欢迎问候
    if (roomId.startsWith('room_0_') && state.chatHistory.length === 0 && !state.isGreetingScheduled) {
      state.isGreetingScheduled = true; // 上锁防止并发重复打招呼
      setTimeout(() => {
        const welcomeMsg = { text: "Hi，我是你的专属情感分析师 🧠。在为你寻找命运的羁绊前，我想先测试一下你的‘依恋底色’：当你感到极度内耗或遇到重大挫折时，你是更希望立刻有一个人陪在身边倾听，还是更倾向于把自己关起来一个人消化？", senderId: 'ai-system' };
        state.chatHistory.push(welcomeMsg);
        io.to(roomId).emit('chat:message', welcomeMsg);
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
    const sender = typeof data === 'string' ? socket.id : (data.senderId || data.sender || socket.id);
    
    // 同步存库：将消息持久化到数据库
    db.chatMessage.create({
      data: {
        roomId,
        senderId: sender,
        text
      }
    }).catch(err => console.error('[Socket] 消息存库异常:', err));

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
          } catch (matchErr) {
            console.error('[Match] 匹配引擎异常:', matchErr);
          }
        });
      } else {
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
      } catch (error) {
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
    aiService.extractMemories(textTrimmed).then(async (memories: Array<{category: string, content: string}>) => {
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
        } catch (dbError) {
          console.error('[Memory] 存储记忆失败:', dbError);
        }
      }
    }).catch((err: any) => {
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
        const promises: Promise<void>[] = [];
        targetSockets.forEach((targetSocket) => {
          promises.push(triggerAIWingman(targetSocket as unknown as Socket, roomId, '[僚机] 正在给接收方递送专属提示纸条', vibeResult.suggestPrompt));
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
    } catch (error) {
      console.error('[Socket] SOS 救场执行异常:', error);
      // 可以在异常时给客户端返回备用选项
      socket.emit('ai:sos_reply', { 
        options: ["不好意思，僚机暂时离线了", "请稍后再试", "要不发个表情包吧"] 
      });
    }
  });

  // 监听双人默契测试客户端答案
  socket.on('game:answer', (data: { roomId: string, choice: 'A' | 'B' }) => {
    const roomId = data.roomId;
    if (!roomId) {
      console.error(`[Socket] game:answer 缺少 roomId`);
      return;
    }
    
    console.log(`[Socket] 收到客户端 ${socket.id} 的游戏选项: ${data.choice} (Room: ${roomId})`);
    
    const state = activeRooms.get(roomId);
    if (!state) return;

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
