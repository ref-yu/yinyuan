import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  FlatList, 
  SafeAreaView, 
  KeyboardAvoidingView, 
  Platform,
  ScrollView,
  Animated,
  Alert,
  Image,
  PanResponder,
  Dimensions
} from 'react-native';
import { io, Socket } from 'socket.io-client';
import { Ionicons } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';

// 定义中式色板
const CHINESE_COLORS = { 
  paper: '#FDF9EE', 
  dai: '#3D3B4F', 
  rouge: '#C04851', 
  ink: '#3A3131', 
  paleRouge: '#F9ECEC', 
  borderRouge: '#E8B4B8' 
};

// 🌟 定义红娘角色库
export interface MatchmakerPersona {
  id: string;
  name: string;
  avatar: string; // 用于聊天框或占位的头像
  lottieSource: any; // 用于悬浮互动的 Lottie 模型
  desc: string;
  greeting: string;
}

export const MATCHMAKERS: MatchmakerPersona[] = [
  {
    id: 'm1',
    name: '灵儿',
    avatar: 'https://api.dicebear.com/7.x/miniavs/png?seed=Linger&backgroundColor=fff59d',
    lottieSource: require('./assets/ling-model.json'),
    desc: '极简治愈系小仙子',
    greeting: '主人，我是你的专属红娘 灵儿~\n你可以把我拖拽到任意位置哦！'
  },
  {
    id: 'm2',
    name: '红袖',
    avatar: 'https://api.dicebear.com/7.x/miniavs/png?seed=Hongxiu&backgroundColor=ffdfdf',
    lottieSource: require('./assets/ling-model.json'), // 暂且公用模型，你后续可替换
    desc: '温婉知心大姐姐',
    greeting: '你好，我是红袖。\n我会一直在这里陪伴你。'
  },
  {
    id: 'm3',
    name: '飞燕',
    avatar: 'https://api.dicebear.com/7.x/miniavs/png?seed=Feiyan&backgroundColor=e0f7fa',
    lottieSource: require('./assets/ling-model.json'),
    desc: '又飒又俏国潮少女',
    greeting: '嗨！我是飞燕！\n有什么搞不定的场面就叫我！'
  }
];

// 定义消息的数据结构：区分我和对方及系统消息
interface Message {
  id: string;
  text: string;
  sender: 'me' | 'other' | 'system';
  senderId?: string; // 新增：用于判断特殊的红娘 AI 身份
  senderGender?: string; // 新增：用于根据性别渲染气泡颜色
}

