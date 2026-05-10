import OpenAI from 'openai';
import { db } from './db.js';
// 阿里云通义千问 (Qwen) 服务实现
export class QwenService {
    openai;
    constructor(apiKey) {
        // 实例化 OpenAI 客户端，将其 baseURL 设置为千问的兼容地址
        this.openai = new OpenAI({
            apiKey: apiKey,
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        });
    }
    async analyzeMessageVibe(message, history) {
        try {
            const systemPrompt = "你现在是一个“对话氛围分析师”。判断当前收到的消息是否包含脆弱/抱怨/兴奋等需要情绪价值的话语，或者生僻/特定的兴趣名词（电影、游戏、专业等）；同时判断该消息是否表示道别或结束对话（如“晚安”、“拜拜”、“去洗澡了”）。请严格以JSON格式输出，不要包含多余文本或Markdown代码块。\n如果不需要介入且未结束，输出：{\"shouldIntervene\": false, \"reason\": \"\", \"suggestPrompt\": \"\", \"isEnding\": false}。\n如果需要介入，输出：{\"shouldIntervene\": true, \"reason\": \"原因描述\", \"suggestPrompt\": \"提示AI僚机如何生成建议的话语，例如：对方提到了某游戏，请科普这是一款什么游戏，并建议询问最喜欢哪个角色\", \"isEnding\": false}。\n如果是结束语，输出：{\"shouldIntervene\": false, \"reason\": \"\", \"suggestPrompt\": \"\", \"isEnding\": true}。";
            const historyContext = history.length > 0 ? `最近的聊天记录如下：\n${history.join('\n')}` : "目前暂无聊天记录。";
            console.log(`[QwenService] 准备请求大模型 (分析情绪与氛围)...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `${historyContext}\n\n当前收到的消息：${message}\n\n请进行分析。` }
                ],
                temperature: 0.1, // 低温度以保证JSON格式和稳定性
            });
            const content = response.choices[0]?.message?.content || "{}";
            console.log(`[QwenService] 分析完成，返回数据:`, content);
            const cleanedContent = content.replace(/```json\n?|\n?```/g, '').trim();
            const result = JSON.parse(cleanedContent);
            return {
                shouldIntervene: !!result.shouldIntervene,
                reason: result.reason || "",
                suggestPrompt: result.suggestPrompt || "",
                isEnding: !!result.isEnding
            };
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 调用千问 API 失败 (分析情绪), 详细错误信息:");
            console.error(error);
            return { shouldIntervene: false, reason: "error", suggestPrompt: "", isEnding: false };
        }
    }
    async generateIcebreaker(chatHistory) {
        try {
            // 设定系统提示词，要求以幽默风趣的“人类僚机”口吻生成简短破冰话术
            const systemPrompt = "你现在是一个幽默风趣的“人类僚机”。你的任务是在聊天即将冷场时，用一句简短、搞笑、自然的话来破冰，缓解尴尬的气氛。请尽量口语化，不要像个机器人。";
            const historyContext = chatHistory.length > 0
                ? `最近的聊天记录如下：\n${chatHistory.join('\n')}`
                : "目前暂无聊天记录。";
            console.log(`[QwenService] 准备请求大模型...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus', // 指定的千问模型
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `${historyContext}\n\n请根据上面的对话情况，说一句破冰的话。` }
                ],
                temperature: 0.8, // 提高温度以增加幽默感和随机性
            });
            console.log(`[QwenService] 请求成功！返回数据:`, JSON.stringify(response.choices[0]?.message));
            return response.choices[0]?.message?.content || "哎呀，气氛突然安静，我都不知道说什么好了！";
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 调用千问 API 失败，详细错误信息:");
            console.error(error);
            if (error instanceof Error) {
                console.error(`Error Message: ${error.message}`);
                console.error(`Stack: ${error.stack}`);
            }
            return "（僚机去上厕所了，你们先聊...）";
        }
    }
    async generateIcebreakerStream(chatHistory, onChunk) {
        try {
            const systemPrompt = "你现在是一个幽默风趣的“人类僚机”。你的任务是在聊天即将冷场时，用一句简短、搞笑、自然的话来破冰，缓解尴尬的气氛。请尽量口语化，不要像个机器人。";
            const historyContext = chatHistory.length > 0
                ? `最近的聊天记录如下：\n${chatHistory.join('\n')}`
                : "目前暂无聊天记录。";
            console.log(`[QwenService] 准备请求大模型 (流式)...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `${historyContext}\n\n请根据上面的对话情况，说一句破冰的话。` }
                ],
                temperature: 0.8,
                stream: true,
            });
            for await (const chunk of response) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    onChunk(content);
                }
            }
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 调用千问 API 失败 (流式)，详细错误信息:");
            console.error(error);
            onChunk("（僚机去上厕所了，流式服务暂不可用...）");
        }
    }
    async generateSOSOptions(chatHistory, requesterId) {
        try {
            const systemPrompt = "你现在是一个幽默风趣的高情商“人类僚机”。你的任务是在用户遇到聊天瓶颈（SOS救场）时，提供3个不同风格（例如：幽默、真诚、反问）的高情商回复选项。请强制返回一个合法的JSON数组，包含这3个回复选项的字符串，例如：[\"选项1\", \"选项2\", \"选项3\"]。不要包含任何其他内容或Markdown代码块标记。";
            const historyContext = chatHistory.length > 0
                ? `最近的聊天记录如下：\n${chatHistory.join('\n')}`
                : "目前暂无聊天记录。";
            const requesterContext = requesterId ? `\n注意：当前向你求助的用户是 ${requesterId}，请你完全站在他的角度，生成可以直接发送给对方的话。` : "";
            console.log(`[QwenService] 准备请求大模型 (SOS救场)...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `${historyContext}${requesterContext}\n\n请根据上面的对话情况，提供3个SOS救场回复选项（严格JSON数组格式）。` }
                ],
                temperature: 0.8,
            });
            const content = response.choices[0]?.message?.content || "[]";
            console.log(`[QwenService] SOS救场请求成功！返回数据:`, content);
            // 解析 JSON，移除可能的 Markdown 标记
            const cleanedContent = content.replace(/```json\n?|\n?```/g, '').trim();
            const options = JSON.parse(cleanedContent);
            if (Array.isArray(options) && options.length > 0) {
                return options.map(String).slice(0, 3);
            }
            return ["（幽默）哎呀，我网卡了，你刚才说什么？", "（真诚）突然不知道该怎么接话了，但很想继续和你聊~", "（反问）哈哈，那你觉得呢？"];
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 调用千问 API 失败 (SOS救场)，详细错误信息:");
            console.error(error);
            return ["不好意思，僚机信号不好", "等我喝口水再聊", "这天聊得太热了"];
        }
    }
    async generateMiniGame() {
        try {
            const systemPrompt = "你现在是一个派针对游戏主持人。请生成一道有趣的二选一破冰测试题（例如：拥有超能力选隐身还是飞行？去荒岛带手机还是带刀？）。请严格以JSON格式输出，不要包含多余文本或Markdown代码块标记。格式示例：{\"question\": \"题目内容\", \"optionA\": \"选项A内容\", \"optionB\": \"选项B内容\"}。";
            console.log(`[QwenService] 准备请求大模型 (生成小游戏)...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `请生成一道有趣的二选一测试题。` }
                ],
                temperature: 0.9,
            });
            const content = response.choices[0]?.message?.content || "{}";
            console.log(`[QwenService] 游戏生成成功！返回数据:`, content);
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw new Error("JSON format not matched");
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 调用千问 API 失败 (生成小游戏)，详细错误信息:");
            console.error(error);
            return { question: "拥有超能力选隐身还是飞行？", optionA: "隐身", optionB: "飞行" };
        }
    }
    async extractMemories(text) {
        try {
            const systemPrompt = "你现在是一个红娘助手，负责从用户的聊天中提取值得记录的长期事实。如果用户提到了兴趣爱好、个人的雷区（反感的事物）、或者重要日程，请提取出来。请严格以JSON格式返回一个数组，数组每个元素包含 category（只能是：兴趣、雷区、重要日程）和 content（具体内容）。如果没有值得记录的事实，请返回空数组 []。不要包含多余的文本或 Markdown 标记。";
            console.log(`[QwenService] 准备请求大模型 (提取记忆事实)...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `请分析以下内容：\n\n${text}` }
                ],
                temperature: 0.1,
            });
            const content = response.choices[0]?.message?.content || "[]";
            console.log(`[QwenService] 记忆提取完成，返回数据:`, content);
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return [];
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 调用千问 API 失败 (提取记忆), 详细错误信息:");
            console.error(error);
            return [];
        }
    }
    async generateOnboardingChat(chatHistory) {
        try {
            const systemPrompt = "你是一个风趣的 AI 红娘，正在对新用户进行简短的性格面试。根据历史记录，抛出一个有趣的二选一或开放式问题，不要太官方，像朋友聊天。";
            const historyContext = chatHistory.length > 0
                ? `最近的聊天记录如下：\n${chatHistory.join('\n')}`
                : "目前暂无聊天记录。";
            console.log(`[QwenService] 准备请求大模型 (生成新手引导)...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `${historyContext}\n\n请向用户提问。` }
                ],
                temperature: 0.8,
            });
            return response.choices[0]?.message?.content || "哈喽！我是你的专属 AI 红娘。你平时喜欢宅在家里还是出去玩呀？";
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 调用千问 API 失败 (新手引导), 详细错误信息:");
            console.error(error);
            return "哈喽！网络好像开小差了，你平时喜欢宅在家里还是出去玩呀？";
        }
    }
    async extractProfileToDB(userId, chatHistory) {
        try {
            const systemPrompt = "分析聊天记录，提取用户的 MBTI、兴趣标签、雷区。强制输出 JSON。格式示例：{\"mbti\": \"ENFP\", \"interests\": [\"标签1\", \"标签2\"], \"dislikes\": [\"雷区1\"]}。如果没有明显特征，相关字段可为空或空数组。不要输出多余文本或 Markdown 标记。";
            const historyContext = chatHistory.join('\n');
            console.log(`[QwenService] 准备请求大模型 (提取用户画像)...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `聊天记录：\n${historyContext}\n\n请提取画像。` }
                ],
                temperature: 0.1,
            });
            const content = response.choices[0]?.message?.content || "{}";
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const profile = JSON.parse(jsonMatch[0]);
                console.log(`[QwenService] 提取到用户画像:`, profile);
                // 保存到数据库
                await db.user.upsert({
                    where: { id: userId },
                    update: {
                        mbti: profile.mbti || null,
                        interests: profile.interests && profile.interests.length > 0 ? JSON.stringify(profile.interests) : null
                    },
                    create: {
                        id: userId,
                        mbti: profile.mbti || null,
                        interests: profile.interests && profile.interests.length > 0 ? JSON.stringify(profile.interests) : null
                    }
                });
                if (profile.dislikes && Array.isArray(profile.dislikes)) {
                    for (const dislike of profile.dislikes) {
                        await db.memoryItem.create({
                            data: {
                                userId: userId,
                                category: '雷区',
                                content: dislike
                            }
                        });
                    }
                }
            }
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 提取画像或存库异常:");
            console.error(error);
        }
    }
    async findBestMatch(currentUser, candidates) {
        try {
            if (candidates.length === 0)
                return null;
            const systemPrompt = "你是顶尖红娘。请仔细对比 currentUser 的属性/雷区与候选人列表 candidates 的属性。选出一个最合适的，并生成一段给 currentUser 看的撮合话术（例如：“我给你挑了个硬核极客，你们都对科幻着迷，绝对有共同语言！”）。如果没有任何合适的人选，请返回 {\"matchedUserId\": \"nobody\", \"matchReason\": \"\"}。强制输出规范 JSON。格式示例：{\"matchedUserId\": \"目标ID\", \"matchReason\": \"撮合话术\"}。";
            console.log(`[QwenService] 准备请求大模型 (执行灵魂匹配)...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `currentUser: ${JSON.stringify(currentUser)}\ncandidates: ${JSON.stringify(candidates)}\n\n请进行匹配。` }
                ],
                temperature: 0.1,
            });
            const content = response.choices[0]?.message?.content || "{}";
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                if (result.matchedUserId && result.matchedUserId !== "nobody") {
                    console.log(`[QwenService] 匹配成功！选定用户: ${result.matchedUserId}`);
                    return result;
                }
                else {
                    return null; // 找不到合适的人选
                }
            }
            throw new Error("Invalid match result format");
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 调用千问 API 失败 (灵魂匹配), 详细错误信息:");
            console.error(error);
            return null;
        }
    }
    async generateEscalationCard(chatHistory) {
        try {
            const systemPrompt = "你是极其懂人性的顶尖红娘。发现这两个人聊得极其火热。请生成一段 50 字以内的话，用半开玩笑、极具推背感的语气，鼓励他们交换联系方式或者周末约出来见一面。例如：“聊得这么嗨，我都嫌你们打字慢了！周末刚好天气不错，不如顺水推舟约杯咖啡？”";
            const historyContext = chatHistory.length > 0
                ? `最近的聊天记录如下：\n${chatHistory.join('\n')}`
                : "目前暂无聊天记录。";
            console.log(`[QwenService] 准备请求大模型 (生成升温卡片)...`);
            const response = await this.openai.chat.completions.create({
                model: 'qwen3.6-plus',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `${historyContext}\n\n请生成升温话术。` }
                ],
                temperature: 0.8,
            });
            return response.choices[0]?.message?.content || "聊得这么嗨，不如周末约出去喝杯咖啡顺带交换个联系方式呀？";
        }
        catch (error) {
            console.error("\n[QwenService] ❌ 调用千问 API 失败 (生成升温卡片), 详细错误信息:");
            console.error(error);
            return "红娘我都觉得你们聊得太投机啦，要不要考虑交换个联系方式继续聊？";
        }
    }
}
// 用于本地测试的 Mock 服务（未配置 Key 时使用）
export class MockService {
    async analyzeMessageVibe(message, history) {
        console.log("[MockService] 正在模拟分析消息:", message);
        if (message.includes("晚安") || message.includes("拜拜")) {
            return { shouldIntervene: false, reason: "结束语", suggestPrompt: "", isEnding: true };
        }
        if (message.includes("电影") || message.includes("难过")) {
            return {
                shouldIntervene: true,
                reason: "包含电影或难过的关键词",
                suggestPrompt: "对方似乎提到了电影或有些难过，请适当安慰或顺着电影话题继续。",
                isEnding: false
            };
        }
        return { shouldIntervene: false, reason: "", suggestPrompt: "", isEnding: false };
    }
    async generateIcebreaker(chatHistory) {
        console.log("[MockService] 正在生成模拟的破冰话术，当前历史:", chatHistory);
        return "系统：哎呀，怎么都不说话了？是不是需要我给你们点个麦当劳？";
    }
    async generateIcebreakerStream(chatHistory, onChunk) {
        console.log("[MockService] 正在生成模拟的破冰话术 (流式)，当前历史:", chatHistory);
        const mockResponse = "系统：哎呀，怎么都不说话了？是不是需要我给你们点个麦当劳？";
        // 模拟流式输出
        for (const char of mockResponse) {
            onChunk(char);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    async generateSOSOptions(chatHistory, requesterId) {
        console.log(`[MockService] 正在生成模拟的SOS救场选项 (求助者: ${requesterId})，当前历史:`, chatHistory);
        return [
            "（幽默）我现在该表现得高冷一点，还是热情一点？在线等，挺急的！",
            "（真诚）聊得太开心了，我都忘了本来想说什么了。",
            "（反问）刚才聊到哪儿了？要不好你帮我回忆一下？"
        ];
    }
    async generateMiniGame() {
        console.log("[MockService] 正在生成模拟的小游戏题目");
        return { question: "拥有超能力选隐身还是飞行？", optionA: "隐身", optionB: "飞行" };
    }
    async extractMemories(text) {
        console.log("[MockService] 正在模拟提取记忆事实:", text);
        if (text.includes("喜欢") || text.includes("爱")) {
            return [{ category: "兴趣", content: "喜欢某些事物" }];
        }
        if (text.includes("讨厌") || text.includes("不吃")) {
            return [{ category: "雷区", content: "讨厌某些事物" }];
        }
        return [];
    }
    async generateOnboardingChat(chatHistory) {
        console.log("[MockService] 正在生成模拟的新手引导");
        return "哈喽！我是你的专属 AI 红娘。你平时喜欢宅在家里还是出去玩呀？";
    }
    async extractProfileToDB(userId, chatHistory) {
        console.log("[MockService] 正在模拟提取画像并存库:", userId);
        await db.user.upsert({
            where: { id: userId },
            update: { mbti: 'INFP', interests: JSON.stringify(['模拟兴趣']) },
            create: { id: userId, mbti: 'INFP', interests: JSON.stringify(['模拟兴趣']) }
        });
    }
    async findBestMatch(currentUser, candidates) {
        console.log("[MockService] 正在模拟执行灵魂匹配");
        if (candidates.length > 0) {
            return { matchedUserId: candidates[0].id, matchReason: "你们俩看起来挺般配的，聊聊看吧！" };
        }
        return null;
    }
    async generateEscalationCard(chatHistory) {
        console.log("[MockService] 正在生成模拟的升温卡片");
        return "聊得这么嗨，不如周末约出去喝杯咖啡顺带交换个联系方式呀？";
    }
}
// 工厂函数：根据环境变量自动选择服务实现
export function createAIService() {
    const apiKey = process.env.QWEN_API_KEY;
    if (apiKey) {
        console.log("[AIService] 检测到 QWEN_API_KEY，已初始化 Qwen 僚机服务。");
        return new QwenService(apiKey);
    }
    else {
        console.log("[AIService] 未配置 QWEN_API_KEY，已启动 Mock 僚机服务。");
        return new MockService();
    }
}
