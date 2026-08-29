import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    generateRaw,
    getCharacterCardFields,
    getMaxPromptTokens,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '/script.js';
import { extension_settings } from '/scripts/extensions.js';
import { getWorldInfoPrompt, world_info_include_names } from '/scripts/world-info.js';
import { LLM_Client } from './llm_client.js';
import { initBodyTtsRuntime } from './body-tts.js';

const SETTINGS_KEY = 'gpt_sovits_frontend_voice_tools';
const MAX_HISTORY = 24;
const DEFAULT_PHONE_PROMPT = `## 单人电话导演
你正在生成一通已经实际拨出并即将接通的完整单人电话，而不是手机聊天消息、短信，也不是“准备打电话”的说明。
本次远端角色：{{角色}}
通话另一端：{{用户}}
要求长度：{{长度}}
台词语言：{{语言}}
### 核心规则
1. 这是一通完整电话。必须从接通后的第一句话开始，经过自然展开，最后形成一个完整但不必刻意正式的通话片段。不要只生成一句问候、一个问题或一句“我现在打给你”。
2. segments 数量必须严格满足 {{长度}}。长度要求是硬约束，不是建议。每一个 segment 都必须包含实际可朗读的有效台词，不得使用空字符串凑数量。
3. 单人电话只生成 {{角色}} 在电话另一端真实说出口的内容。绝对不要替 {{用户}} 生成台词、回答、动作、心理或反应，也不要虚构 {{用户}} 刚刚在电话中说了什么。
4. 不能因为无法生成 {{用户}} 的电话台词，就让通话在第一句结束。{{角色}} 应像真实打电话的人一样，在自然停顿之间继续表达、补充、追问、讲述或转换话题，使这通电话本身具有足够内容。
5. 第一段是“电话接通后的第一句话”。如果电话来自主动来电，不要再说“我现在给你打电话”“等我拨给你”“我要打过去了”等已经发生完毕的事情。可以简短招呼，然后立刻进入真正的来电原因。
6. reason / 本次通话主题只是通话的起点。不要只把 reason 改写一次就结束。应结合角色卡、世界书、实际聊天上下文和双方关系，把它自然展开成 1～3 个互相关联的话题。
### 通话节奏
一通自然的电话通常应有以下发展，但不要机械套模板：
- 开头：接通、确认对方在听，并自然切入来电原因；
- 展开：说明事情、分享细节、表达态度或情绪；
- 延伸：根据人物性格继续追问、联想、吐槽、安慰、分析、转换到相关话题；
- 收束：形成一个自然暂歇点或结束点。
不要让整通电话变成连续采访。不要每一段都以问题结尾。不要连续输出“嗯”“然后呢”“在吗”“听得到吗”之类没有实质内容的短句来凑段数。
### 每段台词
每个 segment 是一次自然的连续发言，而不是必须只有一句话。通常可包含 1～3 个自然口语句子，根据情绪自行决定长短。短句可以存在，但多数 segment 应具有实际信息、情绪或交流推进作用。
台词应：口语化；符合 {{角色}} 的说话习惯；适合直接交给 TTS；可以有自然停顿、笑声、叹气等已支持的语音标签；不写旁白、动作描写、舞台说明或第三人称叙述；不重复聊天记录；不解释规则。
### 特别禁止
禁止整通电话只生成“喂？”“怎么了？”“你想聊什么？”“我打给你了”。也禁止用一条很长的 segment 把整通电话压缩完毕。
{{输出格式}}`;
const DEFAULT_TRACK_PROMPT = `## 多人电话导演
你正在生成一通已经实际建立的多人语音电话。
这不是手机群聊、短信记录、私下偷听剧情，也不是小说场景。本次参与者正在同一通实时电话中互相听见并回应彼此。
本次电话参与者：
{{可用声线}}
用户：
{{用户}}
要求长度：
{{长度}}
台词语言：
{{语言}}
### 一、参与者规则
只有本次明确选择的参与者可以说话。所有 segment 的 speaker 必须来自：{{可用声线}}。
禁止擅自加入其他角色。禁止生成 {{用户}} 的台词、回答、动作、心理或反应。{{用户}} 可以成为这些角色谈论、关心或提及的对象，但不要假装 {{用户}} 在电话里说了任何一句话。
所有被选中的参与者都必须真正参与这通电话，不要出现某个参与者只挂着名字、从头到尾没有发言的情况。但不要机械平均分配台词，也不要严格按照 A→B→C→A→B→C 的顺序轮流讲话。发言频率应由人物性格、当前话题和关系自然决定。
### 二、这是实时电话，不是轮流朗读
角色必须真正回应其他角色刚刚说过的话。允许自然出现：接话、打断、追问、补充、吐槽、反驳、附和、误解后澄清、顺着一句话想到另一件事、两个人短暂聊起来第三个人稍后重新插话、某个角色明显比其他人更健谈或更沉默。
不要把每个人的台词写成彼此没有关系的独立独白，也不要写成会议纪要、访谈节目、主持人轮流点名或“每人发表一次意见”的结构。
### 三、电话长度
本次 segments 必须严格生成 {{长度}}。多人电话正常要求为 15～28 段，这是硬约束，不是建议。每一个 segment 都必须包含真实、可朗读、有意义的台词。禁止使用“嗯。”“是啊。”“然后呢？”“哈哈。”“我知道了。”之类的大量无信息短句来凑数量。自然短句可以存在，但整通电话必须具有足够的实际交流内容。
### 四、自然发展
这通电话应该真正发展，而不是围绕一句话重复十五遍。可以从当前通话目的、最近剧情、角色关系和上下文中自然形成 1～4 个互相关联的话题。通常可以经历：接通与进入状态 → 某个人率先切入事情 → 其他人产生不同回应 → 话题逐渐展开 → 出现新的细节、分歧、玩笑、联想或情绪变化 → 自然转到相关话题 → 到达一个适合暂时结束的节点。这只是交流逻辑，不要机械套模板。threads 应记录实际形成的简短话题名称，而不是事先强迫角色逐条讨论。
### 五、人物关系必须影响对话
不要把所有参与者写成同一种语气。每个人都必须保持自己的：性格、知识边界、与其他参与者的关系、与 {{用户}} 的关系、当前情绪、说话习惯、对同一件事情不同的理解和立场。角色不知道的事情不能突然知道。如果两个人彼此熟悉，他们的交流可以体现熟悉感；如果关系紧张，不要无缘无故变得亲密；如果某人不爱说话，就允许其发言较少，但仍需真实参与。
### 六、每一个 segment
一个 segment 表示一个角色在被别人接话前的一次连续发言，通常可以包含 1～3 个自然口语句子。不要把一句完整的话故意切成多个 segment，也不要把一个角色连续说了一大段完全没人回应的内容压成超长独白。台词必须：口语化；适合直接交给 TTS；符合当前说话人的语言习惯；具有实际交流作用；不包含旁白、心理描写、动作说明或第三人称叙述。声音标签可以按照已启用的 TTS 适配规则自然使用。
### 七、特别避免
不要让每句话都以问题结尾。不要为了让其他角色有机会说话而不断写“你觉得呢？”“那你呢？”“然后呢？”。不要在每次换 speaker 时重新解释话题背景。不要重复用户已经知道的完整聊天记录。不要让所有人物同时突然拥有同一种情绪。不要为了制造热闹而强行吵架，也不要为了和谐让所有人永远意见一致。
最重要的是：让它听起来真的像几个人同时待在一通电话里。
{{输出格式}}`;
const DEFAULT_BODY_TTS_PROMPT = `正常续写正文与叙事，不要改变角色人设或写作风格。
凡是角色真正说出口、需要朗读的台词，请完整照抄成 {{格式}}；标签前引号内的 {译文} 必须是自然中文，供读者查看；标签内的 {文本} 必须保留角色实际说话的原语言，供 TTS 生成。两者语义必须一致且都要保留。旁白、动作、环境和心理描写继续写成普通正文。
格式中的角色、情绪和文本都必须填写，台词语言遵循：{{语言}}。
不要解释这条规则，不要输出代码块，也不要为没有说出口的内容生成语音标签。`;
const LEGACY_CHAT_PROMPT = `你正在一个真实的手机聊天 App 中扮演 {{角色}}，与 {{用户}} 私聊。
严格保持角色卡、世界书、当前剧情、知识边界与说话习惯。像即时通讯那样自然回复，不写旁白，不替 {{用户}} 行动或说话，不解释规则。
可以根据关系与语境选择文字消息或语音消息；用户明确请求语音时必须发送语音。语音台词要适合 TTS 直接朗读。
如果用户引用了旧消息，要理解引用关系并自然承接。回复语言遵循：{{语言}}。`;
const DEFAULT_CHAT_PROMPT = `## 手机私聊角色
你现在只扮演联系人 {{角色}}，正在一个真实手机聊天 App 中与 {{用户}} 一对一聊天。这里不是小说正文，不是面对面场景，也不是旁白式角色扮演。你只能输出 {{角色}} 真正在手机上发送给 {{用户}} 的内容。
### 一、角色与记忆
严格遵守当前：角色卡、世界书、SillyTavern 实际剧情上下文、双方已经发生的事情、手机聊天记录、人物关系变化、人物知识边界、角色自己的性格与语言习惯。这些内容是 {{角色}} 的记忆、经历和现实背景。自然使用即可，不要复述设定，不要突然总结人物关系，也不要向 {{用户}} 解释自己为什么这么说。{{角色}} 只能知道合理知道的事情。
### 二、这是即时通讯
像真实的人使用聊天软件一样交流。回复长度完全取决于当前情况。有时只需要一句“嗯？”。有时适合连续发送几条：“等等”“你说谁？？？”“你再说一次哈哈哈哈”。有时遇到需要认真解释的内容，也可以发送较长的信息。不要为了显得像聊天而把每句话机械切碎，也不要把所有内容永远压成一条巨大长消息。一次回复可以自然发送 1～8 条独立消息，消息条数由人物性格、内容和当时情绪决定，而不是固定数量。
### 三、真正回应用户
优先理解并回应 {{用户}} 当前等待回复的全部消息，而不是只看最后一句。如果 {{用户}} 连续发送了多条信息，应理解它们之间的关系，再决定：逐条回应、合并回应、只抓最重要的部分、或者自然跳过无需回应的小句子。如果 {{用户}} 引用了某条旧消息，必须理解引用对象。不要重复 {{用户}} 刚说过的话再回答。
### 四、角色具有主动性
{{角色}} 不是问答机器人。可以：主动提出新话题；突然想到另一件事；追问感兴趣的细节；开玩笑；吐槽；改变主意；暂时不回答某个问题；表现出自己的偏好；分享自己此刻正在经历的事情；根据关系主动联系 {{用户}}。但这些行为必须来自人物本身和当前情境。不要每次回复最后都机械追加一个问题来维持聊天。真实的人不会永远以“你呢？”“你觉得呢？”“还有吗？”结尾。
### 五、禁止小说化
只发送手机消息。禁止输出：角色动作、表情描写、环境描写、心理活动、镜头描写、第三人称叙述、“{{角色}}：”之类的角色名前缀、“回复：”、星号动作、用于说明语气的小说旁白。如果角色想表达笑、迟疑、无语等感觉，应通过真实聊天语言、标点、语音或可用多媒体自然表现。
### 六、多媒体不是装饰品
这个聊天系统能够真正执行：文字、语音、图片、转账、表情包、主动来电。因此不要把这些能力只当成剧情描述。当实际使用这些功能比纯文字更符合人物和情境时，可以真正调用相应消息类型或动作字段。具体执行规则由后续手机行为条目规定。
### 七、聊天语言
实际发送内容遵循：{{语言}}。如果实际台词不是中文，同时提供意义一致、自然的中文 translation。translation 是给界面显示使用的，不应影响角色原本的语言习惯。
### 八、整体目标
不要努力“写出一段精彩回复”。要表现的是：{{角色}} 此刻真的拿着手机，看到 {{用户}} 发来的这些消息，然后以这个人自己的方式开始回消息。`;
const DEFAULT_PHONE_FORMAT_PROMPT = `{{输出格式}}
这是单人电话的硬性输出协议：
- segments 数量必须严格满足 {{长度}}；
- 每一段 speaker 都必须是 {{角色}}；
- 不得生成 {{用户}} 的 segment；
- 每段 text 必须有真实可朗读台词；
- 不得用空台词、重复台词或无意义短句凑数量；
- 第一段必须是电话已经接通后的实际发言；
- 最后一段不能只是突然截断的半句话；
- text 使用所选台词语言；
- translation 必须填写语义一致、自然的中文译文。`;
const DEFAULT_TRACK_FORMAT_PROMPT = `## 多人电话输出协议
{{输出格式}}
这是硬性结构要求。
segments 必须生成 15～28 段。
所有 speaker 必须精确来自本次参与者：{{可用声线}}
禁止生成 {{用户}} 的 segment。
所有被选择的参与者必须至少实际发言一次，但无需平均分配台词。
每个 segment：
- speaker：当前真实说话人；
- emotion：当前这段实际语气或情绪；
- text：按照 {{语言}} 生成的真实可朗读台词；
- translation：与 text 语义一致的自然中文译文。
text 不得为空。不得使用重复台词或无意义短句凑够 15 段。
sceneDescription 只简短描述这通电话的整体交流状态或背景，不写成长篇小说旁白。
summary 是整通电话结束后的简短内容摘要。
speakers 必须列出实际参与通话的人物。
threads 是本通电话真实形成的简短话题名称数组，最多 6 条。
不要输出 Markdown。不要解释生成过程。不要输出结构之外的文字。`;
const DEFAULT_CHAT_FORMAT_PROMPT = `## 多消息与富消息输出协议
一次回复必须返回 1～8 条真实独立消息。消息数量根据当前交流自然决定，不需要刻意接近上限。
可用类型：text、voice、image、transfer、sticker。
字段使用当前插件实际 Schema：type、emotion、text、translation、description、amount、note、duration。不要使用 kind 字段。
- text：实际发送的文字。
- voice：text 是真正交给 TTS 朗读的内容，translation 是自然中文译文，emotion 填当前语气，duration 按内容合理填写。
- image：description 描述图片真正应该呈现的具体画面。不要填写 NovelAI Tag、URL、参数或 Base64。每批最多一张图片。
- transfer：填写 amount 与 note。
- sticker：使用已导入的合法表情包名称。
proactiveCall 每轮必须返回。没有来电意图：shouldCall=false。需要来电：shouldCall=true，并填写 caller、reason、tone。
当 shouldCall=true 时，messages 仍然只是拨打电话前的聊天消息。禁止在聊天 messages 中生成真正的电话内容。
{{输出格式}}`;
const DEFAULT_CHAT_EXECUTION_PROMPT = `## 手机行为执行原则
当前聊天系统拥有可以真正执行的手机功能。如果 {{用户}} 请求了当前系统能够实际完成的行为，不要只用文字假装已经执行，应真正使用对应结构。
- 文字：type:"text"。
- 语音：type:"voice"，填写实际朗读的 text、translation、emotion。
- 图片：type:"image"，填写 description，由后续生图流程真正生成图片。
- 转账：type:"transfer"，填写 amount 与 note。
- 表情包：type:"sticker"，只能选择系统已提供的表情包名称。
- 主动来电：不是消息类型。禁止输出 type:"call"。必须使用顶层 proactiveCall。
如果 {{用户}} 明确说“发张照片看看”，不要只回复“好，我发给你”。
如果 {{用户}} 明确说“给我发语音”，不要只回复“好，我说给你听”。
如果 {{用户}} 明确说“给我打电话”，不要把一整通电话写成 QQ 消息。可以发送少量符合人物性格的通话前聊天消息，然后设置 proactiveCall.shouldCall = true。
真正的电话台词会由独立的【单人通话】工作流生成。不要在聊天阶段提前生成电话 segments。
这些能力同样可以由 {{角色}} 主动使用，而无需等待 {{用户}} 下命令。角色是否主动使用图片、语音、转账、表情包或电话，应由人物性格、关系、剧情与当前交流需求决定。不要为了展示插件功能而频繁调用多媒体。`;
const DEFAULT_CHAT_IMAGE_PROMPT = `## 图片与多媒体行为
你正在使用一个真实手机聊天环境。除了普通文字外，{{角色}} 可以根据角色性格、当前剧情、手机聊天记录和本轮消息，自然决定发送图片、语音、转账或表情包。
### 图片
当 {{角色}} 想让 {{用户}} 看见某个具体画面时，可以发送 kind:"image"。
以下情况尤其适合发送图片：
- {{用户}} 明确要求“发张照片”“给我看看”“拍给我看”“自拍看看”“你那里什么样”等；
- 当前正在讨论某件能直接拍摄、展示或分享的东西；
- {{角色}} 此刻看见了有趣、漂亮、重要、奇怪或值得分享的事物；
- 根据人物性格，{{角色}} 自己产生了分享照片、自拍、现场画面、物品、食物、宠物、风景、穿搭等内容的自然冲动；
- 用图片比继续文字描述更符合真实手机聊天习惯。
不需要等待 {{用户}} 明确要求，若情境和人物动机自然成立，{{角色}} 可以主动发图片。
发送图片时：
- kind 必须为 "image"；
- description 必须填写这张图片实际应该呈现的画面：一个明确的、可以被画出来的瞬间，包括主体、外观、动作或姿态、环境、构图和当下氛围；
- description 必须遵守当前角色外貌、服装、地点、时间和剧情事实；
- 不要在 description 中写 NovelAI Tag、参数、模型名、URL、Base64 或生成指令；
- 插件会根据 description 自动调用后续生图流程，不要声称图片已经存在于现实文件中；
- 每批回复最多发送一张图片。
图片本身就是一条聊天消息，可以在图片前后搭配少量自然文字（如“你看这个”“刚拍的”），但不要用一大段文字重新描述图片内容。
若 {{用户}} 明确要求 {{角色}} 发图片，只要请求符合当前情境且角色有能力做出该行为，应优先真正返回 kind:"image"，而不是只用文字说“好，我发给你”。`;
const DEFAULT_CHAT_PROACTIVE_CALL_PROMPT = `## 主动来电
当前单聊中的 {{角色}} 拥有主动给 {{用户}} 打电话的能力。
主动来电不是一条 QQ 消息类型，不要输出 kind:"call"。
是否打电话必须通过最终 JSON 顶层的 proactiveCall 表达：
- shouldCall：本轮结束后是否真的发起一通角色来电；
- caller：准备打电话的角色姓名，通常为 {{角色}}；
- reason：为什么此刻要打电话，以及这通电话准备围绕什么事情展开；
- tone：这通电话的整体语气或情绪，例如轻松、兴奋、担心、急切、害羞、认真、醉意、愤怒等。
### 什么时候应该考虑主动打电话
根据人物性格和当前情境自主判断，不需要等待 {{用户}} 主动提出。适合主动来电的情况包括但不限于：
- {{用户}} 明确要求“给我打电话”“你打过来吧”“电话里说”等；
- 当前事情用电话交流明显比继续打字更加自然；
- {{角色}} 有急事、重要消息或强烈情绪，想立刻听见 {{用户}}；
- 两人已经聊到一个明显适合转入语音交流的话题；
- 当前剧情中突然发生了值得立刻联系 {{用户}} 的事情；
- 根据 {{角色}} 的人物习惯和关系状态，突然打一通电话本身就是自然行为。
不要为了展示功能而频繁打电话，主动来电必须来自人物动机和当前情境，而不是随机触发。
### 明确请求
如果 {{用户}} 明确要求 {{角色}} “打电话过来”“给我来个电话”“电话里聊”，并且当前是允许主动来电的单聊场景，应优先设置 proactiveCall.shouldCall = true，不要只回复“好，我打给你”然后把 shouldCall 设为 false。
### 自主决定
即使 {{用户}} 没有要求，如果 {{角色}} 根据当前故事、手机聊天记录、人物性格和关系自然地产生了打电话的动机，也可以设置 shouldCall = true。此时 reason 必须写清楚真正的来电原因，作为后续电话内容生成的重要依据，不要只写“想打电话”“主动来电”这种空泛描述。
### 不来电时
若当前没有自然的来电动机，则设置 shouldCall = false。不要硬制造事件来触发电话。群聊不得触发主动电话。
### 聊天与电话的边界
proactiveCall 只负责表达“是否在本轮 QQ 回复结束后启动一通电话”。它不是电话剧本。
当 shouldCall=true 时：
- QQ messages 仍然只包含 {{角色}} 在拨打电话之前发送的正常聊天消息；
- 不要在 messages 中模拟接通后的完整电话；
- 不要生成电话 segments；
- 不要假装 {{用户}} 已经接听；
- caller、reason、tone 用来告诉后续【单人通话】工作流为什么打电话以及应该以什么状态开始。
真正的电话内容由独立电话生成流程负责。`;
const DEFAULT_MINIMAX_ADAPTATION_PROMPT = `#### 规则 1：全局情绪映射表（Emotion 规范）
规定模型在 \`“译文”[TTS:角色:情绪:文本]\` 的“情绪”位置，必须从 MiniMax 支持的标准情绪中选择最契合的一项： ["happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent"]

#### 规则 2：台词内语气词标签植入规范（Sound Tags）
规定模型在生成朗读台词时，根据角色的动作描写，在对应位置自然植入以下英文圆括号标签：
1. 欢笑与愉悦类
- (laughs)：开怀大笑 / 明显笑声
- (chuckle)：轻笑 / 嗤笑 / 抿嘴笑
- (humming)：轻哼 / 哼歌调
2. 呼吸与叹气类
- (breath)：正常换气声 / 呼吸停顿
- (inhale)：深吸气（准备说话前或受到刺激时）
- (exhale)：呼气 / 吐气
- (pant)：喘息 / 呼吸急促
- (gasps)：倒吸凉气 / 倒抽一口气
- (sighs)：叹气 / 叹息
3. 情绪与日常动作类
- (sniffs)：抽泣 / 吸鼻子（配合委屈或感冒）
- (snorts)：哼鼻息 / 喷鼻音（傲娇或轻蔑）
- (coughs)：咳嗽
- (clear-throat)：清嗓子（演讲或正式开口前）
- (groans)：呻吟 / 痛苦低吟
- (emm)：沉吟 / 思考声（“嗯……”）
- (lip-smacking)：咂嘴 / 吧唧嘴
- (sneezes)：打喷嚏
- (burps)：打嗝
- 微小停顿控制：可使用 \`<#0.3#>\` 表示停顿0.3秒
4. tag规范：标签直接内嵌在文本中；必须使用英文小写和英文括号；放置在语意转折或句首句尾；与标点/停顿配合。`;