const WaitingScreen = ({ matchmaker }: { matchmaker: MatchmakerPersona }) => {

  const fadeAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0.3,
          duration: 1500,
          useNativeDriver: true,
        })
      ])
    ).start();
  }, [fadeAnim]);

  return (
    <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: CHINESE_COLORS.paper }}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0.3, 1], outputRange: [10, -10] }) }] }}>
        <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', shadowColor: CHINESE_COLORS.rouge, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5, borderWidth: 3, borderColor: CHINESE_COLORS.paleRouge }}>
          <Image source={{ uri: matchmaker.avatar }} style={{ width: 90, height: 90, borderRadius: 45 }} />
        </View>
      </Animated.View>
      <Text style={{ fontSize: 18, fontWeight: '500', color: CHINESE_COLORS.ink, marginTop: 40, textAlign: 'center', paddingHorizontal: 30, lineHeight: 28 }}>
        千山万水，{matchmaker.name}正在为您寻觅良人...
      </Text>
    </SafeAreaView>
  );
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myUserId, setMyUserId] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  // 新增：用户选择的红娘状态
  const [selectedMatchmaker, setSelectedMatchmaker] = useState<MatchmakerPersona>(MATCHMAKERS[0]);
  
  // 动态房间状态（默认是新手村 room_0）
  const [currentRoomId, setCurrentRoomId] = useState('');
  
  // 新增：用于存储 AI 提供的回复建议及相关状态
  const [aiSuggestion, setAiSuggestion] = useState<string>('');
  const [isAiTyping, setIsAiTyping] = useState<boolean>(false);
  const [showSuggestion, setShowSuggestion] = useState<boolean>(false);

  // 新增：SOS 救场相关的状态
  const [sosOptions, setSosOptions] = useState<string[]>([]);
  const [isSosLoading, setIsSosLoading] = useState<boolean>(false);

  // 新增：双人默契测试状态
  const [activeGame, setActiveGame] = useState<{question: string, optionA: string, optionB: string} | null>(null);
  const [myChoice, setMyChoice] = useState<'A' | 'B' | null>(null);
  const [gameResult, setGameResult] = useState<{isMatch: boolean} | null>(null);

  // 新增：升温卡片状态
  const [escalationData, setEscalationData] = useState<string | null>(null);

  // 新增：用户流程状态
  const [appState, setAppState] = useState<'idle' | 'onboarding' | 'waiting' | 'chatting'>('idle');

  // 新增：基础资料状态
  const [basicInfo, setBasicInfo] = useState({ gender: '', age: '', lookingFor: '' });
  const [isBasicInfoDone, setIsBasicInfoDone] = useState(false);

  const handleSubmitBasicInfo = () => {
    if (!basicInfo.gender || !basicInfo.lookingFor || !basicInfo.age) return;
    const ageNum = parseInt(basicInfo.age, 10);
    if (isNaN(ageNum) || ageNum < 18 || ageNum > 100) {
      Alert.alert('提示', '请输入有效的真实年龄');
      return;
    }
    
    if (socket) {
      socket.emit('update:basic_info', {
        userId: myUserId,
        roomId: currentRoomId,
        gender: basicInfo.gender,
        age: basicInfo.age,
        lookingFor: basicInfo.lookingFor
      });
    }
    setIsBasicInfoDone(true);
  };

  // 用于自动滚动到底部
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    // 🌟 如果没登录，绝对不要连 Socket！
    if (!isLoggedIn) return;
    // 组件加载时连接到 Socket.IO 服务器 (保留原有 IP)
    const newSocket = io('http://192.168.101.117:8080');
    setSocket(newSocket);

    // 监听连接成功事件
    newSocket.on('connect', () => {
      console.log('已连接到服务器:', newSocket.id, '当前业务身份:', myUserId);
      // 核心修改：连接后不再盲目加入新手村，而是向后端请示身份
      newSocket.emit('user:check_status', { userId: myUserId });
    });

    // 新增：监听后端返回的身份分流结果
    newSocket.on('user:status', (data: { status: 'new' | 'existing', recommendRoom: string }) => {
      // 订阅专属通知频道，以便接收后台强拉匹配通知
      newSocket.emit('join:room', `user_${myUserId}`);

      if (data.recommendRoom) {
        setCurrentRoomId(data.recommendRoom);
        newSocket.emit('join:room', data.recommendRoom);
      }

      if (data.status === 'new') {
        // 1. 新用户：进入新手村 onboarding 流程（此时可以和 AI 聊天构建画像）
        setAppState('onboarding');
      } else if (data.status === 'existing') {
        // 2. 老用户：根据 recommendRoom 明确区分“等待大厅”和“正式聊天室”
        if (!data.recommendRoom || data.recommendRoom === 'waiting_room' || data.recommendRoom.startsWith('room_0')) {
          // 如果没有分配房间，或者是等待大厅/新手村的遗留 ID，则进入等待大厅展示雷达
          setAppState('waiting');
        } else {
          // 如果分配了其他的具体房间（比如 match_xxx），则直接进入正式聊天室
          setAppState('chatting'); 
          setMessages([
            {
              id: 'welcome-back',
              text: "✨ 欢迎回来！你已进入正式聊天室，继续你们的聊天吧。",
              sender: 'system'
            }
          ]);
        }
      }
    });

    // 监听房间历史记录并覆盖当前消息列表
    newSocket.on('room:history', (history: any[]) => {
      if (Array.isArray(history)) {
        setMessages(history);
      }
    });

    // 监听收到的普通聊天消息
    newSocket.on('chat:message', (data: any) => {
      // 兼容处理：支持纯字符串或带有 senderId 的对象
      const text = typeof data === 'string' ? data : data.text;
      const senderId = typeof data === 'string' ? null : data.senderId;
      const senderGender = typeof data === 'string' ? undefined : data.senderGender;

      // 如果发现这条消息是自己刚刚发送的（基于 socket.id 匹配），则忽略，防止重复显示
      if (senderId && senderId === myUserId) {
        return;
      }

      setMessages((prevMessages) => [
        ...prevMessages, 
        { 
          id: Date.now().toString() + Math.random(), 
          text: String(text), 
          sender: 'other',
          senderId,
          senderGender // 保存对方的性别用于渲染颜色
        }
      ]);
    });

    // 监听 AI 僚机流式输出开始
    newSocket.on('ai:suggestion:start', () => {
      setAiSuggestion('');
      setShowSuggestion(true);
      setIsAiTyping(true);
    });

    // 监听 AI 僚机流式输出数据块
    newSocket.on('ai:suggestion:chunk', (data: any) => {
      const text = typeof data === 'string' ? data : data.text;
      if (text) {
        setAiSuggestion((prev) => prev + String(text));
      }
    });

    // 监听 AI 僚机流式输出结束
    newSocket.on('ai:suggestion:done', () => {
      setIsAiTyping(false);
    });

    // 监听 SOS 救场回复
    newSocket.on('ai:sos_reply', (data: any) => {
      if (data && data.options) {
        setSosOptions(data.options);
      }
      setIsSosLoading(false);
    });

    // 新增：监听双人默契测试开始
    newSocket.on('game:start', (data: any) => {
      setActiveGame(data);
      setMyChoice(null);
      setGameResult(null);
    });

    // 新增：监听双人默契测试结果
    newSocket.on('game:result', (data: any) => {
      setGameResult(data);
      setTimeout(() => {
        setActiveGame(null);
        setGameResult(null);
      }, 4000);
    });

    // 新增：监听升温事件
    newSocket.on('ai:escalation', (data: any) => {
      setEscalationData(data.text);
    });

    // 新增：监听 onboarding 完成事件
    newSocket.on('onboarding:complete', () => {
      // 转场动效强化：插入特殊的系统消息，并延迟 2 秒进入 waiting 状态
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          id: Date.now().toString() + Math.random(),
          text: '✨ 灵魂底色解析完毕，正在为您生成专属多维画像...',
          sender: 'system'
        }
      ]);
      
      setTimeout(() => {
        setAppState(prev => prev === 'onboarding' ? 'waiting' : prev);
      }, 2000);
    });

    // 新增：监听匹配成功事件并进行转场逻辑
    newSocket.on('match:success', (data: any) => {
      setAppState('chatting');
      if (data && data.newRoomId) {
        // 1. 加入新房间
        newSocket.emit('join:room', data.newRoomId);
        // 2. 更新状态
        setCurrentRoomId(data.newRoomId);
        // 3. 清空原本新手村的聊天记录，并展示红娘特殊系统气泡
        setMessages([
          {
            id: Date.now().toString() + Math.random(),
            text: `✨ 红娘牵线：${data.matchReason || '你们的缘分已到，快开始聊天吧！'}`,
            sender: 'system'
          }
        ]);
      }
    });

    // 组件卸载时断开连接，防止内存泄漏
    return () => {
      newSocket.disconnect();
    };
  }, [isLoggedIn, myUserId]);

  const sendMessage = () => {
    if (inputText.trim() === '') return;

    // 将消息添加到本地列表进行显示
    const newMessage: Message = {
      id: Date.now().toString() + Math.random(),
      text: inputText,
      sender: 'me',
      senderGender: basicInfo.gender, // 携带自己的性别
    };
    setMessages((prevMessages) => [...prevMessages, newMessage]);

    // 将消息发送到服务器（附带 senderId 和 senderGender）
    if (socket) {
      socket.emit('chat:message', { 
        roomId: currentRoomId, 
        text: inputText, 
        senderId: myUserId,
        senderGender: basicInfo.gender
      });
    }

    // 清空输入框内容，并隐藏/清空AI建议和SOS选项
    setInputText('');
    setAiSuggestion('');
    setShowSuggestion(false);
    setSosOptions([]);
  };

  // 点击 AI 建议标签时的处理逻辑
  const handleUseSuggestion = () => {
    if (!isAiTyping && aiSuggestion) {
      // 将建议文本填充到输入框中，供用户进一步修改
      setInputText(aiSuggestion);
      // 点击后立刻隐藏建议卡片
      setAiSuggestion('');
      setShowSuggestion(false);
    }
  };

  // 点击 SOS 按钮的处理逻辑
  const handleSOS = () => {
    if (socket && !isSosLoading) {
      setIsSosLoading(true);
      socket.emit('chat:sos', { roomId: currentRoomId });
    }
  };

  // 点击 SOS 选项的处理逻辑
  const handleSelectSosOption = (option: string) => {
    setInputText(option);
    setSosOptions([]); // 点击后隐藏选项
  };

  // 处理游戏选项选择
  const handleGameChoice = (choice: 'A' | 'B') => {
    if (!myChoice && !gameResult && socket) {
      setMyChoice(choice);
      socket.emit('game:answer', { roomId: currentRoomId, choice });
    }
  };

  // 渲染单条消息的组件
  const renderItem = ({ item }: { item: Message }) => {
    // 识别特殊的红娘 AI 系统消息并渲染专属样式
    if (item.senderId === 'ai-system') {
      return (
        <View style={[styles.aiSystemMessageContainer, { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-start' }]}>
          <Image source={{ uri: selectedMatchmaker.avatar }} style={{ width: 40, height: 40, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: CHINESE_COLORS.paleRouge, backgroundColor: '#fff' }} />
          <View style={[styles.aiSystemMessageBubble, { borderTopLeftRadius: 4 }]}>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.aiSystemMessageName}>🏮 {selectedMatchmaker.name} (红娘)</Text>
              <Text style={styles.aiSystemMessageText}>{item.text}</Text>
            </View>
          </View>
        </View>
      );
    }

    // 原有的普通系统消息
    if (item.sender === 'system') {
      return (
        <View style={styles.systemMessageContainer}>
          <Text style={styles.systemMessageText}>{item.text}</Text>
        </View>
      );
    }

    const isMe = item.sender === 'me';
    
    // 核心颜色逻辑：根据性别决定背景色
    let backgroundColor = '#888888';
    if (item.senderGender === '男') backgroundColor = CHINESE_COLORS.dai;
    if (item.senderGender === '女') backgroundColor = CHINESE_COLORS.rouge;

    // 核心位置逻辑：根据 isMe 决定对齐和圆角
    const positionStyle = isMe ? {
      alignSelf: 'flex-end',
      borderBottomRightRadius: 4,
    } as const : {
      alignSelf: 'flex-start',
      borderBottomLeftRadius: 4,
    } as const;

    return (
      <View style={[styles.messageBubble, positionStyle, { backgroundColor }]}>
        <Text style={styles.messageText}>
          {item.text}
        </Text>
      </View>
    );
  };

  const renderWaitingScreen = () => {
    return <WaitingScreen matchmaker={selectedMatchmaker} />;
  };

  // 🌟 临时预览模式：用于在一个页面展示所有 UI 状态
  const PREVIEW_MODE = true;
  if (PREVIEW_MODE) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: '#E0E0E0' }} contentContainerStyle={{ paddingBottom: 50 }}>
        <Text style={{ textAlign: 'center', paddingVertical: 15, fontSize: 16, color: '#333' }}>↓ 1. 寻缘阁 (登录) ↓</Text>
        <View style={{ height: 400, backgroundColor: CHINESE_COLORS.paper, overflow: 'hidden' }}>
          <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
            <Ionicons name="rose-outline" size={60} color={CHINESE_COLORS.rouge} style={{ marginBottom: 20 }} />
            <Text style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 10, color: CHINESE_COLORS.ink }}>🏮 寻缘阁 🏮</Text>
            <Text style={{ fontSize: 14, color: '#666', marginBottom: 40, textAlign: 'center', lineHeight: 24 }}>请输入你的缘分代号，{'\n'}开启宿命相遇</Text>
            <TextInput
              style={{ width: '100%', height: 55, backgroundColor: '#FFF', borderRadius: 12, paddingHorizontal: 15, fontSize: 16, borderWidth: 1, borderColor: CHINESE_COLORS.borderRouge, marginBottom: 25, color: CHINESE_COLORS.ink, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}
              placeholder="例如：青梅、竹马"
              placeholderTextColor="#999"
              editable={false}
            />
            <View style={{ backgroundColor: CHINESE_COLORS.rouge, width: '100%', height: 55, borderRadius: 12, justifyContent: 'center', alignItems: 'center', shadowColor: CHINESE_COLORS.rouge, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4 }}>
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 }}>开启寻缘之旅</Text>
            </View>
          </SafeAreaView>
        </View>

        <Text style={{ textAlign: 'center', paddingVertical: 15, fontSize: 16, color: '#333' }}>↓ 2. 结缘灵帖 (基础档案) ↓</Text>
        <View style={{ height: 600, backgroundColor: CHINESE_COLORS.paper, overflow: 'hidden' }}>
          <SafeAreaView style={styles.container}>
            <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: CHINESE_COLORS.paper }}>
              <Ionicons name="flower-outline" size={50} color={CHINESE_COLORS.rouge} style={{ alignSelf: 'center', marginBottom: 15 }} />
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: CHINESE_COLORS.ink, marginBottom: 15, textAlign: 'center' }}>📜 结缘灵帖</Text>
              <Text style={{ color: '#666', marginBottom: 35, textAlign: 'center', lineHeight: 22 }}>在红线牵起之前，{'\n'}请先留下你的基础印记。</Text>
              
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: CHINESE_COLORS.ink, marginBottom: 8, fontWeight: '600' }}>你的性别</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, marginHorizontal: 5, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: CHINESE_COLORS.rouge, backgroundColor: CHINESE_COLORS.paleRouge, alignItems: 'center' }}><Text style={{ color: CHINESE_COLORS.rouge }}>男</Text></View>
                  <View style={{ flex: 1, marginHorizontal: 5, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#FFF', alignItems: 'center' }}><Text style={{ color: '#666' }}>女</Text></View>
                  <View style={{ flex: 1, marginHorizontal: 5, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#FFF', alignItems: 'center' }}><Text style={{ color: '#666' }}>其他</Text></View>
                </View>
              </View>

              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: CHINESE_COLORS.ink, marginBottom: 8, fontWeight: '600' }}>年龄</Text>
                <View style={{ backgroundColor: '#FFF', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#CCC' }}><Text style={{ color: '#333' }}>25</Text></View>
              </View>

              <View style={{ marginBottom: 35 }}>
                <Text style={{ color: CHINESE_COLORS.ink, marginBottom: 8, fontWeight: '600' }}>期望遇见的性别</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, marginHorizontal: 5, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#FFF', alignItems: 'center' }}><Text style={{ color: '#666' }}>男</Text></View>
                  <View style={{ flex: 1, marginHorizontal: 5, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: CHINESE_COLORS.rouge, backgroundColor: CHINESE_COLORS.paleRouge, alignItems: 'center' }}><Text style={{ color: CHINESE_COLORS.rouge }}>女</Text></View>
                  <View style={{ flex: 1, marginHorizontal: 5, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#FFF', alignItems: 'center' }}><Text style={{ color: '#666' }}>不限</Text></View>
                </View>
              </View>

              <View style={{ backgroundColor: CHINESE_COLORS.rouge, padding: 15, borderRadius: 8, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>开始灵魂深潜</Text>
              </View>
            </View>
          </SafeAreaView>
        </View>

        <Text style={{ textAlign: 'center', paddingVertical: 15, fontSize: 16, color: '#333' }}>↓ 3. 寻缘中 (等待) ↓</Text>
        <View style={{ height: 300, backgroundColor: CHINESE_COLORS.paper, overflow: 'hidden' }}>
          <WaitingScreen matchmaker={selectedMatchmaker} />
        </View>

        <Text style={{ textAlign: 'center', paddingVertical: 15, fontSize: 16, color: '#333' }}>↓ 4. 缘分茶室 (聊天与红娘) ↓</Text>
        <View style={{ height: 600, backgroundColor: CHINESE_COLORS.paper, overflow: 'hidden' }}>
          <SafeAreaView style={styles.container}>
            <View style={styles.header}><Text style={styles.headerTitle}>🏮 缘分茶室 🏮</Text></View>
            <View style={{ flex: 1, padding: 15 }}>
              <View style={styles.systemMessageContainer}><Text style={styles.systemMessageText}>✨ 红娘牵线：你们的缘分已到，快开始聊天吧！</Text></View>
              
              <View style={[styles.messageBubble, { alignSelf: 'flex-end', borderBottomRightRadius: 4, backgroundColor: CHINESE_COLORS.dai }]}><Text style={styles.messageText}>你好，我也很期待这次相遇</Text></View>
              <View style={[styles.messageBubble, { alignSelf: 'flex-start', borderBottomLeftRadius: 4, backgroundColor: CHINESE_COLORS.rouge }]}><Text style={styles.messageText}>看你档案里写喜欢去海边</Text></View>
              
              <View style={[styles.aiSystemMessageContainer, { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-start' }]}>
                <Image source={{ uri: selectedMatchmaker.avatar }} style={{ width: 40, height: 40, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: CHINESE_COLORS.paleRouge, backgroundColor: '#fff' }} />
                <View style={[styles.aiSystemMessageBubble, { borderTopLeftRadius: 4 }]}>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={styles.aiSystemMessageName}>🏮 {selectedMatchmaker.name} (红娘)</Text>
                    <Text style={styles.aiSystemMessageText}>建议聊聊上次去海边发生的趣事哦~</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={[styles.suggestionCard, { display: 'flex' }]}>
              <View style={styles.suggestionAvatarContainer}>
                <Image source={{ uri: selectedMatchmaker.avatar }} style={styles.suggestionAvatar} />
              </View>
              <Text style={styles.suggestionLabel}>🏮 {selectedMatchmaker.name}的小锦囊 (点击采纳)</Text>
              <Text style={styles.suggestionText}>我上次去三亚潜水，感觉特别棒！你喜欢潜水吗？</Text>
            </View>

            <View style={styles.inputContainer}>
              <TextInput style={styles.input} placeholder="落笔写下心声..." placeholderTextColor="#999" editable={false} />
              <View style={styles.sosButton}><Ionicons name="leaf-outline" size={24} color={CHINESE_COLORS.rouge} /></View>
              <View style={styles.sendButton}><Ionicons name="paper-plane-outline" size={20} color="#FFF" /></View>
            </View>
          </SafeAreaView>
        </View>
      </ScrollView>
    );
  }

  // 🌟 核心修改：如果没登录，直接返回这个登录界面
  if (!isLoggedIn) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Ionicons name="rose-outline" size={60} color={CHINESE_COLORS.rouge} style={{ marginBottom: 20 }} />
        <Text style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 10, color: CHINESE_COLORS.ink }}>🏮 寻缘阁 🏮</Text>
        <Text style={{ fontSize: 14, color: '#666', marginBottom: 40, textAlign: 'center', lineHeight: 24 }}>请输入你的缘分代号，{'\n'}开启宿命相遇</Text>
        
        <TextInput
          style={{ width: '100%', height: 55, backgroundColor: '#FFF', borderRadius: 12, paddingHorizontal: 15, fontSize: 16, borderWidth: 1, borderColor: CHINESE_COLORS.borderRouge, marginBottom: 25, color: CHINESE_COLORS.ink, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}
          placeholder="例如：青梅、竹马"
          placeholderTextColor="#999"
          value={myUserId}
          onChangeText={setMyUserId}
        />
        
        <TouchableOpacity
          style={{ backgroundColor: CHINESE_COLORS.rouge, width: '100%', height: 55, borderRadius: 12, justifyContent: 'center', alignItems: 'center', shadowColor: CHINESE_COLORS.rouge, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4 }}
          onPress={() => { if (myUserId.trim()) setIsLoggedIn(true); }}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 }}>开启寻缘之旅</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // 等待页面分流
  if (appState === 'waiting') {
    return renderWaitingScreen();
  }

  if (appState === 'onboarding' && !isBasicInfoDone) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView 
          style={styles.container} 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: CHINESE_COLORS.paper }}>
            <Ionicons name="flower-outline" size={50} color={CHINESE_COLORS.rouge} style={{ alignSelf: 'center', marginBottom: 15 }} />
            <Text style={{ fontSize: 24, fontWeight: 'bold', color: CHINESE_COLORS.ink, marginBottom: 15, textAlign: 'center' }}>
              📜 结缘灵帖
            </Text>
            <Text style={{ color: '#666', marginBottom: 35, textAlign: 'center', lineHeight: 22 }}>
              在红线牵起之前，{'\n'}请先留下你的基础印记。
            </Text>
            
            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: CHINESE_COLORS.ink, marginBottom: 8, fontWeight: '600' }}>你的性别</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {['男', '女', '其他'].map(g => (
                  <TouchableOpacity
                    key={g}
                    style={{ flex: 1, marginHorizontal: 5, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: basicInfo.gender === g ? CHINESE_COLORS.rouge : '#CCC', backgroundColor: basicInfo.gender === g ? CHINESE_COLORS.paleRouge : '#FFF', alignItems: 'center' }}
                    onPress={() => setBasicInfo({...basicInfo, gender: g})}
                  >
                    <Text style={{ color: basicInfo.gender === g ? CHINESE_COLORS.rouge : '#666' }}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: CHINESE_COLORS.ink, marginBottom: 8, fontWeight: '600' }}>年龄</Text>
              <TextInput
                style={{ backgroundColor: '#FFF', color: CHINESE_COLORS.ink, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#CCC' }}
                placeholder="请输入年龄"
                placeholderTextColor="#999"
                keyboardType="numeric"
                value={basicInfo.age}
                onChangeText={text => setBasicInfo({...basicInfo, age: text})}
              />
            </View>

            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: CHINESE_COLORS.ink, marginBottom: 8, fontWeight: '600' }}>期望遇见的性别</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {['男', '女', '不限'].map(g => (
                  <TouchableOpacity
                    key={g}
                    style={{ flex: 1, marginHorizontal: 5, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: basicInfo.lookingFor === g ? CHINESE_COLORS.rouge : '#CCC', backgroundColor: basicInfo.lookingFor === g ? CHINESE_COLORS.paleRouge : '#FFF', alignItems: 'center' }}
                    onPress={() => setBasicInfo({...basicInfo, lookingFor: g})}
                  >
                    <Text style={{ color: basicInfo.lookingFor === g ? CHINESE_COLORS.rouge : '#666' }}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ marginBottom: 35 }}>
              <Text style={{ color: CHINESE_COLORS.ink, marginBottom: 8, fontWeight: '600' }}>选择专属红娘</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 5 }}>
                {MATCHMAKERS.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => setSelectedMatchmaker(m)}
                    style={{
                      width: 110,
                      marginRight: 10,
                      padding: 10,
                      borderRadius: 12,
                      borderWidth: 2,
                      borderColor: selectedMatchmaker.id === m.id ? CHINESE_COLORS.rouge : '#E8E8E8',
                      backgroundColor: selectedMatchmaker.id === m.id ? CHINESE_COLORS.paleRouge : '#FFF',
                      alignItems: 'center',
                      shadowColor: selectedMatchmaker.id === m.id ? CHINESE_COLORS.rouge : '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: selectedMatchmaker.id === m.id ? 0.2 : 0.05,
                      shadowRadius: 3,
                      elevation: 2,
                    }}
                  >
                    <Image source={{ uri: m.avatar }} style={{ width: 44, height: 44, borderRadius: 22, marginBottom: 8, borderWidth: 1, borderColor: '#EEE' }} />
                    <Text style={{ fontSize: 14, fontWeight: 'bold', color: CHINESE_COLORS.ink, marginBottom: 4 }}>{m.name}</Text>
                    <Text style={{ fontSize: 10, color: '#666', textAlign: 'center', lineHeight: 14 }}>{m.desc}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <TouchableOpacity
              style={{ backgroundColor: CHINESE_COLORS.rouge, padding: 15, borderRadius: 8, alignItems: 'center', opacity: (!basicInfo.gender || !basicInfo.age || !basicInfo.lookingFor) ? 0.5 : 1 }}
              disabled={!basicInfo.gender || !basicInfo.age || !basicInfo.lookingFor}
              onPress={handleSubmitBasicInfo}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>开始灵魂深潜</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    // 使用 SafeAreaView 保证在带有刘海屏的手机上顶部显示正常
    <SafeAreaView style={styles.container}>
      {/* 使用 KeyboardAvoidingView 避免键盘弹出时遮挡输入框 */}
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* 顶部标题栏 */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            🏮 缘分茶室 🏮
          </Text>
        </View>

        {/* 双人默契测试卡片区域（浮现在消息列表上方） */}
        <View style={[styles.gameCard, { display: activeGame ? 'flex' : 'none' }]}>
          {activeGame && (
            <>
              <Text style={styles.gameTitle}>💕 双人默契测试</Text>
              <Text style={styles.gameQuestion}>{activeGame.question}</Text>
              
              {!gameResult ? (
                <View style={styles.gameOptionsContainer}>
                  <TouchableOpacity
                    style={[
                      styles.gameOptionButton, 
                      myChoice === 'A' && styles.gameOptionSelected,
                      myChoice && myChoice !== 'A' && styles.gameOptionDisabled
                    ]}
                    onPress={() => handleGameChoice('A')}
                    disabled={!!myChoice}
                  >
                    <Text style={[
                      styles.gameOptionText,
                      myChoice === 'A' && styles.gameOptionTextSelected,
                      myChoice && myChoice !== 'A' && styles.gameOptionTextDisabled
                    ]}>{activeGame.optionA}</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[
                      styles.gameOptionButton, 
                      myChoice === 'B' && styles.gameOptionSelected,
                      myChoice && myChoice !== 'B' && styles.gameOptionDisabled
                    ]}
                    onPress={() => handleGameChoice('B')}
                    disabled={!!myChoice}
                  >
                    <Text style={[
                      styles.gameOptionText,
                      myChoice === 'B' && styles.gameOptionTextSelected,
                      myChoice && myChoice !== 'B' && styles.gameOptionTextDisabled
                    ]}>{activeGame.optionB}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.gameResultContainer}>
                  {gameResult.isMatch ? (
                    <Text style={styles.gameResultMatchText}>🎉 灵魂共鸣！太默契了！</Text>
                  ) : (
                    <Text style={styles.gameResultMismatchText}>😂 脑电波完美错开~</Text>
                  )}
                </View>
              )}
              
              {myChoice && !gameResult && (
                <Text style={styles.gameWaitingText}>等待对方选择...</Text>
              )}
            </>
          )}
        </View>

        {/* 消息列表区域 (外层包裹 flex: 1 确保即使未渲染 FlatList 也不会导致布局塌陷) */}
        <View style={{ flex: 1 }}>
          {(appState === 'chatting' || appState === 'onboarding') && (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
              renderItem={renderItem}
              style={{ flex: 1 }}
              contentContainerStyle={[styles.messageList, { flexGrow: 1 }]}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
            />
          )}
        </View>

        {/* SOS 选项卡片区域 */}
        <View style={[styles.sosOptionsContainer, { display: sosOptions.length > 0 ? 'flex' : 'none' }]}>
          {sosOptions.map((option, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.sosOptionButton, index !== sosOptions.length - 1 && styles.sosOptionButtonMargin]}
              onPress={() => handleSelectSosOption(option)}
              activeOpacity={0.8}
            >
              <Text style={styles.sosOptionText}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* AI 建议卡片区域（通过 display 控制显示与隐藏） */}
        <TouchableOpacity 
          style={[
            styles.suggestionCard, 
            isAiTyping && { opacity: 0.7 },
            { display: showSuggestion ? 'flex' : 'none' }
          ]} 
          activeOpacity={0.8}
          onPress={handleUseSuggestion}
          disabled={isAiTyping}
        >
          {/* 添加红娘头像：绝对定位，探出半个身子 */}
          <View style={styles.suggestionAvatarContainer}>
             <Image source={{ uri: selectedMatchmaker.avatar }} style={styles.suggestionAvatar} />
          </View>

          <Text style={styles.suggestionLabel}>
            {isAiTyping ? `🏮 ${selectedMatchmaker.name}正在苦思冥想...` : `🏮 ${selectedMatchmaker.name}的小锦囊 (点击采纳)`}
          </Text>
          <Text style={styles.suggestionText} numberOfLines={3} ellipsizeMode="tail">
            <Text>{aiSuggestion}</Text>
            <Text>{isAiTyping ? ' ▍' : ''}</Text>
          </Text>
        </TouchableOpacity>
        {/* 底部输入框区域 */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="落笔写下心声..."
            placeholderTextColor="#999"
            multiline={true}
          />
          {/* SOS 按钮 */}
          <TouchableOpacity 
            style={[styles.sosButton, isSosLoading && { opacity: 0.5 }]} 
            onPress={handleSOS}
            disabled={isSosLoading}
          >
            <Ionicons name="leaf-outline" size={24} color={CHINESE_COLORS.rouge} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
            <Ionicons name="paper-plane-outline" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* 升温事件弹出层 */}
        {escalationData && (
          <View style={styles.escalationOverlay}>
            <View style={styles.escalationCard}>
              <Text style={styles.escalationTitle}>✨ 气氛燃爆警告 ✨</Text>
              <Text style={styles.escalationText}>{escalationData}</Text>
              <TouchableOpacity 
                style={styles.escalationButton} 
                onPress={() => setEscalationData(null)}
              >
                <Text style={styles.escalationButtonText}>收下建议</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
      <StatusBar style="dark" />
      <FloatingMatchmaker matchmaker={selectedMatchmaker} />
    </SafeAreaView>
  );
}

