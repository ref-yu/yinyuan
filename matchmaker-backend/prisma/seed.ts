import { db } from '../src/db.js';

async function main() {
  console.log('开始清理旧数据...');
  await db.memoryItem.deleteMany();
  await db.user.deleteMany();

  console.log('开始注入种子数据...');

  // 用户A (社牛玩家)
  const userA = await db.user.create({
    data: {
      id: 'socket_user_a',
      nickname: '社牛玩家',
      mbti: 'ESFP',
      interests: JSON.stringify(['派对', '剧本杀', '电音节']),
      memories: {
        create: [
          {
            category: '雷区',
            content: '闷葫芦'
          }
        ]
      }
    }
  });
  console.log(`创建用户: ${userA.nickname}`);

  // 用户B (文艺社恐)
  const userB = await db.user.create({
    data: {
      id: 'socket_user_b',
      nickname: '文艺社恐',
      mbti: 'INFP',
      interests: JSON.stringify(['黑胶唱片', '独立电影', '看书']),
      memories: {
        create: [
          {
            category: '兴趣',
            content: '极度慢热'
          }
        ]
      }
    }
  });
  console.log(`创建用户: ${userB.nickname}`);

  // 用户C (硬核极客)
  const userC = await db.user.create({
    data: {
      id: 'socket_user_c',
      nickname: '硬核极客',
      mbti: 'INTP',
      interests: JSON.stringify(['敲代码', '组装电脑', '科幻小说'])
    }
  });
  console.log(`创建用户: ${userC.nickname}`);

  console.log('数据库播种完成！');
}

main()
  .catch((e) => {
    console.error('播种过程发生错误:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