const PROMPT_WORKFLOW_LABELS = Object.freeze({
    body: '正文 TTS',
    single_call: '单人通话',
    group_call: '多人通话',
    chat: '手机聊天',
    image: '生图 Tag',
});

const PROMPT_WORKFLOW_KINDS = Object.freeze(Object.keys(PROMPT_WORKFLOW_LABELS));

const DEFAULT_PROMPT_WORKFLOWS = Object.freeze({
    body: Object.freeze([
        Object.freeze({ id: 'body-rules', name: '正文语音规则', role: 'system', enabled: true, content: DEFAULT_BODY_TTS_PROMPT }),
        Object.freeze({ id: 'body-minimax-adaptation', name: 'MiniMax 适配', role: 'system', enabled: true, content: DEFAULT_MINIMAX_ADAPTATION_PROMPT }),
    ]),
    single_call: Object.freeze([
        Object.freeze({ id: 'single_call-director', name: '单人电话导演', role: 'system', enabled: true, content: DEFAULT_PHONE_PROMPT }),
        Object.freeze({ id: 'single_call-minimax-adaptation', name: 'MiniMax 适配', role: 'system', enabled: true, content: DEFAULT_MINIMAX_ADAPTATION_PROMPT }),
        Object.freeze({ id: 'single_call-format', name: '单人电话输出协议', role: 'system', enabled: true, content: DEFAULT_PHONE_FORMAT_PROMPT }),
        Object.freeze({ id: 'single_call-context', name: '单人电话任务与上下文', role: 'user', enabled: true, content: '{{任务上下文}}' }),
    ]),
    group_call: Object.freeze([
        Object.freeze({ id: 'group_call-director', name: '多人通话导演', role: 'system', enabled: true, content: DEFAULT_TRACK_PROMPT }),
        Object.freeze({ id: 'group_call-minimax-adaptation', name: 'MiniMax 适配', role: 'system', enabled: true, content: DEFAULT_MINIMAX_ADAPTATION_PROMPT }),
        Object.freeze({ id: 'group_call-format', name: '多人电话输出协议', role: 'system', enabled: true, content: DEFAULT_TRACK_FORMAT_PROMPT }),
        Object.freeze({ id: 'group_call-context', name: '多人电话任务与上下文', role: 'user', enabled: true, content: '{{任务上下文}}' }),
    ]),
    chat: Object.freeze([
        Object.freeze({ id: 'chat-character', name: '手机私聊角色', role: 'system', enabled: true, content: DEFAULT_CHAT_PROMPT }),
        Object.freeze({ id: 'chat-execution-principle', name: '手机行为执行原则', role: 'system', enabled: true, content: DEFAULT_CHAT_EXECUTION_PROMPT }),
        Object.freeze({ id: 'chat-image-behavior', name: '图片与多媒体行为', role: 'system', enabled: true, content: DEFAULT_CHAT_IMAGE_PROMPT }),
        Object.freeze({ id: 'chat-proactive-call', name: '主动来电判断', role: 'system', enabled: true, content: DEFAULT_CHAT_PROACTIVE_CALL_PROMPT }),
        Object.freeze({ id: 'chat-minimax-adaptation', name: 'MiniMax 适配', role: 'system', enabled: true, content: DEFAULT_MINIMAX_ADAPTATION_PROMPT }),
        Object.freeze({ id: 'chat-format', name: '多消息与富消息输出协议', role: 'system', enabled: true, content: DEFAULT_CHAT_FORMAT_PROMPT }),
        Object.freeze({ id: 'chat-context', name: '聊天记录与待回复消息', role: 'user', enabled: true, content: '{{任务上下文}}' }),
    ]),
    image: Object.freeze([
        Object.freeze({ id: 'image-tag-only', name: '动态 Tag 生成', role: 'system', enabled: true, content: '只返回 JSON：{"dynamicPositiveTags":""}。其中 dynamicPositiveTags 是当前场景适合追加的逗号分隔英文 tags。' }),
    ]),
});
const DEFAULT_PLANNER = Object.freeze({
    schemaVersion: 12,
    mode: 'sillytavern',
    apiUrl: '',
    apiKey: '',
    model: '',
    temperature: 0.72,
    maxTokens: 8192,
    contextLimit: 100,
    phonePrompt: DEFAULT_PHONE_PROMPT,
    trackPrompt: DEFAULT_TRACK_PROMPT,
    outputLanguage: 'auto',
    customLanguage: '',
    bodyPromptEnabled: true,
    bodyPrompt: DEFAULT_BODY_TTS_PROMPT,
    activePromptPresetId: '',
    activeApiPresetId: '',
});

const DEFAULT_CHAT_SETTINGS = Object.freeze({
    prompt: DEFAULT_CHAT_PROMPT,
    activePresetId: '',
    maxHistory: 80,
    autoVoice: false,
});

const OUTPUT_LANGUAGES = Object.freeze({
    auto: { label: '跟随角色与正文', instruction: '跟随当前角色和最近对话自然使用的语言' },
    zh: { label: '中文', instruction: '所有可朗读台词必须使用自然中文' },
    yue: { label: '粤语', instruction: '所有可朗读台词必须使用自然、地道的粤语口语，并优先使用常见粤语书面用字' },
    ja: { label: '日本語', instruction: 'すべての読み上げ台詞を自然な日本語で書くこと' },
    en: { label: 'English', instruction: 'write every spoken line in natural English' },
    ko: { label: '한국어', instruction: '모든 음성 대사를 자연스러운 한국어로 작성할 것' },
    custom: { label: '自定义语言', instruction: '' },
});

const BODY_PROMPT_KEY = 'gpt_sovits_body_tts_prompt';

const PHONE_SCHEMA = Object.freeze({
    name: 'tts_frontend_phone_call',
    description: '角色主动来电脚本',
    strict: true,
    returnInvalid: true,
    value: {
        type: 'object',
        additionalProperties: false,
        properties: {
            caller: { type: 'string' },
            title: { type: 'string' },
            reason: { type: 'string' },
            tone: { type: 'string' },
            segments: {
                type: 'array',
                minItems: 4,
                maxItems: 18,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        speaker: { type: 'string' },
                        emotion: { type: 'string' },
                        text: { type: 'string' },
                        translation: { type: 'string' },
                    },
                    required: ['speaker', 'emotion', 'text', 'translation'],
                },
            },
        },
        required: ['caller', 'title', 'reason', 'tone', 'segments'],
    },
});

const TRACK_SCHEMA = Object.freeze({
    name: 'tts_frontend_conversation_track',
    description: '多角色私下对话',
    strict: true,
    returnInvalid: true,
    value: {
        type: 'object',
        additionalProperties: false,
        properties: {
            sceneDescription: { type: 'string' },
            summary: { type: 'string' },
            mood: { type: 'string' },
            scene: { type: 'string' },
            speakers: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
            threads: { type: 'array', items: { type: 'string' }, maxItems: 6 },
            segments: {
                type: 'array',
                minItems: 10,
                maxItems: 25,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        speaker: { type: 'string' },
                        emotion: { type: 'string' },
                        text: { type: 'string' },
                        translation: { type: 'string' },
                    },
                    required: ['speaker', 'emotion', 'text', 'translation'],
                },
            },
        },
        required: ['sceneDescription', 'summary', 'mood', 'scene', 'speakers', 'threads', 'segments'],
    },
});

// 多人外呼通话结构：与上面 TRACK_SCHEMA 几乎一致，但最少 15 段、最多 28 段，
// 不再有 mood 字段，以匹配电话多人语义。
const GROUP_CALL_PHONE_SCHEMA = Object.freeze({
    name: 'tts_frontend_group_phone_call',
    description: '多人外呼通话脚本',
    strict: true,
    returnInvalid: true,
    value: {
        type: 'object',
        additionalProperties: false,
        properties: {
            sceneDescription: { type: 'string' },
            summary: { type: 'string' },
            speakers: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
            threads: { type: 'array', items: { type: 'string' }, maxItems: 6 },
            segments: {
                type: 'array',
                minItems: 15,
                maxItems: 28,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        speaker: { type: 'string' },
                        emotion: { type: 'string' },
                        text: { type: 'string' },
                        translation: { type: 'string' },
                    },
                    required: ['speaker', 'emotion', 'text', 'translation'],
                },
            },
        },
        required: ['sceneDescription', 'summary', 'speakers', 'threads', 'segments'],
    },
});

const CHAT_SCHEMA = Object.freeze({
    name: 'tts_phone_chat_reply',
    description: '手机聊天角色回复',
    strict: true,
    returnInvalid: true,
    value: {
        type: 'object',
        additionalProperties: false,
        properties: {
            messages: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        type: { type: 'string', enum: ['text', 'voice', 'image', 'transfer', 'sticker'] },
                        emotion: { type: 'string', maxLength: 80 },
                        text: { type: 'string', maxLength: 1800 },
                        translation: { type: 'string', maxLength: 1800 },
                        description: { type: 'string', maxLength: 1800 },
                        amount: { type: 'string', maxLength: 80 },
                        note: { type: 'string', maxLength: 300 },
                        duration: { type: 'number', minimum: 0, maximum: 600 },
                    },
                    required: ['type', 'emotion', 'text', 'translation', 'description', 'amount', 'note', 'duration'],
                },
            },
            proactiveCall: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    shouldCall: { type: 'boolean' },
                    caller: { type: 'string', maxLength: 120 },
                    reason: { type: 'string', maxLength: 1200 },
                    tone: { type: 'string', maxLength: 80 },
                },
                required: ['shouldCall', 'caller', 'reason', 'tone'],
            },
        },
        required: ['messages', 'proactiveCall'],
    },
});

const GROUP_CHAT_SCHEMA = Object.freeze({
    name: 'tts_phone_group_chat_reply',
    description: '手机群聊多角色回复',
    strict: true,
    returnInvalid: true,
    value: {
        type: 'object',
        additionalProperties: false,
        properties: {
            messages: {
                type: 'array',
                minItems: 1,
                maxItems: 12,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        speaker: { type: 'string', maxLength: 120 },
                        type: { type: 'string', enum: ['text', 'voice', 'image', 'transfer', 'sticker'] },
                        emotion: { type: 'string', maxLength: 80 },
                        text: { type: 'string', maxLength: 1800 },
                        translation: { type: 'string', maxLength: 1800 },
                        description: { type: 'string', maxLength: 1800 },
                        amount: { type: 'string', maxLength: 80 },
                        note: { type: 'string', maxLength: 300 },
                        duration: { type: 'number', minimum: 0, maximum: 600 },
                    },
                    required: ['speaker', 'type', 'emotion', 'text', 'translation', 'description', 'amount', 'note', 'duration'],
                },
            },
        },
        required: ['messages'],
    },
});

const listeners = new Set();
let initialized = false;
let injectedBodyPromptKeys = [];
let lastLoreStatus = { cardIncluded: false, worldInfoSections: 0, error: '' };

const clone = value => JSON.parse(JSON.stringify(value));

function createId(prefix) {
    const random = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    return `${prefix}-${random}`;
}

function cloneDefaultWorkflowEntries(kind) {
    const workflow = DEFAULT_PROMPT_WORKFLOWS[kind];
    if (!workflow) throw new Error(`未知提示词工作流：${kind}`);
    return clone(workflow);
}

function sanitizePromptEntries(entries, kind) {
    const fallback = cloneDefaultWorkflowEntries(kind);
    if (!Array.isArray(entries) || !entries.length) return fallback;
    const seen = new Set();
    const normalized = entries.slice(0, 80).map((entry, index) => {
        let id = String(entry?.id || '').trim() || createId(`prompt-${kind}`);
        if (seen.has(id)) id = createId(`prompt-${kind}`);
        seen.add(id);
        const role = ['system', 'user', 'assistant'].includes(entry?.role) ? entry.role : 'system';
        return {
            id,
            name: String(entry?.name || `条目 ${index + 1}`).trim().slice(0, 80) || `条目 ${index + 1}`,
            role,
            enabled: entry?.enabled !== false,
            content: String(entry?.content || '').slice(0, 50000),
        };
    });
    return normalized.length ? normalized : fallback;
}

function legacyPromptEntries(kind, value) {
    const entries = cloneDefaultWorkflowEntries(kind);
    if (!String(value || '').trim()) return entries;
    const primaryIndex = entries.findIndex(entry => entry.id.endsWith('-director') || entry.id.endsWith('-rules') || entry.id.endsWith('-character'));
    if (primaryIndex >= 0) entries[primaryIndex].content = String(value).trim();
    return entries;
}

function appendMiniMaxAdaptation(entries, kind) {
    if (entries.some(entry => entry.id === `${kind}-minimax-adaptation` || entry.name === 'MiniMax 适配')) return entries;
    entries.splice(Math.min(1, entries.length), 0, {
        id: `${kind}-minimax-adaptation`,
        name: 'MiniMax 适配',
        role: 'system',
        enabled: true,
        content: DEFAULT_MINIMAX_ADAPTATION_PROMPT,
    });
    return entries;
}

function createPromptWorkflow(kind, stored, legacyValue, legacyPresets = []) {
    const source = stored && typeof stored === 'object' ? stored : {};
    const entries = sanitizePromptEntries(
        Array.isArray(source.entries) && source.entries.length ? source.entries : legacyPromptEntries(kind, legacyValue),
        kind,
    );
    let presets = Array.isArray(source.presets) ? source.presets : [];
    if (!presets.length && Array.isArray(legacyPresets)) {
        presets = legacyPresets.map(item => {
            const legacyPrompt = kind === 'body' ? item?.bodyPrompt
                : kind === 'single_call' ? item?.phonePrompt
                    : kind === 'group_call' ? item?.trackPrompt
                        : kind === 'chat' ? item?.prompt : '';
            return {
                id: createId(`prompt-${kind}-preset`),
                name: String(item?.name || PROMPT_WORKFLOW_LABELS[kind]).trim().slice(0, 60),
                entries: legacyPromptEntries(kind, legacyPrompt),
                updatedAt: item?.updatedAt || new Date().toISOString(),
            };
        });
    }
    presets = presets.filter(item => item?.id && item?.name).slice(0, 50).map(item => ({
        id: String(item.id),
        name: String(item.name).trim().slice(0, 60),
        entries: sanitizePromptEntries(item.entries, kind),
        updatedAt: item.updatedAt || new Date().toISOString(),
    }));
    const activePresetId = presets.some(item => item.id === source.activePresetId)
        ? String(source.activePresetId)
        : '';
    const depth = Math.min(20, Math.max(0, Math.round(Number(source.depth) || 0)));
    return { entries, presets, activePresetId, depth };
}

function getPrimaryWorkflowPrompt(store, kind) {
    const entries = store.promptWorkflows?.[kind]?.entries || [];
    return String(entries.find(entry => entry.enabled && entry.content.trim())?.content || '').trim();
}

function replacePrimaryWorkflowPrompt(store, kind, value) {
    const workflow = store.promptWorkflows?.[kind];
    if (!workflow) return;
    const prompt = String(value || '').trim();
    const primary = workflow.entries.find(entry => entry.id.endsWith('-director') || entry.id.endsWith('-rules') || entry.id.endsWith('-character'))
        || workflow.entries[0];
    if (primary) primary.content = prompt || cloneDefaultWorkflowEntries(kind)[0].content;
}