// 🌟 悬浮红娘组件：可在全屏拖拽并拥有互动效果
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const FloatingMatchmaker = ({ matchmaker }: { matchmaker: MatchmakerPersona }) => {
  const pan = useRef(new Animated.ValueXY()).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  // 呼吸悬浮动画
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -8,
          duration: 1500,
          useNativeDriver: false,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: false,
        })
      ])
    ).start();
  }, [floatAnim]);

  // 拖拽处理
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as any)._value,
          y: (pan.y as any)._value
        });
      },
      onPanResponderMove: Animated.event(
        [
          null,
          { dx: pan.x, dy: pan.y }
        ],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      }
    })
  ).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={{
        position: 'absolute',
        top: SCREEN_HEIGHT * 0.6, // 默认在屏幕中下方
        right: 20, // 默认靠右
        transform: [{ translateX: pan.x }, { translateY: Animated.add(pan.y, floatAnim) }],
        zIndex: 9999,
        elevation: 10,
      }}
    >
      <TouchableOpacity 
        activeOpacity={0.8} 
        onPress={() => Alert.alert(`🏮 ${matchmaker.name}`, matchmaker.greeting)}
        style={{
          width: 120,
          height: 120,
          justifyContent: 'center',
          alignItems: 'center',
          shadowColor: CHINESE_COLORS.rouge,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 5,
          elevation: 5,
        }}
      >
        {/* 🌟 使用 Lottie 渲染动态的 2D 模型，去掉了白色的背景框和描边，让模型自然悬浮 */}
        <LottieView
          autoPlay
          loop
          // 这里读取的是本地的 Lottie 占位动画文件
          source={matchmaker.lottieSource}
          style={{ width: 150, height: 150 }}
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

