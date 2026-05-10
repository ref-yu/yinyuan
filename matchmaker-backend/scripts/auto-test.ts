import { io } from 'socket.io-client';
import { db } from '../src/db.js';

const SERVER_URL = 'http://localhost:8080';

// ANSI 颜色定义，用于清晰可见的测试进度
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log(`${YELLOW}==============================================${RESET}`);
  console.log(`${YELLOW}🚀 [AutoTest] 启动基于 socket.io-client 的集成测试${RESET}`);
  console.log(`${YELLOW}==============================================${RESET}`);

  // 清理可能存在的脏数据
  console.log(`${BLUE}[DB] 正在清理测试账号数据...${RESET}`);
  await db.user.deleteMany({
    where: { id: { in: ['Test_Boy_1', 'Test_Girl_1', 'Test_BadBoy'] } }
  });

  console.log(`${BLUE}[Socket] 正在建立与后端服务器的连接...${RESET}`);
  const client1 = io(SERVER_URL);
  const client2 = io(SERVER_URL);
  const client3 = io(SERVER_URL);

  await delay(1000); // 等待连接建立

  console.log(`${BLUE}[API] 触发 update:basic_info 提交测试客户端硬性条件...${RESET}`);
  // Client1: 男找女
  client1.emit('update:basic_info', { userId: 'Test_Boy_1', gender: '男', age: 25, lookingFor: '女' });
  // Client2: 女找男
  client2.emit('update:basic_info', { userId: 'Test_Girl_1', gender: '女', age: 24, lookingFor: '男' });
  // Client3 (捣乱海王): 男找女
  client3.emit('update:basic_info', { userId: 'Test_BadBoy', gender: '男', age: 26, lookingFor: '女' });

  // 延迟 1 秒，等待后端完成 upsert 数据库操作
  console.log(`${YELLOW}⏳ 等待档案入库...${RESET}`);
  await delay(1000);

  console.log(`${BLUE}[DB] 通过 Prisma 强行修改 confidenceScore，模拟 AI 测谎...${RESET}`);
  // Client1 和 Client2 设为真诚用户 (0.9)
  await db.user.updateMany({
    where: { id: { in: ['Test_Boy_1', 'Test_Girl_1'] } },
    data: { 
      confidenceScore: 0.9, 
      status: 'PENDING',
      mbti: 'INTJ',
      lifeExperience: '经历过挫折，渴望安定的生活',
      values: '真诚待人，注重内心交流'
    }
  });

  // Client3 捣乱海王设为低分 (0.2)
  await db.user.updateMany({
    where: { id: 'Test_BadBoy' },
    data: { 
      confidenceScore: 0.2, 
      status: 'PENDING',
      mbti: 'ESTP',
      lifeExperience: '游戏人间，寻找刺激',
      values: '敷衍了事，满嘴跑火车'
    }
  });

  console.log(`${YELLOW}⚡ [Match Engine] 触发全服匹配 (触发 user:check_status 唤醒扫描逻辑)...${RESET}`);
  
  // 设置 match:success 监听并包装成 Promise
  const matchPromises = [
    { id: 'Test_Boy_1', client: client1 },
    { id: 'Test_Girl_1', client: client2 },
    { id: 'Test_BadBoy', client: client3 }
  ].map(({ id, client }) => {
    return new Promise<void>((resolve) => {
      let isResolved = false;

      client.on('match:success', (data) => {
        if (isResolved) return;
        isResolved = true;
        console.log(`${GREEN}🎉 [Match:Success] 用户 ${id} 收到匹配成功！\n   👉 对方是: ${data.targetUserId}\n   📝 理由: ${data.matchReason}${RESET}\n`);
        resolve();
      });

      // 60 秒超时检测（因为调用千问大模型写小作文有时需要 20-40 秒）
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          console.log(`${RED}❌ [Timeout] 用户 ${id} 在 60 秒内未收到匹配通知，被拦截或在池中等待。${RESET}\n`);
          resolve();
        }
      }, 60000);
    });
  });

  // 触发后端的身份状态核验，这会把 PENDING 状态的用户推入大厅并触发 runGlobalMatchScan
  client1.emit('user:check_status', { userId: 'Test_Boy_1' });
  client2.emit('user:check_status', { userId: 'Test_Girl_1' });
  client3.emit('user:check_status', { userId: 'Test_BadBoy' });

  // 等待所有的 Match Promise (最长10秒执行时间)
  await Promise.all(matchPromises);

  console.log(`${YELLOW}==============================================${RESET}`);
  console.log(`${YELLOW}🏁 [AutoTest] 测试执行完毕，清理 Socket 连接。${RESET}`);
  console.log(`${YELLOW}==============================================${RESET}`);

  client1.disconnect();
  client2.disconnect();
  client3.disconnect();
  
  // 确保退出进程
  process.exit(0);
}

runTest().catch((error) => {
  console.error(`${RED}[Error] 测试脚本发生异常:`, error, RESET);
  process.exit(1);
});