function ensureStore() {
    if (!extension_settings[SETTINGS_KEY]) {
        extension_settings[SETTINGS_KEY] = {
            planner: clone(DEFAULT_PLANNER),
            favorites: [],
            calls: [],
            promptPresets: [],
            promptWorkflows: {},
            promptRevisions: {},
            apiPresets: [],
            phoneChat: {
                settings: clone(DEFAULT_CHAT_SETTINGS),
                presets: [],
                threads: {},
                groups: {},
                activeGroupId: '',
            },
        };
    }

    const store = extension_settings[SETTINGS_KEY];
    const storedSchemaVersion = Number(store.planner?.schemaVersion || 0);
    store.planner = {
        ...clone(DEFAULT_PLANNER),
        ...(store.planner || {}),
    };
    if (storedSchemaVersion < 3) {
        if (Number(store.planner.contextLimit) <= 40) store.planner.contextLimit = DEFAULT_PLANNER.contextLimit;
        if (Number(store.planner.maxTokens) <= 4000) store.planner.maxTokens = DEFAULT_PLANNER.maxTokens;
    }
    if (storedSchemaVersion < 4) {
        if (/角色语音导演[\s\S]*短对话/.test(String(store.planner.phonePrompt || ''))) store.planner.phonePrompt = DEFAULT_PHONE_PROMPT;
        if (/对话连续性编辑[\s\S]*建议回复/.test(String(store.planner.trackPrompt || ''))) store.planner.trackPrompt = DEFAULT_TRACK_PROMPT;
        if (/凡是角色真正说出口[\s\S]*请使用 \{\{格式\}\}/.test(String(store.planner.bodyPrompt || ''))) store.planner.bodyPrompt = DEFAULT_BODY_TTS_PROMPT;
    }
    store.planner.schemaVersion = 11;
    store.planner.mode = store.planner.mode === 'custom' ? 'custom' : 'sillytavern';
    const temperature = Number(store.planner.temperature);
    const maxTokens = Number(store.planner.maxTokens);
    const contextLimit = Number(store.planner.contextLimit);
    store.planner.temperature = Number.isFinite(temperature)
        ? Math.min(1.5, Math.max(0, temperature))
        : DEFAULT_PLANNER.temperature;
    store.planner.maxTokens = Number.isFinite(maxTokens)
        ? Math.min(65536, Math.max(200, Math.round(maxTokens)))
        : DEFAULT_PLANNER.maxTokens;
    store.planner.contextLimit = contextLimit === 0
        ? 0
        : Number.isFinite(contextLimit)
            ? Math.min(1000, Math.max(4, Math.round(contextLimit)))
        : DEFAULT_PLANNER.contextLimit;
    delete store.planner.autoTrack;
    store.planner.phonePrompt = String(store.planner.phonePrompt || '').trim() || DEFAULT_PHONE_PROMPT;
    store.planner.trackPrompt = String(store.planner.trackPrompt || '').trim() || DEFAULT_TRACK_PROMPT;
    store.planner.outputLanguage = OUTPUT_LANGUAGES[store.planner.outputLanguage]
        ? store.planner.outputLanguage
        : DEFAULT_PLANNER.outputLanguage;
    store.planner.customLanguage = String(store.planner.customLanguage || '').trim().slice(0, 200);
    store.planner.bodyPromptEnabled = store.planner.bodyPromptEnabled !== false;
    store.planner.bodyPrompt = String(store.planner.bodyPrompt || '').trim() || DEFAULT_BODY_TTS_PROMPT;
    store.planner.activePromptPresetId = String(store.planner.activePromptPresetId || '').trim();
    store.planner.activeApiPresetId = String(store.planner.activeApiPresetId || '').trim();
    store.favorites = Array.isArray(store.favorites) ? store.favorites.slice(0, 120) : [];
    store.calls = Array.isArray(store.calls) ? store.calls.slice(0, MAX_HISTORY).map(item => ({
        ...clone(item),
        favorite: item.favorite === true,
        kind: ['single', 'group'].includes(item.kind) ? item.kind : (Array.isArray(item.speakers) && item.speakers.length > 1 ? 'group' : 'single'),
    })) : [];
    store.promptPresets = Array.isArray(store.promptPresets)
        ? store.promptPresets.filter(item => item?.id && item?.name).slice(0, 50).map(item => ({
            id: String(item.id),
            name: String(item.name).trim().slice(0, 60),
            phonePrompt: String(item.phonePrompt || DEFAULT_PHONE_PROMPT),
            trackPrompt: String(item.trackPrompt || DEFAULT_TRACK_PROMPT),
            bodyPrompt: String(item.bodyPrompt || DEFAULT_BODY_TTS_PROMPT),
            bodyPromptEnabled: item.bodyPromptEnabled !== false,
            outputLanguage: OUTPUT_LANGUAGES[item.outputLanguage] ? item.outputLanguage : 'auto',
            customLanguage: String(item.customLanguage || '').trim().slice(0, 200),
            updatedAt: item.updatedAt || new Date().toISOString(),
        }))
        : [];
    store.apiPresets = Array.isArray(store.apiPresets)
        ? store.apiPresets.filter(item => item?.id && item?.name).slice(0, 30).map(item => ({
            id: String(item.id),
            name: String(item.name).trim().slice(0, 60),
            apiUrl: String(item.apiUrl || '').trim(),
            apiKey: String(item.apiKey || '').trim(),
            model: String(item.model || '').trim(),
            temperature: Math.min(1.5, Math.max(0, Number(item.temperature) || DEFAULT_PLANNER.temperature)),
            maxTokens: Math.min(65536, Math.max(200, Math.round(Number(item.maxTokens) || DEFAULT_PLANNER.maxTokens))),
            updatedAt: item.updatedAt || new Date().toISOString(),
        }))
        : [];
    const storedPhoneChat = store.phoneChat && typeof store.phoneChat === 'object' ? store.phoneChat : {};
    store.phoneChat = {
        settings: {
            ...clone(DEFAULT_CHAT_SETTINGS),
            ...(storedPhoneChat.settings || {}),
        },
        presets: Array.isArray(storedPhoneChat.presets) ? storedPhoneChat.presets : [],
        threads: storedPhoneChat.threads && typeof storedPhoneChat.threads === 'object' ? storedPhoneChat.threads : {},
        groups: storedPhoneChat.groups && typeof storedPhoneChat.groups === 'object' ? storedPhoneChat.groups : {},
        activeGroupId: String(storedPhoneChat.activeGroupId || ''),
    };
    if (storedSchemaVersion < 7
        && !String(store.phoneChat.settings.activePresetId || '').trim()
        && String(store.phoneChat.settings.prompt || '').trim() === LEGACY_CHAT_PROMPT.trim()) {
        store.phoneChat.settings.prompt = DEFAULT_CHAT_PROMPT;
        store.phoneChat.settings.activePresetId = '';
    }
    store.phoneChat.settings.prompt = String(store.phoneChat.settings.prompt || '').trim() || DEFAULT_CHAT_PROMPT;
    store.phoneChat.settings.activePresetId = String(store.phoneChat.settings.activePresetId || '').trim();
    store.phoneChat.settings.maxHistory = Math.min(240, Math.max(8, Math.round(Number(store.phoneChat.settings.maxHistory) || DEFAULT_CHAT_SETTINGS.maxHistory)));
    store.phoneChat.settings.autoVoice = store.phoneChat.settings.autoVoice === true;
    store.phoneChat.presets = store.phoneChat.presets
        .filter(item => item?.id && item?.name)
        .slice(0, 40)
        .map(item => ({
            id: String(item.id),
            name: String(item.name).trim().slice(0, 60),
            prompt: String(item.prompt || DEFAULT_CHAT_PROMPT),
            maxHistory: Math.min(240, Math.max(8, Math.round(Number(item.maxHistory) || DEFAULT_CHAT_SETTINGS.maxHistory))),
            autoVoice: item.autoVoice === true,
            updatedAt: item.updatedAt || new Date().toISOString(),
        }));
    const storedWorkflows = store.promptWorkflows && typeof store.promptWorkflows === 'object'
        ? store.promptWorkflows
        : {};
    // 兼容升级：把旧 phone / track / image 工作流映射到新版 single_call / group_call / image。
    const singleCallSource = storedWorkflows.single_call || storedWorkflows.phone;
    const groupCallSource = storedWorkflows.group_call || storedWorkflows.track;
    const imageSource = storedWorkflows.image;
    store.promptWorkflows = {
        body: createPromptWorkflow('body', storedWorkflows.body, store.planner.bodyPrompt, store.promptPresets),
        single_call: createPromptWorkflow('single_call', singleCallSource, store.planner.phonePrompt, store.promptPresets),
        group_call: createPromptWorkflow('group_call', groupCallSource, store.planner.trackPrompt, store.promptPresets),
        chat: createPromptWorkflow('chat', storedWorkflows.chat, store.phoneChat.settings.prompt, store.phoneChat.presets),
        image: createPromptWorkflow('image', imageSource, '', []),
    };
    const storedRevisions = store.promptRevisions && typeof store.promptRevisions === 'object'
        ? store.promptRevisions
        : {};
    store.promptRevisions = Object.fromEntries(Object.keys(PROMPT_WORKFLOW_LABELS).map(kind => [kind,
        (Array.isArray(storedRevisions[kind]) ? storedRevisions[kind] : [])
            .filter(item => item?.id && Array.isArray(item.entries))
            .slice(0, 30)
            .map(item => ({
                id: String(item.id),
                name: String(item.name || '未命名版本').trim().slice(0, 60) || '未命名版本',
                entries: sanitizePromptEntries(item.entries, kind),
                createdAt: item.createdAt || new Date().toISOString(),
            })),
    ]));
    if (storedSchemaVersion < 9) {
        Object.entries(store.promptWorkflows).forEach(([kind, workflow]) => {
            if (kind === 'image') return;
            appendMiniMaxAdaptation(workflow.entries, kind);
            workflow.presets.forEach(preset => appendMiniMaxAdaptation(preset.entries, kind));
        });
    }
    store.planner.bodyPrompt = getPrimaryWorkflowPrompt(store, 'body') || DEFAULT_BODY_TTS_PROMPT;
    store.planner.phonePrompt = getPrimaryWorkflowPrompt(store, 'single_call') || DEFAULT_PHONE_PROMPT;
    store.planner.trackPrompt = getPrimaryWorkflowPrompt(store, 'group_call') || DEFAULT_TRACK_PROMPT;
    store.phoneChat.settings.prompt = getPrimaryWorkflowPrompt(store, 'chat') || DEFAULT_CHAT_PROMPT;
    // 迁移一律防御式执行：任何一步出错都不能阻止扩展启动。
    try {
        if (storedSchemaVersion < 13) {
            // 迁移：把工作流里遗留的旧 [TTSVoice:…] 格式改写为 PLAN 的 [TTS:…]。
            for (const workflow of Object.values(store.promptWorkflows)) {
                const rewrite = entries => entries.forEach(entry => {
                    entry.content = String(entry.content || '').replaceAll('[TTSVoice:', '[TTS:');
                });
                rewrite(workflow.entries);
                workflow.presets.forEach(preset => rewrite(preset.entries));
            }
        }
        if (storedSchemaVersion < 14) {
            // 迁移：给手机聊天工作流补上行为执行、图片与主动来电三个默认条目。
            const chatWorkflow = store.promptWorkflows.chat;
            const inserts = [
                ['chat-execution-principle', 'chat-character', '手机行为执行原则', DEFAULT_CHAT_EXECUTION_PROMPT],
                ['chat-image-behavior', 'chat-execution-principle', '图片与多媒体行为', DEFAULT_CHAT_IMAGE_PROMPT],
                ['chat-proactive-call', 'chat-image-behavior', '主动来电判断', DEFAULT_CHAT_PROACTIVE_CALL_PROMPT],
            ];
            for (const [id, afterId, name, content] of inserts) {
                if (chatWorkflow.entries.some(entry => entry.id === id)) continue;
                const anchor = chatWorkflow.entries.findIndex(entry => entry.id === afterId);
                chatWorkflow.entries.splice(anchor < 0 ? chatWorkflow.entries.length : anchor + 1, 0, { id, name, role: 'system', enabled: true, content });
            }
            // 旧协议里的 red_packet / 假装发图说法统一改成 sticker。
            const normalizeChatEntries = entries => entries.forEach(entry => {
                entry.content = String(entry.content || '').replaceAll('red_packet', 'sticker');
            });
            normalizeChatEntries(chatWorkflow.entries);
            chatWorkflow.presets.forEach(preset => normalizeChatEntries(preset.entries));
            const formatEntry = chatWorkflow.entries.find(entry => entry.id === 'chat-format');
            if (formatEntry) formatEntry.content = DEFAULT_CHAT_FORMAT_PROMPT;
        }
        if (storedSchemaVersion < 15) {
            // 迁移：把单人电话工作流里旧版“来电导演/输出协议”升级为硬约束版本。
            const upgradeSingleCall = workflow => {
                const director = workflow.entries.find(entry => entry.id === 'phone-director' || entry.id === 'single_call-director' || entry.name === '来电导演');
                if (director) director.content = DEFAULT_PHONE_PROMPT;
                const format = workflow.entries.find(entry => entry.id === 'phone-format' || entry.id === 'single_call-format' || entry.name === '输出协议');
                if (format) format.content = DEFAULT_PHONE_FORMAT_PROMPT;
                const nested = Array.isArray(workflow.presets) ? workflow.presets : [];
                nested.forEach(preset => upgradeSingleCall(preset));
            };
            upgradeSingleCall(store.promptWorkflows.single_call);
        }
        if (storedSchemaVersion < 16) {
            // 迁移：按新版方案升级聊天 / 单人电话 / 多人电话工作流条目，职责彻底分家。
            const upgradeEntries = (workflow, upgrades) => {
                for (const [matches, content] of upgrades) {
                    const entry = workflow.entries.find(item => matches(item));
                    if (entry) entry.content = content;
                }
                const nested = Array.isArray(workflow.presets) ? workflow.presets : [];
                nested.forEach(preset => upgradeEntries(preset, upgrades));
            };
            const isEntry = (ids, names) => item => ids.includes(item.id) || names.includes(item.name);
            upgradeEntries(store.promptWorkflows.single_call, [
                [isEntry(['phone-director', 'single_call-director'], ['来电导演', '单人电话导演']), DEFAULT_PHONE_PROMPT],
                [isEntry(['phone-format', 'single_call-format'], ['输出协议', '单人电话输出协议']), DEFAULT_PHONE_FORMAT_PROMPT],
            ]);
            upgradeEntries(store.promptWorkflows.group_call, [
                [isEntry(['track-director', 'group_call-director'], ['私聊导演', '多人通话导演']), DEFAULT_TRACK_PROMPT],
                [isEntry(['track-format', 'group_call-format'], ['输出协议', '多人电话输出协议']), DEFAULT_TRACK_FORMAT_PROMPT],
            ]);
            upgradeEntries(store.promptWorkflows.chat, [
                [isEntry(['chat-character'], ['手机私聊角色']), DEFAULT_CHAT_PROMPT],
                [isEntry(['chat-execution-principle'], ['手机行为执行原则']), DEFAULT_CHAT_EXECUTION_PROMPT],
                [isEntry(['chat-proactive-call'], ['主动来电判断']), DEFAULT_CHAT_PROACTIVE_CALL_PROMPT],
                [isEntry(['chat-format'], ['多消息与富消息协议', '多消息与富消息输出协议']), DEFAULT_CHAT_FORMAT_PROMPT],
            ]);
        }
    } catch (error) {
        console.warn('[Phonie] 提示词工作流迁移失败，已跳过并保留现有数据。', error);
    }
    store.planner.schemaVersion = 16;
    if (!store.phoneChat.presets.some(item => item.id === store.phoneChat.settings.activePresetId)) {
        store.phoneChat.settings.activePresetId = '';
    }
    for (const [key, value] of Object.entries(store.phoneChat.threads)) {
        if (!value || typeof value !== 'object') {
            delete store.phoneChat.threads[key];
            continue;
        }
        const messages = Array.isArray(value.messages) ? value.messages : [];
        Object.assign(value, {
            id: String(value.id || key),
            key: String(key),
            chatId: String(value.chatId || ''),
            charName: String(value.charName || '').trim(),
            userName: String(value.userName || '用户').trim(),
            avatarUrl: String(value.avatarUrl || ''),
            messages: messages.slice(-240).map(message => ({
                id: String(message?.id || createId('chat-message')),
                sender: message?.sender === 'character' ? 'character' : 'user',
                speaker: String(message?.speaker || '').trim().slice(0, 120),
                type: ['text', 'voice', 'image', 'transfer', 'sticker', 'recalled'].includes(message?.type) ? message.type : 'text',
                content: String(message?.content || '').slice(0, 12000),
                translation: String(message?.translation || '').slice(0, 12000),
                emotion: String(message?.emotion || '自然').slice(0, 80),
                description: String(message?.description || '').slice(0, 12000),
                amount: String(message?.amount || '').slice(0, 80),
                note: String(message?.note || '').slice(0, 500),
                stickerName: String(message?.stickerName || message?.note || '').slice(0, 80),
                stickerUrl: String(message?.stickerUrl || ''),
                duration: Math.min(600, Math.max(0, Number(message?.duration) || 0)),
                replyToId: String(message?.replyToId || ''),
                originalType: String(message?.originalType || ''),
                originalContent: String(message?.originalContent || '').slice(0, 12000),
                createdAt: message?.createdAt || new Date().toISOString(),
                recalledAt: message?.recalledAt || '',
            })),
            createdAt: value.createdAt || new Date().toISOString(),
            updatedAt: value.updatedAt || new Date().toISOString(),
        });
    }
    for (const [key, value] of Object.entries(store.phoneChat.groups)) {
        if (!value || typeof value !== 'object') {
            delete store.phoneChat.groups[key];
            continue;
        }
        const memberNames = [...new Set((Array.isArray(value.memberNames) ? value.memberNames : value.members || [])
            .map(name => String(name || '').trim()).filter(Boolean))].slice(0, 8);
        if (memberNames.length < 2) {
            delete store.phoneChat.groups[key];
            continue;
        }
        const messages = Array.isArray(value.messages) ? value.messages : [];
        Object.assign(value, {
            id: String(value.id || key),
            name: String(value.name || memberNames.join('、')).trim().slice(0, 80) || memberNames.join('、'),
            memberNames,
            userName: String(value.userName || '用户').trim().slice(0, 80) || '用户',
            messages: messages.slice(-400).map(message => ({
                id: String(message?.id || createId('group-message')),
                sender: message?.sender === 'character' ? 'character' : 'user',
                speaker: String(message?.speaker || '').trim().slice(0, 120),
                type: ['text', 'voice', 'image', 'transfer', 'sticker', 'recalled'].includes(message?.type) ? message.type : 'text',
                content: String(message?.content || '').slice(0, 12000),
                translation: String(message?.translation || '').slice(0, 12000),
                emotion: String(message?.emotion || '自然').slice(0, 80),
                description: String(message?.description || '').slice(0, 12000),
                amount: String(message?.amount || '').slice(0, 80),
                note: String(message?.note || '').slice(0, 500),
                duration: Math.min(600, Math.max(0, Number(message?.duration) || 0)),
                replyToId: String(message?.replyToId || ''),
                originalType: String(message?.originalType || ''),
                originalContent: String(message?.originalContent || '').slice(0, 12000),
                createdAt: message?.createdAt || new Date().toISOString(),
                recalledAt: message?.recalledAt || '',
            })),
            createdAt: value.createdAt || new Date().toISOString(),
            updatedAt: value.updatedAt || new Date().toISOString(),
        });
    }
    if (!store.phoneChat.groups[store.phoneChat.activeGroupId]) store.phoneChat.activeGroupId = '';
    if (!store.promptPresets.some(item => item.id === store.planner.activePromptPresetId)) {
        store.planner.activePromptPresetId = '';
    }
    if (!store.apiPresets.some(item => item.id === store.planner.activeApiPresetId)) {
        store.planner.activeApiPresetId = '';
    }
    return store;
}

function emitChange(type, detail = {}) {
    const payload = { type, ...detail, snapshot: getSnapshot() };
    listeners.forEach(listener => listener(payload));
    window.dispatchEvent(new CustomEvent('tts:frontend-tools-change', { detail: payload }));
}

function persist(type, detail) {
    saveSettingsDebounced();
    emitChange(type, detail);
}

function getPlannerSettings() {
    return clone(ensureStore().planner);
}