// 样式定义
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CHINESE_COLORS.paper,
  },
  header: {
    padding: 15,
    backgroundColor: CHINESE_COLORS.paper,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    zIndex: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: CHINESE_COLORS.ink,
    letterSpacing: 1,
  },
  messageList: {
    padding: 15,
    paddingBottom: 20,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 20,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  messageText: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  // 普通系统消息气泡样式
  systemMessageContainer: {
    alignItems: 'center',
    marginVertical: 10,
    paddingHorizontal: 20,
  },
  systemMessageText: {
    backgroundColor: CHINESE_COLORS.paleRouge, 
    color: CHINESE_COLORS.rouge, 
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
    fontSize: 12,
    overflow: 'hidden',
    textAlign: 'center',
  },
  // 红娘专属消息样式
  aiSystemMessageContainer: {
    marginVertical: 12,
    maxWidth: '85%',
  },
  aiSystemMessageBubble: {
    backgroundColor: CHINESE_COLORS.paleRouge,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CHINESE_COLORS.borderRouge,
    shadowColor: CHINESE_COLORS.rouge,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  aiSystemMessageName: {
    fontSize: 12,
    color: '#8C4356',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  aiSystemMessageText: {
    color: CHINESE_COLORS.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  // 双人默契测试卡片样式
  gameCard: {
    backgroundColor: CHINESE_COLORS.paleRouge,
    marginHorizontal: 15,
    marginTop: 10,
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CHINESE_COLORS.borderRouge,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  gameTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: CHINESE_COLORS.rouge,
    marginBottom: 8,
  },
  gameQuestion: {
    fontSize: 16,
    color: CHINESE_COLORS.ink,
    fontWeight: '500',
    marginBottom: 15,
    textAlign: 'center',
  },
  gameOptionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  gameOptionButton: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CHINESE_COLORS.borderRouge,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  gameOptionSelected: {
    backgroundColor: CHINESE_COLORS.rouge,
    borderColor: CHINESE_COLORS.rouge,
  },
  gameOptionDisabled: {
    backgroundColor: '#f0f0f0',
    borderColor: '#e0e0e0',
  },
  gameOptionText: {
    color: CHINESE_COLORS.rouge,
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  gameOptionTextSelected: {
    color: '#fff',
  },
  gameOptionTextDisabled: {
    color: '#999',
  },
  gameWaitingText: {
    marginTop: 10,
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  gameResultContainer: {
    paddingVertical: 15,
    alignItems: 'center',
  },
  gameResultMatchText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: CHINESE_COLORS.rouge,
  },
  gameResultMismatchText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#666',
  },
  // AI 建议卡片的样式
  suggestionCard: {
    backgroundColor: CHINESE_COLORS.paper,
    marginHorizontal: 15,
    marginBottom: 10,
    padding: 15,
    paddingLeft: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CHINESE_COLORS.rouge,
    shadowColor: CHINESE_COLORS.rouge,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    position: 'relative',
    marginTop: 20, // 给头像探出留出空间
  },
  suggestionAvatarContainer: {
    position: 'absolute',
    top: -24,
    left: -10,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: CHINESE_COLORS.rouge,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 5,
    zIndex: 10,
  },
  suggestionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  suggestionLabel: {
    fontSize: 13,
    color: CHINESE_COLORS.rouge,
    fontWeight: 'bold',
    marginBottom: 6,
    marginLeft: 25, // 避开头像
  },
  suggestionText: {
    fontSize: 14,
    color: CHINESE_COLORS.ink,
    lineHeight: 22,
  },
  // SOS 选项卡片的样式
  sosOptionsContainer: {
    paddingHorizontal: 15,
    marginBottom: 10,
  },
  sosOptionButton: {
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CHINESE_COLORS.rouge,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  sosOptionButtonMargin: {
    marginBottom: 8,
  },
  sosOptionText: {
    color: CHINESE_COLORS.rouge,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    paddingBottom: Platform.OS === 'ios' ? 20 : 10,
    backgroundColor: CHINESE_COLORS.paper,
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#F5F0E1',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 16,
    marginRight: 10,
    color: CHINESE_COLORS.ink,
  },
  sosButton: {
    backgroundColor: CHINESE_COLORS.paleRouge,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: CHINESE_COLORS.rouge,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 升温模态框样式
  escalationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 10,
  },
  escalationCard: {
    width: '80%',
    backgroundColor: CHINESE_COLORS.paleRouge,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: CHINESE_COLORS.borderRouge,
    shadowColor: CHINESE_COLORS.rouge,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  escalationTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: CHINESE_COLORS.rouge,
    marginBottom: 15,
  },
  escalationText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: CHINESE_COLORS.ink,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  escalationButton: {
    backgroundColor: CHINESE_COLORS.rouge,
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
  },
  escalationButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