function updatePlannerSettings(updates = {}) {
    const store = ensureStore();
    const previous = JSON.stringify(store.planner);
    const next = {
        ...store.planner,
        ...(updates.mode !== undefined ? { mode: updates.mode === 'custom' ? 'custom' : 'sillytavern' } : {}),
        ...(updates.apiUrl !== undefined ? { apiUrl: String(updates.apiUrl || '').trim() } : {}),
        ...(updates.apiKey !== undefined ? { apiKey: String(updates.apiKey || '').trim() } : {}),
        ...(updates.model !== undefined ? { model: String(updates.model || '').trim() } : {}),
        ...(updates.temperature !== undefined ? { temperature: Number(updates.temperature) } : {}),
        ...(updates.maxTokens !== undefined ? { maxTokens: Number(updates.maxTokens) } : {}),
        ...(updates.contextLimit !== undefined ? { contextLimit: Number(updates.contextLimit) } : {}),
        ...(updates.phonePrompt !== undefined ? { phonePrompt: String(updates.phonePrompt || '').trim() } : {}),
        ...(updates.trackPrompt !== undefined ? { trackPrompt: String(updates.trackPrompt || '').trim() } : {}),
        ...(updates.outputLanguage !== undefined ? { outputLanguage: String(updates.outputLanguage || 'auto') } : {}),
        ...(updates.customLanguage !== undefined ? { customLanguage: String(updates.customLanguage || '').trim().slice(0, 200) } : {}),
        ...(updates.bodyPromptEnabled !== undefined ? { bodyPromptEnabled: Boolean(updates.bodyPromptEnabled) } : {}),
        ...(updates.bodyPrompt !== undefined ? { bodyPrompt: String(updates.bodyPrompt || '').trim() } : {}),
        ...(updates.activePromptPresetId !== undefined ? { activePromptPresetId: String(updates.activePromptPresetId || '') } : {}),
        ...(updates.activeApiPresetId !== undefined ? { activeApiPresetId: String(updates.activeApiPresetId || '') } : {}),
    };
    delete next.autoTrack;
    store.planner = next;
    if (updates.phonePrompt !== undefined) replacePrimaryWorkflowPrompt(store, 'single_call', updates.phonePrompt);
    if (updates.trackPrompt !== undefined) replacePrimaryWorkflowPrompt(store, 'group_call', updates.trackPrompt);
    if (updates.bodyPrompt !== undefined) replacePrimaryWorkflowPrompt(store, 'body', updates.bodyPrompt);
    ensureStore();
    if (previous !== JSON.stringify(store.planner)) {
        applyBodyPromptInjection();
        persist('planner-settings');
    }
    return getPlannerSettings();
}

function resolveOutputLanguage(planner = getPlannerSettings()) {
    const selected = OUTPUT_LANGUAGES[planner.outputLanguage] || OUTPUT_LANGUAGES.auto;
    if (planner.outputLanguage !== 'custom') return selected;
    const customLanguage = String(planner.customLanguage || '').trim();
    return {
        label: customLanguage || selected.label,
        instruction: customLanguage
            ? `所有可朗读台词必须严格遵循这项语言或方言要求：${customLanguage}`
            : OUTPUT_LANGUAGES.auto.instruction,
    };
}

function stripMessageMarkup(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\[(?:TTSVoice|TTS):[^\]]+\]/gi, ' ')
        .replace(/【语音:[\s\S]*?【\/语音】/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function resolveCurrentCharacter(context) {
    const characters = Array.isArray(context?.characters) ? context.characters : [];
    const characterId = context?.characterId;
    const byIndex = Number.isInteger(Number(characterId)) ? characters[Number(characterId)] : null;
    const byIdentity = characters.find(character => (
        character?.avatar === characterId
        || character?.id === characterId
        || character?.name === context?.name2
    ));
    return byIndex || byIdentity || null;
}

function getContextSnapshot(limit = getPlannerSettings().contextLimit) {
    const context = window.SillyTavern?.getContext?.() || null;
    const character = resolveCurrentCharacter(context);
    const charName = String(character?.name || context?.name2 || '').trim();
    const userName = String(context?.name1 || '用户').trim();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const floorLimit = Number(limit);
    const selectedFloors = floorLimit === 0
        ? chat
        : chat.slice(-Math.max(1, floorLimit || DEFAULT_PLANNER.contextLimit));
    const messages = selectedFloors
        .map(message => ({
            role: message?.is_user ? 'user' : 'assistant',
            name: String(message?.name || (message?.is_user ? userName : charName) || '').trim(),
            content: stripMessageMarkup(message?.mes),
        }))
        .filter(message => message.content);

    const rawAvatar = String(character?.avatar || character?.avatar_url || '');
    let avatarUrl = rawAvatar;
    if (rawAvatar && typeof context?.getThumbnailUrl === 'function') {
        try {
            avatarUrl = context.getThumbnailUrl('avatar', rawAvatar) || rawAvatar;
        } catch {
            avatarUrl = rawAvatar;
        }
    }

    return {
        available: Boolean(context && charName),
        charName,
        userName,
        avatarUrl,
        chatId: String(context?.chatId || ''),
        messageCount: chat.length,
        floorCount: chat.length,
        includedFloorCount: selectedFloors.length,
        messages,
    };
}

function phoneChatThreadKey(context = getContextSnapshot()) {
    const chatId = String(context.chatId || '').trim();
    const charName = String(context.charName || '').trim();
    return `${chatId || 'current-chat'}::${charName || 'current-character'}`;
}

function ensurePhoneChatThread(store = ensureStore(), context = getContextSnapshot()) {
    const key = phoneChatThreadKey(context);
    let thread = store.phoneChat.threads[key];
    if (!thread) {
        const now = new Date().toISOString();
        thread = {
            id: createId('phone-chat'),
            key,
            chatId: context.chatId || '',
            charName: context.charName || '',
            userName: context.userName || '用户',
            avatarUrl: context.avatarUrl || '',
            messages: [],
            createdAt: now,
            updatedAt: now,
        };
        store.phoneChat.threads[key] = thread;
    }
    thread.chatId = context.chatId || thread.chatId || '';
    thread.charName = context.charName || thread.charName || '';
    thread.userName = context.userName || thread.userName || '用户';
    thread.avatarUrl = context.avatarUrl || thread.avatarUrl || '';
    return thread;
}

function getPhoneChatSnapshot() {
    const store = ensureStore();
    const context = getContextSnapshot(store.planner.contextLimit);
    const thread = ensurePhoneChatThread(store, context);
    return {
        settings: clone(store.phoneChat.settings),
        presets: clone(store.phoneChat.presets),
        thread: clone(thread),
        pendingCount: getPendingPhoneChatMessages(thread).length,
        context,
    };
}

function updatePhoneChatSettings(updates = {}) {
    const store = ensureStore();
    const settings = store.phoneChat.settings;
    if (updates.prompt !== undefined) {
        settings.prompt = String(updates.prompt || '').trim() || DEFAULT_CHAT_PROMPT;
        replacePrimaryWorkflowPrompt(store, 'chat', settings.prompt);
    }
    if (updates.maxHistory !== undefined) settings.maxHistory = Math.min(240, Math.max(8, Math.round(Number(updates.maxHistory) || DEFAULT_CHAT_SETTINGS.maxHistory)));
    if (updates.autoVoice !== undefined) settings.autoVoice = updates.autoVoice === true;
    if (updates.activePresetId !== undefined) settings.activePresetId = String(updates.activePresetId || '').trim();
    persist('phone-chat-settings');
    return clone(settings);
}

function assertPromptWorkflow(kind) {
    if (!PROMPT_WORKFLOW_LABELS[kind]) throw new Error('未知的提示词用途。');
    return kind;
}

function syncLegacyWorkflowPrompt(store, kind) {
    const value = getPrimaryWorkflowPrompt(store, kind);
    if (kind === 'body') store.planner.bodyPrompt = value || DEFAULT_BODY_TTS_PROMPT;
    if (kind === 'single_call') store.planner.phonePrompt = value || DEFAULT_PHONE_PROMPT;
    if (kind === 'group_call') store.planner.trackPrompt = value || DEFAULT_TRACK_PROMPT;
    if (kind === 'chat') store.phoneChat.settings.prompt = value || DEFAULT_CHAT_PROMPT;
}

function getPromptWorkflows() {
    const store = ensureStore();
    return clone(Object.fromEntries(Object.entries(store.promptWorkflows).map(([kind, workflow]) => [kind, {
        ...workflow,
        label: PROMPT_WORKFLOW_LABELS[kind],
    }])));
}

function getPromptWorkflow(kind) {
    assertPromptWorkflow(kind);
    const workflow = ensureStore().promptWorkflows[kind];
    return clone({ ...workflow, kind, label: PROMPT_WORKFLOW_LABELS[kind] });
}

function updatePromptWorkflowEntries(kind, entries) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    store.promptWorkflows[kind].entries = sanitizePromptEntries(entries, kind);
    store.promptWorkflows[kind].activePresetId = '';
    syncLegacyWorkflowPrompt(store, kind);
    if (kind === 'body') applyBodyPromptInjection();
    persist('prompt-workflow', { kind, action: 'update' });
    return getPromptWorkflow(kind);
}

function updatePromptWorkflowDepth(kind, depth) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    store.promptWorkflows[kind].depth = Math.min(20, Math.max(0, Math.round(Number(depth) || 0)));
    if (kind === 'body') applyBodyPromptInjection();
    persist('prompt-workflow', { kind, action: 'depth', depth: store.promptWorkflows[kind].depth });
    return getPromptWorkflow(kind);
}

function insertPromptWorkflowEntry(kind, afterId = '', values = {}) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    const workflow = store.promptWorkflows[kind];
    const entry = {
        id: createId(`prompt-${kind}`),
        name: String(values.name || '新条目').trim().slice(0, 80) || '新条目',
        role: ['system', 'user', 'assistant'].includes(values.role) ? values.role : 'system',
        enabled: values.enabled !== false,
        content: String(values.content || ''),
    };
    const index = workflow.entries.findIndex(item => item.id === afterId);
    workflow.entries.splice(index < 0 ? workflow.entries.length : index + 1, 0, entry);
    workflow.activePresetId = '';
    syncLegacyWorkflowPrompt(store, kind);
    if (kind === 'body') applyBodyPromptInjection();
    persist('prompt-workflow', { kind, action: 'insert', id: entry.id });
    return clone(entry);
}

function movePromptWorkflowEntry(kind, id, direction) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    const entries = store.promptWorkflows[kind].entries;
    const index = entries.findIndex(item => item.id === id);
    const target = direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : Number(direction);
    if (index < 0 || !Number.isInteger(target) || target < 0 || target >= entries.length || target === index) return false;
    const [entry] = entries.splice(index, 1);
    entries.splice(target, 0, entry);
    store.promptWorkflows[kind].activePresetId = '';
    persist('prompt-workflow', { kind, action: 'move', id, index: target });
    return true;
}

function deletePromptWorkflowEntry(kind, id) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    const entries = store.promptWorkflows[kind].entries;
    const index = entries.findIndex(item => item.id === id);
    if (index < 0) return false;
    entries.splice(index, 1);
    if (!entries.length) entries.push(...cloneDefaultWorkflowEntries(kind));
    store.promptWorkflows[kind].activePresetId = '';
    syncLegacyWorkflowPrompt(store, kind);
    if (kind === 'body') applyBodyPromptInjection();
    persist('prompt-workflow', { kind, action: 'delete', id });
    return true;
}

function savePromptWorkflowPreset(kind, name) {
    assertPromptWorkflow(kind);
    const presetName = String(name || '').trim().slice(0, 60);
    if (!presetName) throw new Error('请先填写预设名称。');
    const store = ensureStore();
    const workflow = store.promptWorkflows[kind];
    let preset = workflow.presets.find(item => item.name.toLocaleLowerCase('zh-CN') === presetName.toLocaleLowerCase('zh-CN'));
    const values = { name: presetName, entries: clone(workflow.entries), updatedAt: new Date().toISOString() };
    if (preset) Object.assign(preset, values);
    else {
        preset = { id: createId(`prompt-${kind}-preset`), ...values };
        workflow.presets.unshift(preset);
        workflow.presets = workflow.presets.slice(0, 50);
    }
    workflow.activePresetId = preset.id;
    persist('prompt-workflow-preset', { kind, action: 'save', id: preset.id });
    return clone(preset);
}

function applyPromptWorkflowPreset(kind, id) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    const workflow = store.promptWorkflows[kind];
    const preset = workflow.presets.find(item => item.id === id);
    if (!preset) throw new Error('找不到这个提示词预设。');
    workflow.entries = sanitizePromptEntries(clone(preset.entries), kind);
    workflow.activePresetId = preset.id;
    syncLegacyWorkflowPrompt(store, kind);
    if (kind === 'body') applyBodyPromptInjection();
    persist('prompt-workflow-preset', { kind, action: 'apply', id });
    return clone(preset);
}

function deletePromptWorkflowPreset(kind, id) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    const workflow = store.promptWorkflows[kind];
    const index = workflow.presets.findIndex(item => item.id === id);
    if (index < 0) return false;
    workflow.presets.splice(index, 1);
    if (workflow.activePresetId === id) workflow.activePresetId = '';
    persist('prompt-workflow-preset', { kind, action: 'delete', id });
    return true;
}

function resetPromptWorkflow(kind) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    store.promptWorkflows[kind].entries = cloneDefaultWorkflowEntries(kind);
    store.promptWorkflows[kind].activePresetId = '';
    syncLegacyWorkflowPrompt(store, kind);
    if (kind === 'body') applyBodyPromptInjection();
    persist('prompt-workflow', { kind, action: 'reset' });
    return getPromptWorkflow(kind);
}

function exportPromptPresetData(kind = 'all') {
    const store = ensureStore();
    const selectedKinds = kind === 'all' ? Object.keys(PROMPT_WORKFLOW_LABELS) : [assertPromptWorkflow(kind)];
    return clone({
        type: 'sillytavern-gpt-sovits-prompt-presets',
        version: 1,
        exportedAt: new Date().toISOString(),
        workflows: Object.fromEntries(selectedKinds.map(item => [item, store.promptWorkflows[item]])),
    });
}

function importPromptPresetData(payload, preferredKind = '') {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!data || typeof data !== 'object') throw new Error('导入文件不是有效的提示词预设。');
    const sourceWorkflows = data.workflows && typeof data.workflows === 'object'
        ? data.workflows
        : preferredKind && Array.isArray(data.entries) ? { [preferredKind]: data } : {};
    const store = ensureStore();
    const imported = [];
    for (const [kind, source] of Object.entries(sourceWorkflows)) {
        if (!PROMPT_WORKFLOW_LABELS[kind] || !source || typeof source !== 'object') continue;
        if (Array.isArray(source.entries)) store.promptWorkflows[kind].entries = sanitizePromptEntries(source.entries, kind);
        const presets = Array.isArray(source.presets) ? source.presets : [];
        presets.forEach(item => {
            if (!item?.name || !Array.isArray(item.entries)) return;
            const name = String(item.name).trim().slice(0, 60);
            let target = store.promptWorkflows[kind].presets.find(preset => preset.name.toLocaleLowerCase('zh-CN') === name.toLocaleLowerCase('zh-CN'));
            const values = { name, entries: sanitizePromptEntries(item.entries, kind), updatedAt: new Date().toISOString() };
            if (target) Object.assign(target, values);
            else store.promptWorkflows[kind].presets.unshift({ id: createId(`prompt-${kind}-preset`), ...values });
        });
        store.promptWorkflows[kind].presets = store.promptWorkflows[kind].presets.slice(0, 50);
        store.promptWorkflows[kind].activePresetId = '';
        syncLegacyWorkflowPrompt(store, kind);
        imported.push(kind);
    }
    if (!imported.length) throw new Error('文件中没有可导入的正文、来电、追踪或聊天预设。');
    applyBodyPromptInjection();
    persist('prompt-workflow-import', { kinds: imported });
    return getPromptWorkflows();
}

function getPromptLabValues(kind) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    const context = getContextSnapshot(store.planner.contextLimit);
    const language = resolveOutputLanguage(store.planner);
    const availableCharacters = getAvailableVoiceCharacters();
    const thread = ensurePhoneChatThread(store, context);
    const history = thread.messages.slice(-store.phoneChat.settings.maxHistory)
        .map(message => formatPhoneChatMessage(message, thread))
        .join('\n');
    const pending = getPendingPhoneChatMessages(thread)
        .map(message => formatPhoneChatMessage(message, thread))
        .join('\n');
    const recentContext = formatContext(context);
    const outputFormats = {
        body: getBodyPromptFormatExample(),
        phone: '{"caller":"","title":"","reason":"","tone":"","segments":[{"speaker":"","emotion":"","text":"","translation":""}]}',
        track: '{"sceneDescription":"","summary":"","mood":"","scene":"","speakers":[""],"threads":[""],"segments":[{"speaker":"","emotion":"","text":"","translation":""}]}',
        chat: '{"messages":[{"type":"text","emotion":"自然","text":"","translation":"","description":"","amount":"","note":"","duration":0}]}',
    };
    const lengths = { body: '正文自然长度', phone: '7 到 10 句', track: '15 到 28 段', chat: '1 到 8 条消息' };
    return {
        角色: context.charName || '当前角色',
        用户: context.userName || '用户',
        长度: lengths[kind],
        语言: language.instruction,
        格式: kind === 'body' ? getBodyPromptFormatExample() : outputFormats[kind],
        可用声线: availableCharacters.map(item => item.name).join('、') || '尚未配置',
        角色卡与世界书: '运行正式任务时读取当前角色卡与已激活世界书',
        聊天记录: history || '暂无手机聊天记录',
        待回复消息: pending || '暂无待回复消息',
        任务上下文: recentContext || '暂无正文上下文',
        输出格式: outputFormats[kind],
    };
}

function compilePromptWorkflow(kind) {
    assertPromptWorkflow(kind);
    const workflow = getPromptWorkflow(kind);
    const values = getPromptLabValues(kind);
    const enabledEntries = workflow.entries.filter(entry => entry.enabled && String(entry.content || '').trim());
    const messages = enabledEntries.map(entry => ({
        id: entry.id,
        name: entry.name,
        role: ['system', 'user', 'assistant'].includes(entry.role) ? entry.role : 'system',
        content: renderPromptTemplate(entry.content, values).trim(),
    })).filter(message => message.content);
    const issues = [];
    if (!messages.length) issues.push({ severity: 'error', message: '没有启用的提示词条目。' });
    const duplicateIds = workflow.entries.filter((entry, index, items) => items.findIndex(item => item.id === entry.id) !== index);
    if (duplicateIds.length) issues.push({ severity: 'error', message: `有 ${duplicateIds.length} 个重复条目标识。` });
    const unresolved = [...new Set(messages.flatMap(message => (
        [...message.content.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1])
    )))];
    if (unresolved.length) issues.push({ severity: 'warning', message: `未解析变量：${unresolved.join('、')}` });
    if (kind !== 'body' && !messages.some(message => message.role === 'user')) {
        issues.push({ severity: 'warning', message: '没有 user 条目，部分模型可能忽略任务上下文。' });
    }
    const combined = messages.map(message => message.content).join('\n');
    if (kind === 'body' && !/TTSVoice|\[TTS:/i.test(combined)) {
        issues.push({ severity: 'warning', message: '正文规则中没有可识别的 TTS 标签格式。' });
    }
    if (kind !== 'body' && !/JSON/i.test(combined)) {
        issues.push({ severity: 'warning', message: '没有明确要求 JSON 输出，编排结果可能无法识别。' });
    }
    if (!issues.some(issue => issue.severity === 'error')) {
        issues.push({ severity: 'ready', message: unresolved.length ? '可以试运行，但建议先处理警告。' : '结构检查通过，可以试运行。' });
    }
    const characterCount = messages.reduce((sum, message) => sum + message.content.length, 0);
    return clone({
        kind,
        label: PROMPT_WORKFLOW_LABELS[kind],
        values,
        messages,
        issues,
        stats: {
            entries: workflow.entries.length,
            enabledEntries: enabledEntries.length,
            messages: messages.length,
            characters: characterCount,
            estimatedTokens: Math.max(1, Math.ceil(characterCount / 2)),
        },
    });
}

async function testPromptWorkflow(kind) {
    const compiled = compilePromptWorkflow(kind);
    const blocking = compiled.issues.find(issue => issue.severity === 'error');
    if (blocking) throw new Error(blocking.message);
    const schemas = { phone: PHONE_SCHEMA, single_call: PHONE_SCHEMA, group_call: GROUP_CALL_PHONE_SCHEMA, chat: CHAT_SCHEMA };
    const raw = await callPlanner('', '', schemas[kind], compiled.messages.map(({ role, content }) => ({ role, content })));
    let output = raw;
    if (kind !== 'body') output = extractStructuredResult(raw, kind);
    const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    if (!String(text || '').trim()) throw new Error('试运行没有返回内容。');
    return {
        kind,
        createdAt: new Date().toISOString(),
        output: String(text).trim().slice(0, 30000),
    };
}

function getPromptWorkflowRevisions(kind) {
    assertPromptWorkflow(kind);
    return clone(ensureStore().promptRevisions[kind] || []);
}

function savePromptWorkflowRevision(kind, name = '') {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    const now = new Date();
    const fallbackName = `${PROMPT_WORKFLOW_LABELS[kind]} ${now.toLocaleString('zh-CN', { hour12: false })}`;
    const revision = {
        id: createId(`prompt-${kind}-revision`),
        name: String(name || fallbackName).trim().slice(0, 60) || fallbackName,
        entries: clone(store.promptWorkflows[kind].entries),
        createdAt: now.toISOString(),
    };
    store.promptRevisions[kind].unshift(revision);
    store.promptRevisions[kind] = store.promptRevisions[kind].slice(0, 30);
    persist('prompt-workflow-revision', { kind, action: 'save', id: revision.id });
    return clone(revision);
}

function restorePromptWorkflowRevision(kind, id) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    const revision = store.promptRevisions[kind].find(item => item.id === id);
    if (!revision) throw new Error('找不到这个提示词版本。');
    const backup = {
        id: createId(`prompt-${kind}-revision`),
        name: '恢复前自动备份',
        entries: clone(store.promptWorkflows[kind].entries),
        createdAt: new Date().toISOString(),
    };
    store.promptRevisions[kind].unshift(backup);
    store.promptRevisions[kind] = store.promptRevisions[kind].slice(0, 30);
    store.promptWorkflows[kind].entries = sanitizePromptEntries(clone(revision.entries), kind);
    store.promptWorkflows[kind].activePresetId = '';
    syncLegacyWorkflowPrompt(store, kind);
    if (kind === 'body') applyBodyPromptInjection();
    persist('prompt-workflow-revision', { kind, action: 'restore', id });
    return getPromptWorkflow(kind);
}

function deletePromptWorkflowRevision(kind, id) {
    assertPromptWorkflow(kind);
    const store = ensureStore();
    const index = store.promptRevisions[kind].findIndex(item => item.id === id);
    if (index < 0) return false;
    store.promptRevisions[kind].splice(index, 1);
    persist('prompt-workflow-revision', { kind, action: 'delete', id });
    return true;
}

function getPhoneChatPromptPresets() {
    return clone(ensureStore().phoneChat.presets);
}

function savePhoneChatPromptPreset(name) {
    const presetName = String(name || '').trim().slice(0, 60);
    if (!presetName) throw new Error('请先填写聊天预设名称。');
    const store = ensureStore();
    const settings = store.phoneChat.settings;
    let preset = store.phoneChat.presets.find(item => item.name.toLocaleLowerCase('zh-CN') === presetName.toLocaleLowerCase('zh-CN'));
    const values = {
        name: presetName,
        prompt: settings.prompt,
        maxHistory: settings.maxHistory,
        autoVoice: settings.autoVoice,
        updatedAt: new Date().toISOString(),
    };
    if (preset) Object.assign(preset, values);
    else {
        preset = { id: createId('chat-prompt'), ...values };
        store.phoneChat.presets.unshift(preset);
        store.phoneChat.presets = store.phoneChat.presets.slice(0, 40);
    }
    store.phoneChat.settings.activePresetId = preset.id;
    persist('phone-chat-preset', { id: preset.id, action: 'save' });
    return clone(preset);
}

function applyPhoneChatPromptPreset(id) {
    const store = ensureStore();
    const preset = store.phoneChat.presets.find(item => item.id === id);
    if (!preset) throw new Error('找不到这个聊天提示词预设。');
    Object.assign(store.phoneChat.settings, {
        prompt: preset.prompt,
        maxHistory: preset.maxHistory,
        autoVoice: preset.autoVoice,
        activePresetId: preset.id,
    });
    replacePrimaryWorkflowPrompt(store, 'chat', preset.prompt);
    persist('phone-chat-preset', { id: preset.id, action: 'apply' });
    return clone(preset);
}

function deletePhoneChatPromptPreset(id) {
    const store = ensureStore();
    const index = store.phoneChat.presets.findIndex(item => item.id === id);
    if (index < 0) return false;
    store.phoneChat.presets.splice(index, 1);
    if (store.phoneChat.settings.activePresetId === id) store.phoneChat.settings.activePresetId = '';
    persist('phone-chat-preset', { id, action: 'delete' });
    return true;
}

function resetPhoneChatPrompt() {
    resetPromptWorkflow('chat');
    return updatePhoneChatSettings({
        maxHistory: DEFAULT_CHAT_SETTINGS.maxHistory,
        autoVoice: DEFAULT_CHAT_SETTINGS.autoVoice,
        activePresetId: '',
    });
}

function findPhoneChatMessage(thread, id) {
    return thread.messages.find(message => message.id === id) || null;
}

function formatPhoneChatMessage(message, thread) {
    if (message.type === 'recalled') {
        return message.sender === 'user'
            ? `【${thread.userName}撤回了一条消息】`
            : `【${thread.charName}撤回了一条消息】`;
    }
    const sender = message.sender === 'character' ? thread.charName : thread.userName;
    const kindLabels = { text: '文字', voice: '语音', image: '图片', transfer: '转账', sticker: '表情包' };
    const kind = kindLabels[message.type] || '文字';
    let content = message.content;
    if (message.type === 'image') content = message.description || message.content || '未填写图片描述';
    if (message.type === 'transfer') content = `${message.amount || '0'} 元${message.note ? `｜${message.note}` : ''}`;
    if (message.type === 'sticker') content = `表情包：${message.stickerName || message.note || message.content || '未命名'}`;
    if (message.type === 'voice') content = `${message.duration ? `${message.duration} 秒｜` : ''}${message.content}`;
    const quote = message.replyToId ? `（回复 #${message.replyToId}）` : '';
    return `[#${message.id}] ${sender}${quote}【${kind}】：${content}`;
}

function getPendingPhoneChatMessages(thread) {
    let lastCharacterIndex = -1;
    thread.messages.forEach((message, index) => {
        if (message.sender === 'character' && message.type !== 'recalled') lastCharacterIndex = index;
    });
    return thread.messages.slice(lastCharacterIndex + 1).filter(message => message.sender === 'user' && message.type !== 'recalled');
}

function appendPhoneChatMessage({ text = '', type = 'text', replyToId = '', description = '', amount = '', note = '', stickerName = '', stickerUrl = '', duration = 0 } = {}) {
    const store = ensureStore();
    const context = getContextSnapshot(store.planner.contextLimit);
    if (!context.available) throw new Error('请先打开一个角色对话。');
    const thread = ensurePhoneChatThread(store, context);
    const quoted = replyToId ? findPhoneChatMessage(thread, replyToId) : null;
    const normalizedType = ['text', 'voice', 'image', 'transfer', 'sticker'].includes(type) ? type : 'text';
    const content = String(text || '').trim().slice(0, 12000);
    const imageDescription = String(description || content).trim().slice(0, 12000);
    const money = String(amount || '').trim().slice(0, 80);
    const memo = String(note || '').trim().slice(0, 500);
    const stickerLabel = String(stickerName || '').trim().slice(0, 80);
    const stickerLink = String(stickerUrl || '').trim();
    if (normalizedType === 'image' && !imageDescription) throw new Error('请填写图片里有什么。');
    if (normalizedType === 'sticker' && !stickerLabel) throw new Error('请选择一个表情包。');
    if (normalizedType === 'transfer' && !money) throw new Error('请填写金额。');
    if (['text', 'voice'].includes(normalizedType) && !content) throw new Error('请先输入要发送的消息。');
    const userMessage = {
        id: createId('chat-message'),
        sender: 'user',
        type: normalizedType,
        content: normalizedType === 'image'
            ? imageDescription
            : normalizedType === 'sticker'
                ? stickerLabel
                : content || memo,
        translation: '',
        emotion: '自然',
        description: normalizedType === 'image' ? imageDescription : '',
        amount: normalizedType === 'transfer' ? money : '',
        note: normalizedType === 'transfer' ? memo : '',
        stickerName: normalizedType === 'sticker' ? stickerLabel : '',
        stickerUrl: normalizedType === 'sticker' ? stickerLink : '',
        duration: normalizedType === 'voice' ? Math.min(600, Math.max(1, Math.round(Number(duration) || Math.max(1, content.length / 5)))) : 0,
        replyToId: quoted?.id || '',
        originalType: '',
        originalContent: '',
        createdAt: new Date().toISOString(),
        recalledAt: '',
    };
    thread.messages.push(userMessage);
    thread.messages = thread.messages.slice(-240);
    thread.updatedAt = new Date().toISOString();
    persist('phone-chat-message', { threadId: thread.id, messageId: userMessage.id, sender: 'user' });
    return { userMessage: clone(userMessage), pendingCount: getPendingPhoneChatMessages(thread).length, thread: clone(thread) };
}

async function generatePhoneChatReply({ preferVoice = false, proactiveBrief = '' } = {}) {
    const store = ensureStore();
    const context = getContextSnapshot(store.planner.contextLimit);
    if (!context.available) throw new Error('请先打开一个角色对话。');
    const thread = ensurePhoneChatThread(store, context);
    const settings = store.phoneChat.settings;
    const pendingMessages = getPendingPhoneChatMessages(thread);
    const proactive = String(proactiveBrief || '').trim().slice(0, 1000);
    if (!pendingMessages.length && !proactive) throw new Error('请先发送一条或多条消息，再让角色回复。');
    const planner = getPlannerSettings();
    const language = resolveOutputLanguage(planner);
    const lore = await collectLoreContext(context);
    const history = thread.messages
        .slice(-settings.maxHistory)
        .map(message => formatPhoneChatMessage(message, thread))
        .join('\n');
    const taskContext = [
        formatLorePrompt(lore),
        `SillyTavern 当前正文上下文：\n${formatContext(context) || '暂无正文消息。'}`,
        `手机私聊记录：\n${history}`,
        pendingMessages.length
            ? `本轮等待回复的 ${pendingMessages.length} 条用户消息：\n${pendingMessages.map(message => formatPhoneChatMessage(message, thread)).join('\n')}`
            : `这是 ${context.charName} 主动发起的新消息，不是在回复用户。主动联系的方向：${proactive || '从当前剧情和关系中选择自然话题。'}`,
        pendingMessages.length
            ? `请让 ${context.charName} 现在回复；可以连续发送多条短消息。`
            : `请让 ${context.charName} 像真实联系人一样主动联系 ${context.userName}；可以连续发送多条短消息，不要说自己被要求主动发消息。`,
    ].join('\n\n');
    const messages = buildPromptWorkflowMessages('chat', {
        角色: context.charName,
        用户: context.userName,
        长度: '1 到 8 条消息',
        语言: language.instruction,
        格式: '',
        角色卡与世界书: formatLorePrompt(lore),
        聊天记录: history,
        待回复消息: pendingMessages.map(message => formatPhoneChatMessage(message, thread)).join('\n') || '本轮没有用户消息，角色主动开启话题。',
        任务上下文: taskContext,
        输出格式: `只返回严格 JSON，不要输出 Markdown、角色名、思考过程或额外说明：{"messages":[{"type":"text","emotion":"自然","text":"角色实际发送的原语言内容","translation":"自然中文译文","description":"","amount":"","note":"","duration":0}],"proactiveCall":{"shouldCall":false,"caller":"","reason":"","tone":""}}。messages 必须有 1 到 8 条；type 只能是 text、voice、image、transfer、sticker。image 用 description 描述要生成的画面，非图片消息 description 留空；非金额消息 amount 与 note 留空；非语音 duration 为 0；proactiveCall 每轮都要输出，没有来电意图时 shouldCall 为 false，有来电意图时填好 caller、reason、tone。${preferVoice || settings.autoVoice ? '这次普通文字消息必须改为 voice。' : ''}`,
    });

    let result = null;
    let lastError = null;
    let proactiveCall = { shouldCall: false, caller: '', reason: '', tone: '' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const repair = attempt ? '\n上次回复格式或中文译文不合格。这次只返回完整 JSON。' : '';
            const attemptMessages = messages.map((message, index) => index === messages.length - 1
                ? { ...message, content: `${message.content}${repair}` }
                : message);
            const raw = await callPlanner('', '', CHAT_SCHEMA, attemptMessages);
            const structured = extractStructuredResult(raw, 'chat');
            const sourceProactiveCall = structured?.proactiveCall && typeof structured.proactiveCall === 'object'
                ? structured.proactiveCall
                : null;
            proactiveCall = {
                shouldCall: sourceProactiveCall?.shouldCall === true,
                caller: String(sourceProactiveCall?.caller || '').trim().slice(0, 120),
                reason: String(sourceProactiveCall?.reason || '').trim().slice(0, 1200),
                tone: String(sourceProactiveCall?.tone || '').trim().slice(0, 80),
            };
            const sourceMessages = Array.isArray(structured?.messages)
                ? structured.messages
                : structured?.text ? [{ ...structured, type: structured.replyType || 'text' }] : [];
            const normalized = sourceMessages.slice(0, 8).map(item => {
                let type = ['text', 'voice', 'image', 'transfer', 'sticker'].includes(item?.type) ? item.type : 'text';
                if ((preferVoice || settings.autoVoice) && type === 'text') type = 'voice';
                const text = String(item?.text || item?.description || item?.note || '').trim().slice(0, 12000);
                const description = String(item?.description || (type === 'image' ? text : '')).trim().slice(0, 12000);
                const amount = String(item?.amount || '').trim().slice(0, 80);
                const note = String(item?.note || '').trim().slice(0, 500);
                let translation = String(item?.translation || '').trim().slice(0, 12000);
                const readable = type === 'image' ? description : text || note;
                if (!readable && !amount) return null;
                if (isLikelyChinese(readable)) translation = readable;
                else if (['text', 'voice', 'image'].includes(type) && !isLikelyChinese(translation)) {
                    throw new Error('角色回复缺少自然中文译文。');
                }
                return {
                    type,
                    emotion: String(item?.emotion || '自然').trim().slice(0, 80) || '自然',
                    text,
                    translation,
                    description,
                    amount,
                    note,
                    stickerName: String(item?.stickerName || item?.note || '').slice(0, 80),
                    duration: type === 'voice' ? Math.min(600, Math.max(1, Math.round(Number(item?.duration) || Math.max(1, text.length / 5)))) : 0,
                };
            }).filter(Boolean);
            if (!normalized.length) throw new Error('角色没有生成聊天内容。');
            result = normalized;
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!result) throw lastError || new Error('角色回复生成失败。');

    const assistantMessages = result.map((item, index) => ({
        id: createId('chat-message'),
        sender: 'character',
        type: item.type,
        content: item.type === 'image'
            ? item.description
            : item.type === 'sticker'
                ? item.stickerName
                : item.text || item.note,
        translation: item.translation,
        emotion: item.emotion,
        description: item.description,
        amount: item.amount,
        note: item.note,
        stickerName: item.stickerName,
        stickerUrl: '',
        duration: item.duration,
        replyToId: '',
        originalType: '',
        originalContent: '',
        createdAt: new Date(Date.now() + index).toISOString(),
        recalledAt: '',
    }));
    thread.messages.push(...assistantMessages);
    thread.messages = thread.messages.slice(-240);
    thread.updatedAt = new Date().toISOString();
    persist('phone-chat-message', { threadId: thread.id, messageIds: assistantMessages.map(message => message.id), sender: 'character', proactive: Boolean(proactive) });
    return {
        assistantMessage: clone(assistantMessages[0]),
        assistantMessages: clone(assistantMessages),
        proactiveCall: clone(proactiveCall),
        thread: clone(thread),
    };
}

function generateProactivePhoneChatMessage({ brief = '', preferVoice = false } = {}) {
    return generatePhoneChatReply({
        preferVoice,
        proactiveBrief: String(brief || '').trim() || '结合当前正文、关系与最近手机聊天，选择角色此刻最自然想主动联系用户的事情。',
    });
}

async function sendPhoneChatMessage({ text = '', replyToId = '', preferVoice = false, type = 'text', description = '', amount = '', note = '', stickerName = '', stickerUrl = '', duration = 0 } = {}) {
    const appended = appendPhoneChatMessage({ text, type, replyToId, description, amount, note, stickerName, stickerUrl, duration });
    const generated = await generatePhoneChatReply({ preferVoice });
    return { ...generated, userMessage: appended.userMessage };
}

function recallPhoneChatMessage(messageId) {
    const store = ensureStore();
    const thread = ensurePhoneChatThread(store, getContextSnapshot(store.planner.contextLimit));
    const message = findPhoneChatMessage(thread, messageId);
    if (!message || message.type === 'recalled') return false;
    message.originalType = message.type;
    message.originalContent = message.content;
    message.type = 'recalled';
    message.content = '';
    message.translation = '';
    message.recalledAt = new Date().toISOString();
    thread.updatedAt = message.recalledAt;
    persist('phone-chat-message', { threadId: thread.id, messageId, action: 'recall' });
    return clone(message);
}

function clearPhoneChatThread() {
    const store = ensureStore();
    const thread = ensurePhoneChatThread(store, getContextSnapshot(store.planner.contextLimit));
    thread.messages = [];
    thread.updatedAt = new Date().toISOString();
    persist('phone-chat-message', { threadId: thread.id, action: 'clear' });
    return true;
}

function groupChatPendingMessages(group) {
    let lastCharacterIndex = -1;
    group.messages.forEach((message, index) => {
        if (message.sender === 'character' && message.type !== 'recalled') lastCharacterIndex = index;
    });
    return group.messages.slice(lastCharacterIndex + 1)
        .filter(message => message.sender === 'user' && message.type !== 'recalled');
}

function getGroupChatSnapshot(groupId = '') {
    const store = ensureStore();
    const groups = Object.values(store.phoneChat.groups)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const requestedId = String(groupId || '').trim();
    const activeId = requestedId && store.phoneChat.groups[requestedId]
        ? requestedId
        : store.phoneChat.activeGroupId && store.phoneChat.groups[store.phoneChat.activeGroupId]
            ? store.phoneChat.activeGroupId
            : groups[0]?.id || '';
    const activeGroup = activeId ? store.phoneChat.groups[activeId] : null;
    return {
        groups: clone(groups),
        activeGroup: activeGroup ? clone(activeGroup) : null,
        activeGroupId: activeId,
        pendingCount: activeGroup ? groupChatPendingMessages(activeGroup).length : 0,
        settings: clone(store.phoneChat.settings),
        context: getContextSnapshot(store.planner.contextLimit),
    };
}

function selectGroupChat(groupId) {
    const store = ensureStore();
    const id = String(groupId || '').trim();
    if (!store.phoneChat.groups[id]) throw new Error('这个群聊不存在。');
    store.phoneChat.activeGroupId = id;
    persist('group-chat-change', { action: 'select', groupId: id });
    return getGroupChatSnapshot(id);
}

function createGroupChat({ name = '', memberNames = [] } = {}) {
    const store = ensureStore();
    const available = new Set(getAvailableVoiceCharacters().map(character => character.name));
    const members = [...new Set((Array.isArray(memberNames) ? memberNames : [])
        .map(value => String(value || '').trim()).filter(value => value && available.has(value)))].slice(0, 8);
    if (members.length < 2) throw new Error('群聊至少需要选择两位已有声线路由的角色。');
    const id = createId('group-chat');
    const now = new Date().toISOString();
    const context = getContextSnapshot(store.planner.contextLimit);
    const group = {
        id,
        name: String(name || members.join('、')).trim().slice(0, 80) || members.join('、'),
        memberNames: members,
        userName: context.userName || '用户',
        messages: [],
        createdAt: now,
        updatedAt: now,
    };
    store.phoneChat.groups[id] = group;
    store.phoneChat.activeGroupId = id;
    persist('group-chat-change', { action: 'create', groupId: id });
    return clone(group);
}

function updateGroupChat(groupId, updates = {}) {
    const store = ensureStore();
    const group = store.phoneChat.groups[String(groupId || '')];
    if (!group) throw new Error('这个群聊不存在。');
    if (updates.memberNames !== undefined) {
        const available = new Set(getAvailableVoiceCharacters().map(character => character.name));
        const members = [...new Set((Array.isArray(updates.memberNames) ? updates.memberNames : [])
            .map(value => String(value || '').trim()).filter(value => value && available.has(value)))].slice(0, 8);
        if (members.length < 2) throw new Error('群聊至少需要保留两位角色。');
        group.memberNames = members;
    }
    if (updates.name !== undefined) {
        group.name = String(updates.name || group.memberNames.join('、')).trim().slice(0, 80) || group.memberNames.join('、');
    }
    group.updatedAt = new Date().toISOString();
    persist('group-chat-change', { action: 'update', groupId: group.id });
    return clone(group);
}

function deleteGroupChat(groupId) {
    const store = ensureStore();
    const id = String(groupId || '').trim();
    if (!store.phoneChat.groups[id]) return false;
    delete store.phoneChat.groups[id];
    if (store.phoneChat.activeGroupId === id) store.phoneChat.activeGroupId = '';
    persist('group-chat-change', { action: 'delete', groupId: id });
    return true;
}

function findGroupChatMessage(group, messageId) {
    return group.messages.find(message => message.id === messageId) || null;
}

function appendGroupChatMessage(groupId, { text = '', type = 'text', replyToId = '', description = '', amount = '', note = '', stickerName = '', stickerUrl = '', duration = 0 } = {}) {
    const store = ensureStore();
    const group = store.phoneChat.groups[String(groupId || '')];
    if (!group) throw new Error('请先选择或创建一个群聊。');
    const normalizedType = ['text', 'voice', 'image', 'transfer', 'sticker'].includes(type) ? type : 'text';
    const content = String(text || '').trim().slice(0, 12000);
    const imageDescription = String(description || content).trim().slice(0, 12000);
    const money = String(amount || '').trim().slice(0, 80);
    const memo = String(note || '').trim().slice(0, 500);
    const stickerLabel = String(stickerName || '').trim().slice(0, 80);
    const stickerLink = String(stickerUrl || '').trim();
    if (normalizedType === 'image' && !imageDescription) throw new Error('请填写图片里有什么。');
    if (normalizedType === 'sticker' && !stickerLabel) throw new Error('请选择一个表情包。');
    if (normalizedType === 'transfer' && !money) throw new Error('请填写金额。');
    if (['text', 'voice'].includes(normalizedType) && !content) throw new Error('请先输入要发送的消息。');
    const quoted = replyToId ? findGroupChatMessage(group, replyToId) : null;
    const message = {
        id: createId('group-message'),
        sender: 'user',
        speaker: group.userName,
        type: normalizedType,
        content: normalizedType === 'image'
            ? imageDescription
            : normalizedType === 'sticker'
                ? stickerLabel
                : content || memo,
        translation: '',
        emotion: '自然',
        description: normalizedType === 'image' ? imageDescription : '',
        amount: normalizedType === 'transfer' ? money : '',
        note: normalizedType === 'transfer' ? memo : '',
        stickerName: normalizedType === 'sticker' ? stickerLabel : '',
        stickerUrl: normalizedType === 'sticker' ? stickerLink : '',
        duration: normalizedType === 'voice' ? Math.min(600, Math.max(1, Math.round(Number(duration) || Math.max(1, content.length / 5)))) : 0,
        replyToId: quoted?.id || '',
        originalType: '',
        originalContent: '',
        createdAt: new Date().toISOString(),
        recalledAt: '',
    };
    group.messages.push(message);
    group.messages = group.messages.slice(-400);
    group.updatedAt = new Date().toISOString();
    store.phoneChat.activeGroupId = group.id;
    persist('group-chat-message', { groupId: group.id, messageId: message.id, sender: 'user' });
    return { userMessage: clone(message), pendingCount: groupChatPendingMessages(group).length, group: clone(group) };
}

function formatGroupChatMessage(message, group) {
    const speaker = message.sender === 'user' ? group.userName : message.speaker || '群成员';
    if (message.type === 'recalled') return `【${speaker}撤回了一条消息】`;
    const kindLabels = { text: '文字', voice: '语音', image: '图片', transfer: '转账', sticker: '表情包' };
    let content = message.content;
    if (message.type === 'image') content = message.description || message.content || '未填写图片描述';
    if (message.type === 'transfer') content = `${message.amount || '0'} 元${message.note ? `｜${message.note}` : ''}`;
    if (message.type === 'sticker') content = `表情包：${message.stickerName || message.note || message.content || '未命名'}`;
    if (message.type === 'voice') content = `${message.duration ? `${message.duration} 秒｜` : ''}${message.content}`;
    const quote = message.replyToId ? `（回复 #${message.replyToId}）` : '';
    return `[#${message.id}] ${speaker}${quote}【${kindLabels[message.type] || '文字'}】：${content}`;
}

function formatGroupCharacterProfiles(memberNames) {
    const context = window.SillyTavern?.getContext?.() || {};
    const characters = Array.isArray(context.characters) ? context.characters : [];
    return memberNames.map(name => {
        const card = characters.find(character => String(character?.name || '').trim() === name) || {};
        const sections = [
            card.description ? `描述：${card.description}` : '',
            card.personality ? `性格：${card.personality}` : '',
            card.scenario ? `场景：${card.scenario}` : '',
            card.creator_notes ? `创作者备注：${card.creator_notes}` : '',
            card.mes_example ? `示例对话：${card.mes_example}` : '',
        ].filter(Boolean).join('\n');
        return `【${name}】${sections ? `\n${sections}` : '\n使用当前剧情中已经呈现的人设与关系。'}`;
    }).join('\n\n');
}

function resolveGroupSpeaker(value, memberNames) {
    const requested = String(value || '').trim();
    return memberNames.find(name => name === requested)
        || memberNames.find(name => requested.includes(name) || name.includes(requested))
        || memberNames[0];
}

async function generateGroupChatReply(groupId, { preferVoice = false } = {}) {
    const store = ensureStore();
    const group = store.phoneChat.groups[String(groupId || '')];
    if (!group) throw new Error('请先选择或创建一个群聊。');
    const context = getContextSnapshot(store.planner.contextLimit);
    if (!context.available) throw new Error('请先打开一个角色对话，以便读取当前剧情和世界书。');
    const pendingMessages = groupChatPendingMessages(group);
    if (!pendingMessages.length) throw new Error('请先在群里发送一条或多条消息。');
    const settings = store.phoneChat.settings;
    const planner = getPlannerSettings();
    const language = resolveOutputLanguage(planner);
    const lore = await collectLoreContext(context);
    const profiles = formatGroupCharacterProfiles(group.memberNames);
    const history = group.messages.slice(-settings.maxHistory)
        .map(message => formatGroupChatMessage(message, group)).join('\n');
    const taskContext = [
        formatLorePrompt(lore),
        `群聊角色资料：\n${profiles}`,
        `SillyTavern 当前正文上下文：\n${formatContext(context) || '暂无正文消息。'}`,
        `手机群聊“${group.name}”记录：\n${history}`,
        `本轮等待回复的 ${pendingMessages.length} 条用户消息：\n${pendingMessages.map(message => formatGroupChatMessage(message, group)).join('\n')}`,
        `请让群成员根据各自人设自然决定谁先回复、谁补充、谁保持沉默；允许同一角色连续发送多条，也允许多名角色交替发送。`,
    ].filter(Boolean).join('\n\n');
    const outputFormat = `只返回严格 JSON，不要输出 Markdown、思考过程或额外说明：{"messages":[{"speaker":"${group.memberNames[0]}","type":"text","emotion":"自然","text":"角色实际发送的原语言内容","translation":"自然中文译文","description":"","amount":"","note":"","duration":0}]}。messages 必须有 1 到 12 条；speaker 必须逐字使用以下群成员之一：${group.memberNames.join('、')}。type 只能是 text、voice、image、transfer、sticker。${preferVoice || settings.autoVoice ? '这次普通文字消息必须改为 voice。' : ''}`;
    const messages = buildPromptWorkflowMessages('chat', {
        角色: group.memberNames.join('、'),
        用户: group.userName,
        长度: '1 到 12 条消息',
        语言: language.instruction,
        格式: '',
        角色卡与世界书: [formatLorePrompt(lore), profiles].filter(Boolean).join('\n\n'),
        聊天记录: history,
        待回复消息: pendingMessages.map(message => formatGroupChatMessage(message, group)).join('\n'),
        任务上下文: taskContext,
        输出格式: outputFormat,
    });
    let generated = null;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const attemptMessages = messages.map((message, index) => index === messages.length - 1 && attempt
                ? { ...message, content: `${message.content}\n上次群聊 JSON 或 speaker 不合格。这次只返回完整 JSON，并确保 speaker 来自群成员列表。` }
                : message);
            const raw = await callPlanner('', '', GROUP_CHAT_SCHEMA, attemptMessages);
            const structured = extractStructuredResult(raw, 'chat');
            const sourceMessages = Array.isArray(structured?.messages) ? structured.messages : [];
            generated = sourceMessages.slice(0, 12).map(item => {
                let type = ['text', 'voice', 'image', 'transfer', 'sticker'].includes(item?.type) ? item.type : 'text';
                if ((preferVoice || settings.autoVoice) && type === 'text') type = 'voice';
                const text = String(item?.text || item?.description || item?.note || '').trim().slice(0, 12000);
                const description = String(item?.description || (type === 'image' ? text : '')).trim().slice(0, 12000);
                const amount = String(item?.amount || '').trim().slice(0, 80);
                const note = String(item?.note || '').trim().slice(0, 500);
                let translation = String(item?.translation || '').trim().slice(0, 12000);
                const readable = type === 'image' ? description : text || note;
                if (!readable && !amount) return null;
                if (isLikelyChinese(readable)) translation = readable;
                else if (['text', 'voice', 'image'].includes(type) && !isLikelyChinese(translation)) throw new Error('群聊回复缺少自然中文译文。');
                return {
                    speaker: resolveGroupSpeaker(item?.speaker, group.memberNames),
                    type,
                    emotion: String(item?.emotion || '自然').trim().slice(0, 80) || '自然',
                    text,
                    translation,
                    description,
                    amount,
                    note,
                    duration: type === 'voice' ? Math.min(600, Math.max(1, Math.round(Number(item?.duration) || Math.max(1, text.length / 5)))) : 0,
                };
            }).filter(Boolean);
            if (!generated.length) throw new Error('群成员没有生成聊天内容。');
            break;
        } catch (error) {
            generated = null;
            lastError = error;
        }
    }
    if (!generated) throw lastError || new Error('群聊回复生成失败。');
    const assistantMessages = generated.map((item, index) => ({
        id: createId('group-message'),
        sender: 'character',
        speaker: item.speaker,
        type: item.type,
        content: item.type === 'image' ? item.description : item.text || item.note,
        translation: item.translation,
        emotion: item.emotion,
        description: item.description,
        amount: item.amount,
        note: item.note,
        duration: item.duration,
        replyToId: '',
        originalType: '',
        originalContent: '',
        createdAt: new Date(Date.now() + index).toISOString(),
        recalledAt: '',
    }));
    group.messages.push(...assistantMessages);
    group.messages = group.messages.slice(-400);
    group.updatedAt = new Date().toISOString();
    store.phoneChat.activeGroupId = group.id;
    persist('group-chat-message', { groupId: group.id, messageIds: assistantMessages.map(message => message.id), sender: 'character' });
    return { assistantMessages: clone(assistantMessages), group: clone(group) };
}

function recallGroupChatMessage(groupId, messageId) {
    const store = ensureStore();
    const group = store.phoneChat.groups[String(groupId || '')];
    const message = group ? findGroupChatMessage(group, messageId) : null;
    if (!message || message.type === 'recalled') return false;
    message.originalType = message.type;
    message.originalContent = message.content;
    message.type = 'recalled';
    message.content = '';
    message.translation = '';
    message.recalledAt = new Date().toISOString();
    group.updatedAt = message.recalledAt;
    persist('group-chat-message', { groupId: group.id, messageId, action: 'recall' });
    return clone(message);
}

function clearGroupChat(groupId) {
    const store = ensureStore();
    const group = store.phoneChat.groups[String(groupId || '')];
    if (!group) return false;
    group.messages = [];
    group.updatedAt = new Date().toISOString();
    persist('group-chat-message', { groupId: group.id, action: 'clear' });
    return true;
}

function getAvailableVoiceCharacters() {
    const context = window.SillyTavern?.getContext?.() || {};
    const registry = window.TTS_ProviderRegistry?.getSnapshot?.() || {};
    const routes = registry.characterRoutes || {};
    const current = getContextSnapshot();
    const names = new Set(Object.keys(routes));
    if (current.charName) names.add(current.charName);
    const characters = Array.isArray(context.characters) ? context.characters : [];
    return [...names]
        .map(name => {
            const character = characters.find(item => String(item?.name || '').trim() === name);
            const rawAvatar = String(character?.avatar || character?.avatar_url || '');
            let avatarUrl = rawAvatar;
            if (rawAvatar && typeof context.getThumbnailUrl === 'function') {
                try {
                    avatarUrl = context.getThumbnailUrl('avatar', rawAvatar) || rawAvatar;
                } catch {
                    avatarUrl = rawAvatar;
                }
            }
            const route = routes[name] || null;
            const provider = (registry.providers || []).find(item => item.id === route?.providerId);
            return {
                name,
                avatarUrl,
                providerId: route?.providerId || registry.activeProvider || '',
                providerName: provider?.name || '默认声线',
                voice: String(route?.voice || '').trim(),
                configured: Boolean(route || name === current.charName),
            };
        })
        .filter(item => item.name && item.configured)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function getExistingCharacters() {
    const context = window.SillyTavern?.getContext?.() || {};
    const current = getContextSnapshot();
    const routes = window.TTS_ProviderRegistry?.getSnapshot?.().characterRoutes || {};
    const characters = Array.isArray(context.characters) ? context.characters : [];
    const names = new Set([
        ...characters.map(item => String(item?.name || '').trim()).filter(Boolean),
        ...Object.keys(routes),
    ]);
    if (current.charName) names.add(current.charName);
    return [...names]
        .map(name => ({
            name,
            configured: Boolean(routes[name]),
            current: name === current.charName,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function getVoiceContacts() {
    const store = ensureStore();
    const context = window.SillyTavern?.getContext?.() || {};
    const current = getContextSnapshot();
    const registry = window.TTS_ProviderRegistry?.getSnapshot?.() || {};
    const routes = registry.characterRoutes || {};
    const manualCharacters = Array.isArray(registry.manualCharacters) ? registry.manualCharacters : [];
    const hiddenCharacters = new Set(Array.isArray(registry.hiddenCharacters) ? registry.hiddenCharacters : []);
    const characters = Array.isArray(context.characters) ? context.characters : [];
    const threads = Object.values(store.phoneChat.threads || {}).filter(thread => thread && typeof thread === 'object');
    const names = new Set([
        // 只收录已经配置声线路由 / 手动添加 / 手机聊天出现过的角色；旧版 GPT-SoVITS 缓存映射不再注入。
        ...Object.keys(routes),
        ...manualCharacters.map(name => String(name || '').trim()).filter(Boolean),
        ...threads.map(thread => String(thread.charName || '').trim()).filter(Boolean),
    ]);
    if (current.charName) names.add(current.charName);
    names.delete(current.userName);
    const providers = new Map((registry.providers || []).map(provider => [provider.id, provider.name]));

    return [...names].map(name => {
        const card = characters.find(item => String(item?.name || '').trim() === name);
        const contactThreads = threads.filter(thread => String(thread.charName || '').trim() === name);
        const latestThread = [...contactThreads].sort((a, b) => {
            const aTime = Date.parse(a.updatedAt || a.messages?.at?.(-1)?.createdAt || 0) || 0;
            const bTime = Date.parse(b.updatedAt || b.messages?.at?.(-1)?.createdAt || 0) || 0;
            return bTime - aTime;
        })[0];
        const messages = contactThreads.flatMap(thread => Array.isArray(thread.messages) ? thread.messages : []);
        const lastMessage = [...messages].sort((a, b) => (
            (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0)
        ))[0];
        const savedRoute = routes[name] || null;
        const providerId = savedRoute?.providerId || registry.activeProvider || '';
        const voice = String(savedRoute?.voice || '').trim();
        const favorite = store.favorites.find(item => (
            item.providerId === providerId && item.voiceId === voice
        ));
        const rawAvatar = String(card?.avatar || card?.avatar_url || latestThread?.avatarUrl || (name === current.charName ? current.avatarUrl : '') || '');
        let avatarUrl = rawAvatar;
        if (rawAvatar && card && typeof context.getThumbnailUrl === 'function') {
            try { avatarUrl = context.getThumbnailUrl('avatar', rawAvatar) || rawAvatar; } catch { avatarUrl = rawAvatar; }
        }
        const lastMessagePreview = lastMessage?.type === 'recalled'
            ? '撤回了一条消息'
            : String(lastMessage?.translation || lastMessage?.content || lastMessage?.description || '').trim();
        return {
            name,
            avatarUrl,
            current: name === current.charName,
            manual: manualCharacters.includes(name),
            configured: Boolean(savedRoute),
            providerId,
            providerName: providers.get(providerId) || (providerId === 'gpt_sovits' ? 'GPT-SoVITS' : '默认声线'),
            model: String(savedRoute?.model || '').trim(),
            voice,
            favorite: favorite ? clone(favorite) : null,
            messageCount: messages.length,
            threadCount: contactThreads.length,
            lastMessage: lastMessagePreview.slice(0, 160),
            lastActivityAt: lastMessage?.createdAt || latestThread?.updatedAt || '',
        };
    }).sort((a, b) => {
        if (a.current !== b.current) return a.current ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-CN');
    });
}

function formatContext(snapshot) {
    return snapshot.messages
        .map(message => `${message.name || (message.role === 'user' ? snapshot.userName : snapshot.charName)}：${message.content}`)
        .join('\n');
}

function formatCharacterCard(fields = {}) {
    const sections = [
        ['角色系统提示', fields.system],
        ['角色描述', fields.description],
        ['性格', fields.personality],
        ['当前场景', fields.scenario],
        ['角色深度设定', fields.charDepthPrompt],
        ['创作者备注', fields.creatorNotes],
        ['用户 Persona', fields.persona],
        ['示例对话', fields.mesExamples],
        ['角色后置指令', fields.jailbreak],
    ];
    return sections
        .map(([label, value]) => [label, String(value || '').trim()])
        .filter(([, value]) => value)
        .map(([label, value]) => `【${label}】\n${value}`)
        .join('\n\n');
}

function flattenWorldInfo(result = {}) {
    const values = [result.worldInfoBefore, result.worldInfoAfter];
    for (const collection of [
        result.worldInfoExamples,
        result.worldInfoDepth,
        result.anBefore,
        result.anAfter,
    ]) {
        if (!Array.isArray(collection)) continue;
        for (const entry of collection) values.push(entry?.content || entry?.value || entry);
    }
    for (const collection of Object.values(result.outletEntries || {})) {
        if (Array.isArray(collection)) values.push(...collection.map(entry => entry?.content || entry?.value || entry));
        else values.push(collection);
    }
    const unique = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
    return { text: unique.join('\n\n'), sectionCount: unique.length };
}

async function collectLoreContext(snapshot) {
    let fields = {};
    try {
        fields = getCharacterCardFields?.() || {};
    } catch {
        fields = {};
    }
    const characterCard = formatCharacterCard(fields);
    try {
        const chatForWorldInfo = snapshot.messages
            .map(message => world_info_include_names
                ? `${message.name || (message.role === 'user' ? snapshot.userName : snapshot.charName)}: ${message.content}`
                : message.content)
            .reverse();
        const maxContext = Math.max(8192, Number(getMaxPromptTokens?.()) || 32768);
        const result = await getWorldInfoPrompt(chatForWorldInfo, maxContext, true, {
            personaDescription: fields.persona || '',
            characterDescription: fields.description || '',
            characterPersonality: fields.personality || '',
            characterDepthPrompt: fields.charDepthPrompt || '',
            scenario: fields.scenario || '',
            creatorNotes: fields.creatorNotes || '',
            trigger: 'quiet',
        });
        const worldInfo = flattenWorldInfo(result);
        lastLoreStatus = {
            cardIncluded: Boolean(characterCard),
            worldInfoSections: worldInfo.sectionCount,
            error: '',
        };
        return { characterCard, worldInfo: worldInfo.text };
    } catch (error) {
        lastLoreStatus = {
            cardIncluded: Boolean(characterCard),
            worldInfoSections: 0,
            error: String(error?.message || error),
        };
        console.warn('[TTS Frontend Tools] 世界书读取失败，本次仅使用角色卡与对话：', error);
        return { characterCard, worldInfo: '' };
    }
}

function formatLorePrompt(lore) {
    return [
        lore.characterCard ? `角色卡与人设：\n${lore.characterCard}` : '',
        lore.worldInfo ? `当前对话激活的世界书条目：\n${lore.worldInfo}` : '',
    ].filter(Boolean).join('\n\n');
}

function parseJsonCandidate(candidate) {
    const value = String(candidate || '').trim();
    if (!value) return null;
    for (const variant of [
        value,
        value.replace(/,\s*([}\]])/g, '$1'),
    ]) {
        try {
            const parsed = JSON.parse(variant);
            return Array.isArray(parsed) ? { segments: parsed } : parsed;
        } catch {
            // Try the next conservative repair before falling back to plain text.
        }
    }
    return null;
}

function parsePlainPhoneResult(text) {
    const metadata = {};
    const segments = [];
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (const line of lines) {
        const meta = line.match(/^(?:标题|title|原因|reason|语气|tone)\s*[：:]\s*(.+)$/i);
        if (meta) {
            const key = /^(?:标题|title)/i.test(line) ? 'title' : /^(?:原因|reason)/i.test(line) ? 'reason' : 'tone';
            metadata[key] = meta[1].trim();
            continue;
        }
        const cleaned = line.replace(/^[-*\d.、）)\s]+/, '').trim();
        const match = cleaned.match(/^(?:([^：:（(\[]+?)(?:[（(]([^）)]+)[）)])?[：:]\s*)?(?:\[([^\]]+)\]\s*)?[“"']?(.{3,}?)[”"']?$/);
        if (!match) continue;
        const hasDialogueMarker = Boolean(match[1] || match[2] || match[3] || /^[“"']/.test(cleaned));
        if (!hasDialogueMarker) continue;
        const dialogue = match[4].replace(/[”"']$/, '').trim();
        if (!dialogue) continue;
        segments.push({
            speaker: String(match[1] || '').trim(),
            emotion: String(match[2] || match[3] || '自然').trim(),
            text: dialogue,
            translation: dialogue,
        });
    }
    return segments.length ? { ...metadata, segments } : null;
}

function parsePlainTrackResult(text) {
    const fields = {};
    const threads = [];
    const segments = [];
    for (const line of text.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
        const field = line.match(/^(?:摘要|summary|情绪|mood|场景|scene|建议回复|suggested\s*reply)\s*[：:]\s*(.+)$/i);
        if (field) {
            const key = /^(?:摘要|summary)/i.test(line) ? 'summary'
                : /^(?:情绪|mood)/i.test(line) ? 'mood'
                    : /^(?:场景|scene)/i.test(line) ? 'scene' : 'suggestedReply';
            fields[key] = field[1].trim();
            continue;
        }
        const dialogue = line.replace(/^[-*\d.、）)\s]+/, '').match(/^([^：:（(\[]+?)(?:[（(]([^）)]+)[）)])?[：:]\s*[“"']?(.{2,}?)[”"']?$/);
        if (dialogue && !/^(?:摘要|情绪|场景|summary|mood|scene)$/i.test(dialogue[1].trim())) {
            segments.push({
                speaker: dialogue[1].trim(),
                emotion: String(dialogue[2] || '自然').trim(),
                text: dialogue[3].replace(/[”"']$/, '').trim(),
                translation: dialogue[3].replace(/[”"']$/, '').trim(),
            });
            continue;
        }
        if (/^[-*•]/.test(line)) threads.push(line.replace(/^[-*•]\s*/, '').trim());
    }
    if (!fields.summary && !threads.length && !segments.length) return null;
    return {
        sceneDescription: fields.scene || '角色正在私下交谈。',
        summary: fields.summary || text.slice(0, 160),
        mood: fields.mood || '未标注',
        scene: fields.scene || '当前聊天',
        threads,
        speakers: [...new Set(segments.map(item => item.speaker))],
        segments,
    };
}

function parsePlainChatResult(text) {
    const cleaned = String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/^```(?:json)?|```$/gim, '')
        .trim();
    if (!cleaned) return null;
    const parts = cleaned.split(/\n{2,}|(?<=\S)\n(?=\S)/).map(item => item.trim()).filter(Boolean).slice(0, 6);
    return {
        messages: (parts.length ? parts : [cleaned]).map(content => ({
            type: 'text',
            emotion: '自然',
            text: content,
            translation: content,
            description: '',
            amount: '',
            note: '',
            duration: 0,
        })),
    };
}

function plannerContentToText(value) {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value.map(item => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        if (typeof item?.text?.value === 'string') return item.text.value;
        if (typeof item?.content === 'string') return item.content;
        return '';
    }).filter(Boolean).join('\n');
}

function unwrapPlannerResponse(raw, kind) {
    if (!raw || typeof raw !== 'object') return raw;
    if (kind === 'chat' && Array.isArray(raw.messages)) return raw;
    if (kind === 'chat' && typeof raw.text === 'string'
        && ('replyType' in raw || 'translation' in raw || 'emotion' in raw)) return raw;
    if (Array.isArray(raw.segments) || Array.isArray(raw.dialogue) || Array.isArray(raw.lines)) return raw;
    if (kind === 'track' && (raw.sceneDescription || raw.summary || raw.speakers)) return raw;

    const nestedCandidates = [
        raw.choices?.[0]?.message?.content,
        raw.choices?.[0]?.text,
        raw.message?.content,
        raw.message?.text,
        raw.output_text,
        raw.content,
        raw.response,
        raw.result,
    ];
    for (const candidate of nestedCandidates) {
        const text = plannerContentToText(candidate);
        if (text) return text;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            const nested = unwrapPlannerResponse(candidate, kind);
            if (nested && nested !== candidate) return nested;
        }
    }

    if (Array.isArray(raw.output)) {
        const outputText = raw.output
            .map(item => plannerContentToText(item?.content || item))
            .filter(Boolean)
            .join('\n');
        if (outputText) return outputText;
    }
    return '';
}

function extractStructuredResult(raw, kind) {
    const unwrapped = unwrapPlannerResponse(raw, kind);
    if (unwrapped && typeof unwrapped === 'object') return unwrapped;
    const text = String(unwrapped || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();
    if (!text || /^no message generated$/i.test(text)) {
        throw new Error('编排模型没有返回内容。');
    }
    const candidates = [];
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1]);
    candidates.push(text);
    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));
    for (const candidate of candidates) {
        const parsed = parseJsonCandidate(candidate);
        if (parsed) return parsed;
    }
    const plainResult = kind === 'phone'
        ? parsePlainPhoneResult(text)
        : kind === 'chat'
            ? parsePlainChatResult(text)
            : kind === 'group_call'
                ? parsePlainPhoneResult(text)
                : null;
    if (plainResult) return plainResult;
    throw new Error('编排模型返回了内容，但格式无法识别。');
}

function renderPromptTemplate(template, values = {}) {
    return String(template || '').replace(/\{\{([^{}]+)\}\}/g, (match, key) => (
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : match
    ));
}

function buildPromptWorkflowMessages(kind, values = {}) {
    const workflow = getPromptWorkflow(kind);
    return workflow.entries
        .filter(entry => entry.enabled && String(entry.content || '').trim())
        .map(entry => ({
            role: ['system', 'user', 'assistant'].includes(entry.role) ? entry.role : 'system',
            content: renderPromptTemplate(entry.content, values).trim(),
        }))
        .filter(message => message.content);
}

async function callPlanner(systemPrompt, prompt, jsonSchema, orderedMessages = null) {
    const planner = getPlannerSettings();
    const messages = Array.isArray(orderedMessages) && orderedMessages.length
        ? orderedMessages
        : [
            ...(String(systemPrompt || '').trim() ? [{ role: 'system', content: String(systemPrompt).trim() }] : []),
            { role: 'user', content: String(prompt || '') },
        ];
    if (planner.mode === 'custom') {
        if (!planner.apiUrl || !planner.apiKey || !planner.model) {
            throw new Error('请先在“设置”中补全前端 API 地址、密钥和模型。');
        }
        return LLM_Client.callLLM({
            api_url: planner.apiUrl,
            api_key: planner.apiKey,
            model: planner.model,
            temperature: planner.temperature,
            max_tokens: planner.maxTokens,
            messages,
        });
    }

    return generateRaw({
        prompt: messages,
        responseLength: planner.maxTokens,
        trimNames: false,
        jsonSchema,
    });
}

function isLikelyChinese(value) {
    const text = String(value || '').trim();
    return /[\u3400-\u9fff]/.test(text) && !/[\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

async function requestStructuredResult({ systemPrompt = '', prompt = '', messages = null, schema, kind, minimumSegments = 1, requireChineseTranslations = false }) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const repairNote = attempt
            ? '\n上一次输出为空或格式错误。这次不要解释、不要使用 Markdown，只返回符合结构要求的 JSON。'
            : '';
        try {
            const orderedMessages = Array.isArray(messages)
                ? messages.map((message, index) => index === messages.length - 1
                    ? { ...message, content: `${message.content}${repairNote}` }
                    : message)
                : null;
            const raw = await callPlanner(`${systemPrompt}${repairNote}`, prompt, schema, orderedMessages);
            const result = extractStructuredResult(raw, kind);
            const segments = result?.segments || result?.dialogue || result?.lines;
            if (['phone', 'single_call'].includes(kind) && (!Array.isArray(segments) || segments.length < minimumSegments)) {
                throw new Error(`来电台词只有 ${Array.isArray(segments) ? segments.length : 0} 句，少于所选长度要求的 ${minimumSegments} 句。`);
            }
            if (['group_call', 'track'].includes(kind) && (!Array.isArray(segments) || segments.length < minimumSegments)) {
                throw new Error(`多人通话只有 ${Array.isArray(segments) ? segments.length : 0} 段，需要至少 ${minimumSegments} 段。`);
            }
            if (requireChineseTranslations && Array.isArray(segments)) {
                const missingTranslations = segments.filter(segment => !isLikelyChinese(segment?.translation));
                if (missingTranslations.length) {
                    throw new Error(`${missingTranslations.length} 段台词没有可读的中文译文。`);
                }
            }
            return result;
        } catch (error) {
            lastError = error;
        }
    }
    throw new Error(`编排连续两次失败：${lastError?.message || '模型没有返回可用内容'}`);
}

function normalizePhonePlan(value, context, brief, duration, requestedCaller, availableCharacters) {
    const candidates = value?.segments || value?.dialogue || value?.lines;
    const sourceSegments = Array.isArray(candidates) ? candidates : [];
    const availableNames = availableCharacters.map(item => item.name);
    const generatedCaller = String(value?.caller || sourceSegments.find(item => item?.speaker)?.speaker || '').trim();
    const caller = requestedCaller && requestedCaller !== 'auto'
        ? requestedCaller
        : availableNames.includes(generatedCaller)
            ? generatedCaller
            : availableNames.includes(context.charName) ? context.charName : availableNames[0] || context.charName;
    let segments = sourceSegments.slice(0, 18).map(segment => {
        if (typeof segment === 'string') {
            return { speaker: caller, emotion: '自然', text: segment.trim(), translation: segment.trim() };
        }
        const speaker = String(segment?.speaker || segment?.name || caller).trim() || caller;
        return {
            speaker: availableNames.includes(speaker) ? speaker : caller,
            emotion: String(segment?.emotion || segment?.tone || '自然').trim() || '自然',
            text: String(segment?.text || segment?.content || '').trim(),
            translation: String(segment?.translation || segment?.text || segment?.content || '').trim(),
        };
    }).filter(segment => segment.text);
    if (!segments.some(segment => segment.speaker === caller)) {
        segments = segments.map(segment => ({ ...segment, speaker: caller }));
    }
    if (!segments.length) throw new Error('编排结果里没有可播放的来电台词。');
    return {
        id: createId('call'),
        kind: 'single',
        charName: caller,
        speakers: [caller],
        participants: [caller],
        avatarUrl: availableCharacters.find(item => item.name === caller)?.avatarUrl || (caller === context.charName ? context.avatarUrl : ''),
        reason: String(value?.reason || brief || '想和你说几句话').trim(),
        tone: String(value?.tone || segments[0].emotion || '自然').trim(),
        title: String(value?.title || `${caller} 的通话`).trim(),
        brief: String(brief || '').trim(),
        duration,
        requestedCaller,
        segments,
        favorite: false,
        createdAt: new Date().toISOString(),
    };
}

async function generatePhonePlan({ brief = '', duration = 'short', caller = 'auto', participants = [] } = {}) {
    const context = getContextSnapshot();
    if (!context.available) throw new Error('请先打开一个单角色对话。');
    if (!context.messages.length) throw new Error('当前对话还没有可用于规划的上下文。');
    const availableCharacters = getAvailableVoiceCharacters();
    if (!availableCharacters.length) throw new Error('还没有可用于通话的角色声线，请先配置角色路由。');
    const requestedParticipants = [...new Set((Array.isArray(participants) && participants.length
        ? participants
        : [caller]).map(name => String(name || '').trim()).filter(name => availableCharacters.some(item => item.name === name)))];
    if (!requestedParticipants.length) requestedParticipants.push(availableCharacters[0].name);
    const requestedCaller = requestedParticipants[0];
    const callerLabel = requestedParticipants.length === 1
        ? requestedCaller
        : `${requestedParticipants.join('、')}（${requestedParticipants.length} 人）`;
    const planner = getPlannerSettings();
    const language = resolveOutputLanguage(planner);
    const lore = await collectLoreContext(context);
    const isGroupCall = requestedParticipants.length > 1;
    const minimumSegments = isGroupCall
        ? 15
        : (duration === 'long' ? 12 : duration === 'medium' ? 7 : 4);
    const lengthHint = isGroupCall
        ? '15 到 28 段'
        : (duration === 'long' ? '12 到 18 句' : duration === 'medium' ? '7 到 10 句' : '4 到 6 句');
    const taskContext = [
        `当前角色卡：${context.charName}`,
        `用户：${context.userName}`,
        `本次通话人：${callerLabel}`,
        `可用声线：${availableCharacters.map(item => `${item.name}（${item.providerName}）`).join('、')}`,
        brief ? `这通电话想谈：${String(brief).trim()}` : '通话目的：从最近对话中自行判断一个最自然的延续点。',
        formatLorePrompt(lore),
        `已选对话楼层（${context.includedFloorCount}/${context.floorCount}）：`,
        formatContext(context),
    ].join('\n');
    const workflowKind = isGroupCall ? 'group_call' : 'single_call';
    const messages = buildPromptWorkflowMessages(workflowKind, {
        角色: callerLabel,
        用户: context.userName,
        长度: lengthHint,
        语言: language.instruction,
        格式: '',
        可用声线: requestedParticipants.join('、'),
        角色卡与世界书: formatLorePrompt(lore),
        任务上下文: taskContext,
        输出格式: isGroupCall
            ? `只返回严格 JSON，不要解释过程，不要使用 Markdown：{"sceneDescription":"","summary":"","speakers":[""],"threads":[""],"segments":[{"speaker":"","emotion":"","text":"","translation":""}]}。segments 必须生成 15 到 28 段；speakers 必须是 ${requestedParticipants.join('、')}；threads 最多 6 条；translation 必须填写自然中文译文；不要替 ${context.userName} 说话。语言要求：${language.instruction}。`
            : `只返回严格 JSON，不要解释过程，不要使用 Markdown：{"caller":"","title":"","reason":"","tone":"","segments":[{"speaker":"","emotion":"","text":"","translation":""}]}。segments 必须有 ${lengthHint}；caller 必须是 ${requestedCaller}；只生成远端角色发言，不要替 ${context.userName} 说话；translation 必须填写自然中文译文。语言要求：${language.instruction}。`,
    });
    const schema = isGroupCall ? GROUP_CALL_PHONE_SCHEMA : PHONE_SCHEMA;
    const structured = await requestStructuredResult({
        messages,
        schema,
        kind: workflowKind,
        minimumSegments,
        requireChineseTranslations: true,
    });
    const result = isGroupCall
        ? normalizeGroupCallPlan(structured, context, brief, requestedParticipants)
        : normalizePhonePlan(structured, context, brief, duration, requestedCaller, availableCharacters);
    const store = ensureStore();
    store.calls.unshift(result);
    store.calls = store.calls.slice(0, MAX_HISTORY);
    persist(isGroupCall ? 'group-phone-plan' : 'phone-plan', { id: result.id });
    return clone(result);
}

function normalizeGroupCallPlan(value, context, brief, requestedSpeakers) {
    const speakerList = [...new Set(requestedSpeakers.map(name => String(name || '').trim()).filter(Boolean))];
    if (speakerList.length < 2) {
        throw new Error('多人通话至少需要两位已配置声线的角色。');
    }
    const threads = (Array.isArray(value?.threads) ? value.threads : [])
        .map(item => String(item || '').trim()).filter(Boolean).slice(0, 6);
    const sourceSegments = Array.isArray(value?.segments) ? value.segments : [];
    let segments = sourceSegments.slice(0, 28).map((segment, index) => {
        const rawSpeaker = String(segment?.speaker || '').trim();
        const speaker = speakerList.includes(rawSpeaker)
            ? rawSpeaker
            : speakerList[index % speakerList.length];
        const text = String(segment?.text || segment?.content || '').trim();
        return {
            speaker,
            emotion: String(segment?.emotion || '自然').trim() || '自然',
            text,
            translation: String(segment?.translation || text).trim(),
        };
    }).filter(item => item.text);
    if (segments.length < 15) throw new Error('多人通话没有生成足够的可播放台词。');
    const uniqueSpeakers = new Set(segments.map(item => item.speaker));
    if (uniqueSpeakers.size < 2) {
        segments = segments.map((segment, index) => ({
            ...segment,
            speaker: speakerList[index % speakerList.length],
        }));
    }
    const finalSpeakers = [...new Set(segments.map(item => item.speaker))];
    const primarySpeaker = speakerList[0];
    return {
        id: createId('call'),
        kind: 'group',
        charName: primarySpeaker,
        speakers: finalSpeakers,
        participants: speakerList,
        title: `${speakerList.join('、')} 多人通话`,
        reason: String(brief || value?.summary || '').trim() || `${speakerList.length} 人同时通话`,
        tone: String(value?.tone || '自然').trim() || '自然',
        sceneDescription: String(value?.sceneDescription || value?.scene_description || '多人通话场景。').trim(),
        summary: String(value?.summary || '已生成多人通话。').trim().slice(0, 200),
        threads,
        segments,
        messageCount: context.messageCount,
        floorCount: context.floorCount,
        includedFloorCount: context.includedFloorCount,
        duration: 'long',
        favorite: false,
        createdAt: new Date().toISOString(),
    };
}

async function regeneratePhoneCall(callId) {
    const store = ensureStore();
    const previous = store.calls.find(item => item.id === callId);
    if (!previous) throw new Error('找不到要重新生成的通话。');
    const isGroup = previous.kind === 'group' || (Array.isArray(previous.participants) && previous.participants.length > 1);
    return generatePhonePlan({
        brief: previous.brief || previous.reason || '',
        duration: previous.duration || 'short',
        caller: previous.participants?.[0] || previous.requestedCaller || 'auto',
        participants: previous.participants || (previous.charName ? [previous.charName] : []),
    }).then(fresh => {
        // 用新规划覆盖旧记录，但保留收藏与 id，方便历史入口不失效。
        Object.assign(previous, fresh, {
            id: previous.id,
            favorite: previous.favorite === true,
            brief: previous.brief,
        });
        return clone(previous);
    });
}

function favoriteKey(providerId, voiceId) {
    return `${String(providerId || '').trim()}::${String(voiceId || '').trim()}`;
}

function isVoiceFavorite(providerId, voiceId) {
    const key = favoriteKey(providerId, voiceId);
    return ensureStore().favorites.some(item => favoriteKey(item.providerId, item.voiceId) === key);
}

function toggleVoiceFavorite(voice = {}) {
    const providerId = String(voice.providerId || '').trim();
    const voiceId = String(voice.voiceId || voice.id || '').trim();
    if (!providerId || !voiceId) throw new Error('缺少声线标识。');
    const key = favoriteKey(providerId, voiceId);
    const store = ensureStore();
    const index = store.favorites.findIndex(item => favoriteKey(item.providerId, item.voiceId) === key);
    let active = false;
    if (index >= 0) {
        store.favorites.splice(index, 1);
    } else {
        store.favorites.unshift({
            id: createId('voice'),
            providerId,
            voiceId,
            name: String(voice.name || voiceId).trim(),
            category: String(voice.category || 'custom').trim(),
            description: String(voice.description || '').trim(),
            model: String(voice.model || '').trim(),
            createdAt: new Date().toISOString(),
        });
        active = true;
    }
    persist('voice-favorite', { providerId, voiceId, active });
    return active;
}

function removeVoiceFavorite(providerId, voiceId) {
    const normalizedProviderId = String(providerId || '').trim();
    const normalizedVoiceId = String(voiceId || '').trim();
    if (!normalizedProviderId || !normalizedVoiceId) return false;
    const store = ensureStore();
    const key = favoriteKey(normalizedProviderId, normalizedVoiceId);
    const index = store.favorites.findIndex(item => favoriteKey(item.providerId, item.voiceId) === key);
    if (index < 0) return false;
    const [removed] = store.favorites.splice(index, 1);
    persist('voice-favorite', {
        providerId: normalizedProviderId,
        voiceId: normalizedVoiceId,
        active: false,
    });
    return clone(removed);
}

function saveVoiceFavorite(voice = {}) {
    const providerId = String(voice.providerId || '').trim();
    const voiceId = String(voice.voiceId || voice.id || '').trim();
    if (!providerId || !voiceId) throw new Error('请填写复刻音色的 Voice ID。');
    const store = ensureStore();
    const key = favoriteKey(providerId, voiceId);
    let favorite = store.favorites.find(item => favoriteKey(item.providerId, item.voiceId) === key);
    const values = {
        providerId,
        voiceId,
        name: String(voice.name || voiceId).trim().slice(0, 80) || voiceId,
        category: String(voice.category || 'cloning').trim(),
        description: String(voice.description || '').trim().slice(0, 240),
        model: String(voice.model || '').trim(),
    };
    if (favorite) {
        Object.assign(favorite, values, { updatedAt: new Date().toISOString() });
    } else {
        favorite = {
            id: createId('voice'),
            ...values,
            createdAt: new Date().toISOString(),
        };
        store.favorites.unshift(favorite);
        store.favorites = store.favorites.slice(0, 120);
    }
    persist('voice-favorite', { providerId, voiceId, active: true });
    return clone(favorite);
}

function updateVoiceFavorite(providerId, voiceId, updates = {}) {
    const oldProviderId = String(providerId || '').trim();
    const oldVoiceId = String(voiceId || '').trim();
    const store = ensureStore();
    const index = store.favorites.findIndex(item => favoriteKey(item.providerId, item.voiceId) === favoriteKey(oldProviderId, oldVoiceId));
    if (index < 0) throw new Error('这个声线收藏已经不存在。');
    const current = store.favorites[index];
    const nextProviderId = String(updates.providerId || current.providerId).trim();
    const nextVoiceId = String(updates.voiceId || current.voiceId).trim();
    if (!nextProviderId || !nextVoiceId) throw new Error('请填写复刻音色的 Voice ID。');
    const duplicate = store.favorites.find((item, itemIndex) => (
        itemIndex !== index
        && favoriteKey(item.providerId, item.voiceId) === favoriteKey(nextProviderId, nextVoiceId)
    ));
    if (duplicate) throw new Error('这个 Voice ID 已经在收藏中。');
    Object.assign(current, {
        providerId: nextProviderId,
        voiceId: nextVoiceId,
        name: String(updates.name ?? current.name ?? nextVoiceId).trim().slice(0, 80) || nextVoiceId,
        model: String(updates.model ?? current.model ?? '').trim(),
        description: String(updates.description ?? current.description ?? '').trim().slice(0, 240),
        updatedAt: new Date().toISOString(),
    });
    persist('voice-favorite', {
        providerId: nextProviderId,
        voiceId: nextVoiceId,
        previousProviderId: oldProviderId,
        previousVoiceId: oldVoiceId,
        active: true,
        action: 'update',
    });
    return clone(current);
}

function getPromptPresets() {
    return clone(ensureStore().promptPresets);
}

function savePromptPreset(name) {
    const presetName = String(name || '').trim().slice(0, 60);
    if (!presetName) throw new Error('请先填写预设名称。');
    const store = ensureStore();
    const planner = store.planner;
    let preset = store.promptPresets.find(item => item.name.toLocaleLowerCase('zh-CN') === presetName.toLocaleLowerCase('zh-CN'));
    if (preset) {
        Object.assign(preset, {
            phonePrompt: planner.phonePrompt,
            trackPrompt: planner.trackPrompt,
            bodyPrompt: planner.bodyPrompt,
            bodyPromptEnabled: planner.bodyPromptEnabled,
            outputLanguage: planner.outputLanguage,
            customLanguage: planner.customLanguage,
            updatedAt: new Date().toISOString(),
        });
    } else {
        preset = {
            id: createId('prompt'),
            name: presetName,
            phonePrompt: planner.phonePrompt,
            trackPrompt: planner.trackPrompt,
            bodyPrompt: planner.bodyPrompt,
            bodyPromptEnabled: planner.bodyPromptEnabled,
            outputLanguage: planner.outputLanguage,
            customLanguage: planner.customLanguage,
            updatedAt: new Date().toISOString(),
        };
        store.promptPresets.unshift(preset);
        store.promptPresets = store.promptPresets.slice(0, 50);
    }
    store.planner.activePromptPresetId = preset.id;
    persist('prompt-preset-saved', { id: preset.id });
    return clone(preset);
}

function applyPromptPreset(id) {
    const preset = ensureStore().promptPresets.find(item => item.id === id);
    if (!preset) throw new Error('找不到这个提示词预设。');
    updatePlannerSettings({
        phonePrompt: preset.phonePrompt,
        trackPrompt: preset.trackPrompt,
        bodyPrompt: preset.bodyPrompt,
        bodyPromptEnabled: preset.bodyPromptEnabled,
        outputLanguage: preset.outputLanguage,
        customLanguage: preset.customLanguage,
        activePromptPresetId: preset.id,
    });
    return clone(preset);
}

function deletePromptPreset(id) {
    const store = ensureStore();
    const index = store.promptPresets.findIndex(item => item.id === id);
    if (index < 0) return false;
    store.promptPresets.splice(index, 1);
    if (store.planner.activePromptPresetId === id) store.planner.activePromptPresetId = '';
    persist('prompt-preset-deleted', { id });
    return true;
}

function deletePhoneCall(id) {
    const store = ensureStore();
    const index = store.calls.findIndex(item => item.id === id);
    if (index < 0) return false;
    store.calls.splice(index, 1);
    persist('phone-call-deleted', { id });
    return true;
}

function setCallFavorite(id, favorite) {
    const store = ensureStore();
    const target = store.calls.find(item => item.id === id);
    if (!target) return false;
    target.favorite = favorite !== false;
    persist('call-favorite', { id, favorite: target.favorite });
    return target.favorite;
}

function getPlannerApiPresets() {
    return clone(ensureStore().apiPresets);
}

function savePlannerApiPreset(name) {
    const presetName = String(name || '').trim().slice(0, 60);
    if (!presetName) throw new Error('请先填写连接预设名称。');
    const store = ensureStore();
    const planner = store.planner;
    if (!planner.apiUrl || !planner.apiKey) throw new Error('请先填写 API 地址和 API Key。');
    let preset = store.apiPresets.find(item => item.name.toLocaleLowerCase('zh-CN') === presetName.toLocaleLowerCase('zh-CN'));
    const values = {
        apiUrl: planner.apiUrl,
        apiKey: planner.apiKey,
        model: planner.model,
        temperature: planner.temperature,
        maxTokens: planner.maxTokens,
        updatedAt: new Date().toISOString(),
    };
    if (preset) {
        Object.assign(preset, values);
    } else {
        preset = { id: createId('api'), name: presetName, ...values };
        store.apiPresets.unshift(preset);
        store.apiPresets = store.apiPresets.slice(0, 30);
    }
    store.planner.activeApiPresetId = preset.id;
    persist('api-preset-saved', { id: preset.id });
    return clone(preset);
}

function applyPlannerApiPreset(id) {
    const preset = ensureStore().apiPresets.find(item => item.id === id);
    if (!preset) throw new Error('找不到这个连接预设。');
    updatePlannerSettings({
        mode: 'custom',
        apiUrl: preset.apiUrl,
        apiKey: preset.apiKey,
        model: preset.model,
        temperature: preset.temperature,
        maxTokens: preset.maxTokens,
        activeApiPresetId: preset.id,
    });
    return clone(preset);
}

function deletePlannerApiPreset(id) {
    const store = ensureStore();
    const index = store.apiPresets.findIndex(item => item.id === id);
    if (index < 0) return false;
    store.apiPresets.splice(index, 1);
    if (store.planner.activeApiPresetId === id) store.planner.activeApiPresetId = '';
    persist('api-preset-deleted', { id });
    return true;
}

async function fetchPlannerModels(config = {}) {
    const planner = getPlannerSettings();
    const apiUrl = String(config.apiUrl ?? planner.apiUrl ?? '').trim();
    const apiKey = String(config.apiKey ?? planner.apiKey ?? '').trim();
    if (!apiUrl || !apiKey) throw new Error('请先填写 API 地址和 API Key。');
    return LLM_Client.fetchModels(apiUrl, apiKey);
}

function getBodyPromptFormatExample() {
    const template = window.TTS_ProviderRegistry?.getTagSettings?.().template
        || '[TTS:{角色}:{情绪}:{文本}]';
    const language = getPlannerSettings().outputLanguage;
    const translation = '今天见到你真好。';
    const text = language === 'ja' ? '今日は会えてうれしい。'
        : language === 'en' ? 'I am glad to see you today.'
            : language === 'ko' ? '오늘 만나서 기뻐.'
                : language === 'yue' ? '今日见到你好开心。' : translation;
    const tag = template
        .replaceAll('{角色}', '{{char}}')
        .replaceAll('{情绪}', language === 'ja' ? '穏やか' : '平静')
        .replaceAll('{译文}', translation)
        .replaceAll('{文本}', text);
    const includesVisibleText = template.includes('{译文}');
    return includesVisibleText ? `${tag} ` : `“${translation}”${tag} `;
}

function applyBodyPromptInjection() {
    const store = ensureStore();
    const planner = getPlannerSettings();
    const language = resolveOutputLanguage(planner);
    const values = {
            角色: '{{char}}',
            用户: '{{user}}',
            长度: '',
            语言: language.instruction,
            格式: getBodyPromptFormatExample(),
            任务上下文: '',
            输出格式: getBodyPromptFormatExample(),
        };
    injectedBodyPromptKeys.forEach(key => setExtensionPrompt(
        key,
        '',
        extension_prompt_types.IN_CHAT,
        0,
        false,
        extension_prompt_roles.SYSTEM,
    ));
    const entries = planner.bodyPromptEnabled
        ? store.promptWorkflows.body.entries.filter(entry => entry.enabled && String(entry.content || '').trim())
        : [];
    const workflowDepth = Math.min(20, Math.max(0, Number(store.promptWorkflows.body?.depth) || 0));
    injectedBodyPromptKeys = entries.map((entry, index) => {
        const key = `${BODY_PROMPT_KEY}_${entry.id}`;
        const role = entry.role === 'user' ? extension_prompt_roles.USER
            : entry.role === 'assistant' ? extension_prompt_roles.ASSISTANT
                : extension_prompt_roles.SYSTEM;
        setExtensionPrompt(
            key,
            renderPromptTemplate(entry.content, values),
            extension_prompt_types.IN_CHAT,
            Math.min(100, workflowDepth + Math.max(0, entries.length - index - 1)),
            false,
            role,
        );
        return key;
    });
    setExtensionPrompt(BODY_PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    return entries.map(entry => renderPromptTemplate(entry.content, values)).join('\n\n');
}

function getSnapshot() {
    const store = ensureStore();
    const context = getContextSnapshot(store.planner.contextLimit);
    const phoneChatThread = ensurePhoneChatThread(store, context);
    const groupChat = getGroupChatSnapshot();
    const calls = clone(store.calls);
    return {
        planner: clone(store.planner),
        favorites: clone(store.favorites),
        calls,
        favoriteCalls: calls.filter(item => item.favorite === true),
        promptPresets: clone(store.promptPresets),
        promptWorkflows: getPromptWorkflows(),
        apiPresets: clone(store.apiPresets),
        phoneChat: {
            settings: clone(store.phoneChat.settings),
            presets: clone(store.phoneChat.presets),
            thread: clone(phoneChatThread),
            pendingCount: getPendingPhoneChatMessages(phoneChatThread).length,
        },
        groupChat,
        contacts: getVoiceContacts(),
        loreStatus: clone(lastLoreStatus),
        context,
    };
}

function plannerLabel() {
    const planner = getPlannerSettings();
    return planner.mode === 'custom'
        ? (planner.model || '自定义 API')
        : '跟随 SillyTavern 当前模型';
}

function exportBackupData() {
    const data = clone(ensureStore());
    data.planner.apiKey = '';
    data.apiPresets = data.apiPresets.map(preset => ({ ...preset, apiKey: '' }));
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        secretsExcluded: true,
        data,
    };
}

function importBackupData(payload) {
    const source = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    if (!source || typeof source !== 'object' || !source.planner || typeof source.planner !== 'object') {
        throw new Error('备份中缺少编排与手机数据。');
    }
    const current = ensureStore();
    const next = clone(source);
    next.planner = { ...(next.planner || {}), apiKey: current.planner.apiKey || '' };
    const currentPresetKeys = new Map((current.apiPresets || []).map(item => [item.id, item.apiKey || '']));
    next.apiPresets = (Array.isArray(next.apiPresets) ? next.apiPresets : []).map(item => ({
        ...item,
        apiKey: currentPresetKeys.get(item.id) || '',
    }));
    extension_settings[SETTINGS_KEY] = next;
    ensureStore();
    applyBodyPromptInjection();
    persist('backup-restored');
    return getSnapshot();
}

function resetPlannerPrompts() {
    resetPromptWorkflow('body');
    resetPromptWorkflow('single_call');
    resetPromptWorkflow('group_call');
    return getPlannerSettings();
}

function init() {
    if (initialized) return;
    initialized = true;
    ensureStore();
    applyBodyPromptInjection();
    const promptRefreshEvents = new Set([
        event_types.CHAT_CHANGED,
        event_types.CHAT_LOADED,
        event_types.SETTINGS_LOADED_AFTER,
        event_types.APP_READY,
        event_types.GENERATION_AFTER_COMMANDS,
    ].filter(Boolean));
    // SillyTavern clears every extension prompt while switching chats. Reapply here
    // and immediately before generation so正文 TTS rules cannot silently disappear.
    promptRefreshEvents.forEach(eventName => {
        eventSource.on(eventName, applyBodyPromptInjection);
    });
    initBodyTtsRuntime();
}

function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export const FrontendVoiceTools = {
    SETTINGS_KEY,
    init,
    subscribe,
    getSnapshot,
    exportBackupData,
    importBackupData,
    getContextSnapshot,
    getAvailableVoiceCharacters,
    getExistingCharacters,
    getVoiceContacts,
    getPlannerSettings,
    updatePlannerSettings,
    getPhoneChatSnapshot,
    updatePhoneChatSettings,
    getPhoneChatPromptPresets,
    savePhoneChatPromptPreset,
    applyPhoneChatPromptPreset,
    deletePhoneChatPromptPreset,
    resetPhoneChatPrompt,
    appendPhoneChatMessage,
    generatePhoneChatReply,
    generateProactivePhoneChatMessage,
    sendPhoneChatMessage,
    recallPhoneChatMessage,
    clearPhoneChatThread,
    getGroupChatSnapshot,
    selectGroupChat,
    createGroupChat,
    updateGroupChat,
    deleteGroupChat,
    appendGroupChatMessage,
    generateGroupChatReply,
    recallGroupChatMessage,
    clearGroupChat,
    resetPlannerPrompts,
    getPromptWorkflows,
    getPromptWorkflow,
    updatePromptWorkflowEntries,
    updatePromptWorkflowDepth,
    insertPromptWorkflowEntry,
    movePromptWorkflowEntry,
    deletePromptWorkflowEntry,
    savePromptWorkflowPreset,
    applyPromptWorkflowPreset,
    deletePromptWorkflowPreset,
    resetPromptWorkflow,
    exportPromptPresetData,
    importPromptPresetData,
    compilePromptWorkflow,
    testPromptWorkflow,
    getPromptWorkflowRevisions,
    savePromptWorkflowRevision,
    restorePromptWorkflowRevision,
    deletePromptWorkflowRevision,
    getPromptPresets,
    savePromptPreset,
    applyPromptPreset,
    deletePromptPreset,
    deletePhoneCall,
    setCallFavorite,
    regeneratePhoneCall,
    getPlannerApiPresets,
    savePlannerApiPreset,
    applyPlannerApiPreset,
    deletePlannerApiPreset,
    fetchPlannerModels,
    applyBodyPromptInjection,
    listOutputLanguages: () => Object.entries(OUTPUT_LANGUAGES).map(([id, item]) => ({ id, label: item.label })),
    plannerLabel,
    generatePhonePlan,
    isVoiceFavorite,
    toggleVoiceFavorite,
    removeVoiceFavorite,
    saveVoiceFavorite,
    updateVoiceFavorite,
};

window.TTS_FrontendVoiceTools = FrontendVoiceTools;
