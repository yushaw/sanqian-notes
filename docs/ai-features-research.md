# 笔记应用 AI 能力深度调研报告

> 调研时间：2024年12月
> 调研对象：Notion、Mem、Craft、Obsidian、Apple Notes、Reflect、Tana、NotebookLM、Raycast 等主流笔记应用

---

## 目录

1. [调研概述](#调研概述)
2. [标杆产品分析](#标杆产品分析)
3. [AI 场景全景图](#ai-场景全景图)
   - [写作辅助场景](#一写作辅助场景)
   - [内容处理场景](#二内容处理场景)
   - [知识管理场景](#三知识管理场景)
   - [多模态场景](#四多模态场景)
   - [专业场景](#五专业场景)
4. [AI 交互模式分析](#六ai-交互模式分析)
5. [技术实现参考](#七技术实现参考)
6. [场景优先级建议](#八场景优先级建议)
7. [参考资料](#九参考资料)

---

## 调研概述

本文档对业界主流笔记应用的 AI 能力进行了深度调研，旨在为散墨笔记的 AI 功能规划提供参考。调研覆盖了以下维度：

- **场景分类**：写作辅助、内容处理、知识管理、多模态、专业场景
- **交互模式**：触发方式、响应方式、用户体验设计
- **技术实现**：模型选择、Embedding、向量搜索等

---

## 标杆产品分析

### 1. Notion AI

**定位**：最成熟的笔记 AI 集成，功能全面

**核心能力**：
- 写作辅助：空行按空格触发 AI 生成，支持续写、扩写、缩写
- 编辑润色：改变语气（专业/友好/简洁）、修复语法、改善措辞
- 总结提取：生成摘要、提取要点、列出待办事项
- 翻译：支持 14 种语言互译
- Q&A 问答：基于整个工作区的知识问答

**特色功能**：
- AI Block：特殊的 AI 块，可生成总结、要点、自定义内容
- AI 数据库属性：自动填充、AI 摘要、AI 关键词
- 自然语言搜索：用自然语言在工作区中查找信息

**技术栈**：同时使用 OpenAI GPT-4 和 Anthropic Claude

**参考链接**：
- [Notion AI 完整功能指南](https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai)
- [Notion AI 写作辅助](https://www.notion.com/help/guides/notion-ai-for-docs)

---

### 2. Mem AI

**定位**：专注"记忆增强"的差异化路线，自组织工作区

**核心能力**：
- Smart Search：语义搜索，基于含义而非关键词匹配
- Related Notes：自动发现并显示相关笔记
- Collections：AI 自动分类和组织笔记
- AI Chat/Copilot：与笔记对话，如"总结昨天的销售会议"

**特色功能**：
- **自组织**：无需手动创建文件夹，AI 自动分析内容并归类
- **上下文浮现**：根据当前内容自动推荐相关笔记
- **Deep Search**：理解查询意图，即使措辞不同也能找到相关内容
- **时间线视图**：按时间自动组织笔记

**差异化**：Mem 不只是捕获和存储——它连接并在需要时重新浮现你的知识

**参考链接**：
- [Mem AI 官网](https://get.mem.ai/)
- [Mem Collections 自动组织](https://get.mem.ai/blog/automatic-organization-with-collections)
- [Mem 5种快速找笔记的方式](https://get.mem.ai/blog/5-ways-mem-helps-you-find-notes-faster)

---

### 3. Craft

**定位**：美观优先的笔记应用，强调设计感和流畅体验

**核心能力**：
- AI 写作助手：更快写作、生成想法、校对、翻译、总结
- 空间级智能：可以与整个工作区对话
- 多平台支持：Mac、iOS、iPadOS、Windows、Web

**特色功能**：
- **离线 AI**：支持设备端运行，隐私保护
- **DeepSeek R1 本地模型**：2025年1月起支持免费本地推理模型
- **API/MCP 支持**：可连接 ChatGPT、Claude 等外部服务

**定价**：Plus 计划 $8/月，包含 500 次 AI 请求/月

**参考链接**：
- [Craft AI Assistant](https://support.craft.do/hc/en-us/articles/8104602502557-About-Craft-AI-Assistant)
- [Craft 的 AI 未来](https://www.craft.do/blog/craft-assistant-future-ai)

---

### 4. Apple Notes (iOS 18+ / macOS Sequoia+)

**定位**：系统级 AI 集成，Apple Intelligence

**核心能力**：
- Proofread：语法检查 + 修改建议 + 解释
- Rewrite：重写为友好/专业/简洁风格
- Summarize：生成摘要/要点/列表/表格
- 录音转写：音频自动转文字并总结

**特色功能**：
- **Writing Tools**：系统级写作工具，可在任何应用中使用
- **实时语法检查**：所有修改都有下划线标注和解释
- **多种格式输出**：Summary、Key Points、List、Table

**设备要求**：iPhone 15 Pro/16 系列、M1+ Mac

**参考链接**：
- [Apple Notes AI 功能](https://support.apple.com/guide/iphone/use-apple-intelligence-in-notes-iph59143007d/ios)
- [iOS 18 Writing Tools 指南](https://www.macobserver.com/ios/master-ios-18-writing-tools-how-to-proofread-rewrite-summarize-and-compose-like-a-pro/)

---

### 5. Reflect

**定位**：个人知识管理 + AI 结合，注重隐私

**核心能力**：
- GPT-4/Claude 双模型：可选择不同 AI 引擎
- 语音转写：Whisper 驱动的语音笔记
- 智能大纲：自动生成文章大纲
- 会议要点：提取会议关键信息

**特色功能**：
- **双向链接**：使用 `[[]]` 创建笔记间的关联
- **知识图谱**：可视化思维连接
- **端到端加密**：保护隐私
- **实时同步**：跨设备实时同步

**参考链接**：
- [Reflect 官网](https://reflect.app/)
- [Reflect AI 功能介绍](https://reflect.academy/artificial-intelligence)

---

### 6. Google NotebookLM

**定位**：研究助手，专注于与源材料对话

**核心能力**：
- 多源支持：PDF、网页、YouTube、文档等
- Q&A 问答：基于上传的源材料回答问题
- Audio Overview：将笔记转为播客式对话

**特色功能**：
- **播客生成**：两个 AI 主持人讨论你的资料，支持 Deep Dive、Brief、Critique、Debate 等格式
- **互动模式**：可以用语音加入对话，向主持人提问
- **源材料锚定**：所有回答都基于你提供的资料，减少幻觉

**技术栈**：Gemini 1.5 Pro

**参考链接**：
- [NotebookLM Audio Overview](https://blog.google/technology/ai/notebooklm-audio-overviews/)
- [NotebookLM 使用指南](https://www.datacamp.com/tutorial/notebooklm)

---

### 7. Obsidian + AI 插件生态

**定位**：本地优先的知识管理，通过插件扩展 AI 能力

**主要 AI 插件**：

#### Smart Connections
- 语义相似度连接笔记
- 侧边栏显示相关笔记（相似度分数 0-1）
- 支持本地模型和云端 API
- 私有嵌入，数据不离开设备

#### Copilot
- 对话式 AI 界面
- 支持 GPT-4、本地模型
- 隐私优先，本地向量存储

#### 其他插件
- Auto Classifier：自动标签建议
- Companion：AI 自动补全
- ChatGPT MD：在笔记中嵌入对话

**参考链接**：
- [Smart Connections](https://github.com/brianpetro/obsidian-smart-connections)
- [Obsidian GPT 插件比较](https://medium.com/@airabbitX/comprehensive-comparison-of-gpt-powered-obsidian-plugins-in-2024-f3fdfc983362)

---

### 8. Tana

**定位**：大纲工具 + Supertags + AI，面向 Power Users

**核心能力**：
- Supertags：动态元数据模式，将任意节点转为结构化数据
- 语音转写：Tana Capture 语音输入，AI 提取任务和摘要
- 会议代理：自动转写会议、归因发言人、建议跟进

**特色功能**：
- **无限嵌套**：大纲结构可无限展开
- **双向引用**：`@` 提及任意笔记
- **日历集成**：同步 Google Calendar，AI 会议笔记

**定价**：~$18/月，含 5000 AI credits

**参考链接**：
- [Tana 官网](https://tana.inc/)
- [Tana Supertags 介绍](https://www.xda-developers.com/tana-supertags-review/)

---

### 9. Raycast AI

**定位**：Mac 效率工具，AI 快速调用

**核心能力**：
- Quick AI：快速问答，热键调用
- AI Chat：独立对话窗口
- AI Commands：内置或自定义提示词
- AI Extensions：扩展集成

**特色功能**：
- **全局热键**：任何应用中快速调用
- **剪贴板上下文**：自动使用选中文本或剪贴板
- **多模型支持**：OpenAI、Anthropic、Perplexity 等
- **Floating Notes**：支持 Markdown 的便签

**参考链接**：
- [Raycast AI 文档](https://manual.raycast.com/ai)
- [Raycast Notes](https://www.raycast.com/core-features/notes)

---

## AI 场景全景图

### 一、写作辅助场景

#### 1.1 内容生成

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **续写/补全** | 在光标处继续写作 | 按空格触发、Tab 接受 | Notion AI、Craft |
| **Ghost Text 实时补全** | 打字时显示灰色预测文本 | 自动触发、Tab 接受 | Replit Ghostwriter、GitHub Copilot |
| **扩写** | 让简短内容更详细 | 选中 → "Make longer" | Notion AI、Wordtune |
| **头脑风暴** | 围绕主题生成想法列表 | "/brainstorm" | Notion AI |
| **大纲生成** | 自动生成文章/文档结构 | 输入主题 → 生成大纲 | Grammarly、HyperWrite |

**场景详解：Ghost Text 实时补全**

这是一种与 AI 协作的高级交互模式：
- AI 在用户暂停时提供补全建议
- 以灰色/淡色文本显示在光标后
- 用户可用 Tab 接受、Esc 拒绝、或继续输入忽略
- 支持接受部分建议（按词/按行）

Replit 的经验：
> "AI 建议现在直接流式显示在编辑器中，响应时间从数秒降到亚秒级"

#### 1.2 编辑润色

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **语法修正** | 修复拼写和语法错误 | 选中 → "Fix grammar" | Notion AI、Apple Notes |
| **改变语气** | 专业/友好/简洁/正式/随意 | 选中 → 选择语气 | Wordtune、Apple Notes |
| **缩写** | 让冗长内容更简洁 | 选中 → "Make shorter" | Notion AI、Wordtune |
| **简化语言** | 降低阅读难度 | 选中 → "Simplify" | HyperWrite、Notion AI |
| **改善表达** | 提升文字质量 | 选中 → "Improve writing" | Notion AI、Grammarly |

**语气调整选项（行业标准）**：
- Professional（专业）
- Friendly（友好）
- Concise（简洁）
- Formal（正式）
- Casual（随意）
- Confident（自信）
- Empathetic（共情）

#### 1.3 翻译

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **全文翻译** | 翻译整篇笔记 | 菜单 → 翻译 → 选语言 | Notion AI (14种语言) |
| **选中翻译** | 翻译选中片段 | 选中 → 翻译 | Craft、Raycast AI |
| **实时翻译** | 边写边翻译 | 自动检测 | DeepL |

**Notion AI 支持的语言**：
英语、韩语、中文、日语、西班牙语、俄语、法语、葡萄牙语、德语、意大利语、荷兰语、印尼语、菲律宾语、越南语

---

### 二、内容处理场景

#### 2.1 总结提取

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **生成摘要** | 总结长文为段落 | "/summarize" 或选中 | Notion AI、Apple Notes |
| **提取要点** | 列出关键信息 | "Key points" | Apple Notes、Notion AI |
| **提取待办** | 从文本提取 Action Items | "/action items" | Notion AI、Otter.ai |
| **生成标题** | 为内容生成标题 | 自动或手动触发 | Notion AI |

**摘要格式选项（Apple Notes）**：
- Summary：概述性段落
- Key Points：要点列表
- List：简单列表
- Table：表格形式

#### 2.2 格式转换

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **文本转表格** | 结构化信息转表格 | 选中 → "Convert to table" | Apple Notes |
| **文本转列表** | 段落转项目符号列表 | 选中 → "Convert to list" | Apple Notes |
| **列表转段落** | 列表转流畅文字 | 选中 → "Convert to paragraph" | Notion AI |

#### 2.3 解释说明

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **解释概念** | 解释选中的术语/概念 | 选中 → "Explain this" | Notion AI、Craft |
| **定义词汇** | 查询词义和同义词 | 选中 → "Define" | Notion AI |
| **代码解释** | 解释代码功能 | 选中代码 → "Explain" | Notion AI |

---

### 三、知识管理场景

#### 3.1 智能搜索

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **语义搜索** | 基于含义而非关键词搜索 | 自然语言查询 | Mem AI、Smart Connections |
| **Q&A 问答** | 与笔记库对话 | "我的X政策是什么？" | Notion AI Q&A、Mem |
| **跨文档搜索** | 在多个文档中找答案 | 提问 → AI 综合回答 | NotebookLM、Craft |

**语义搜索 vs 关键词搜索**：
- 关键词搜索："font size settings" 只匹配包含这些词的文档
- 语义搜索："increase text size on display" 能匹配 "How to adjust font size in settings"

**技术实现**：
- 使用 Embedding 模型（如 OpenAI text-embedding-3、E5）将文本转为向量
- 存储在向量数据库（如 pgvector、Pinecone）
- 查询时计算语义相似度

#### 3.2 智能关联

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **相关笔记推荐** | 显示语义相似的笔记 | 侧边栏自动显示 | Mem、Smart Connections |
| **双向链接建议** | 建议可链接的笔记 | 输入 `[[` 时推荐 | Obsidian、Reflect |
| **知识图谱** | 可视化笔记关联 | 图形化展示 | Obsidian、Logseq |

**Smart Connections 实现细节**：
- 使用语义相似度而非精确关键词匹配
- 每个相关笔记显示相似度分数（0-1）
- 支持本地嵌入，数据不离开设备
- Pro 版支持内联连接徽章、实时更新

#### 3.3 自动组织

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **自动标签** | AI 建议或自动添加标签 | 保存时自动分析 | Mem Collections、Evernote |
| **自动分类** | 将笔记归入合适的文件夹 | 自动或建议 | Mem、Reflectr |
| **智能命名** | 为无标题笔记生成标题 | 自动生成 | Mem |

**Mem Collections 工作原理**：
> "使用尖端 AI，Collections 根据内容和上下文自动分类和连接你团队的知识。当你记笔记时，Mem 分析内容并建议相关 Collections。无需手动归档！"

---

### 四、多模态场景

#### 4.1 语音相关

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **语音转文字** | 语音输入转笔记 | 录音 → 转写 | Whisper、Apple Notes |
| **会议录音转写** | 会议录音转文字记录 | 导入音频 → 转写 | Otter.ai、Fireflies |
| **语音笔记** | 说话即记录 | 点击录音按钮 | Reflect、Tana |
| **播客生成** | 将笔记转为对话音频 | "Generate Audio" | NotebookLM |

**OpenAI Whisper**：
- 开源语音识别模型
- 训练数据：68万小时多语言音频
- 支持多语言转写和翻译
- 对口音、背景噪音、专业术语有较好鲁棒性

**NotebookLM Audio Overview**：
- 两个 AI 主持人讨论你的资料
- 支持多种格式：Deep Dive、Brief、Critique、Debate
- 可下载带走，也可互动提问

#### 4.2 图片/文档

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **图片 OCR** | 识别图片中的文字 | 插入图片 → 提取文字 | Notion AI、Evernote |
| **图片理解** | 描述图片内容 | 选中图片 → "Describe" | Notion AI |
| **PDF 解析** | 提取 PDF 内容并总结 | 上传 → 分析 | Notion AI、NotebookLM |
| **网页摘录** | 保存网页并提取要点 | 浏览器扩展 | Mem Clipper |

---

### 五、专业场景

#### 5.1 会议相关

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **会议纪要生成** | 从转写生成结构化纪要 | 一键生成 | Notion AI、Read.ai |
| **待办提取** | 提取会议中的任务 | 自动识别 | Fireflies、ClickUp |
| **决策记录** | 提取会议中的决定 | 自动识别 | Otter.ai、Sembly |
| **跟进邮件** | 生成会议跟进邮件 | "Generate follow-up" | Fireflies、Notion AI |

**会议 AI 产品对比**：

| 产品 | 特色 | 准确率 |
|------|------|--------|
| Otter.ai | 自动识别和分配 Action Items | - |
| Fireflies | 集成 CRM，自动创建任务 | - |
| Read.ai | 跨会议、邮件、消息搜索 | - |
| Notta | 支持 58 种语言 | 98.86% |
| iWeaver | 识别负责人和截止日期 | 95% |

#### 5.2 写作辅助

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **博客草稿** | 生成博客文章初稿 | 输入主题 → 生成 | Notion AI |
| **邮件起草** | 生成邮件内容 | 描述目的 → 生成 | Notion AI、Raycast AI |
| **社交媒体** | 生成推文/帖子 | 选中内容 → 转换 | Notion AI、Craft |

#### 5.3 学习研究

| 场景 | 描述 | 典型交互 | 代表产品 |
|------|------|----------|----------|
| **文献总结** | 总结学术论文 | 上传 PDF → 总结 | NotebookLM |
| **学习卡片** | 从笔记生成闪卡 | 选中 → 生成卡片 | Notion AI |
| **问题生成** | 从内容生成测试题 | "Generate questions" | NotebookLM |

---

## 六、AI 交互模式分析

### 6.1 触发方式

| 模式 | 描述 | 优点 | 缺点 | 代表产品 |
|------|------|------|------|----------|
| **斜杠命令** `/ai` | 输入 `/` 触发命令菜单 | 发现性好、熟悉 | 需要记忆命令 | Notion |
| **选中菜单** | 选中文本后出现 AI 选项 | 上下文明确 | 需要先选中 | Notion、Apple Notes |
| **快捷键** `⌘J` | 快捷键直接调用 | 快速、高效 | 需要学习 | Raycast |
| **Ghost Text** | 打字时自动显示补全 | 无缝、流畅 | 可能干扰 | Copilot |
| **侧边面板** | 独立 AI 对话面板 | 持续对话、历史记录 | 占用空间 | Notion Q&A |
| **空行按空格** | 空行按空格触发 AI | 自然、无缝 | 发现性差 | Notion |
| **浮动按钮** | 光标附近显示 AI 按钮 | 直观 | 可能遮挡 | Craft |

### 6.2 响应方式

| 模式 | 描述 | 适用场景 |
|------|------|----------|
| **直接插入** | AI 内容直接插入文档 | 生成、续写 |
| **替换选中** | 替换用户选中的内容 | 改写、翻译 |
| **弹窗预览** | 弹窗显示，用户确认后插入 | 重要修改 |
| **侧边显示** | 在侧边栏显示相关内容 | 关联推荐、搜索结果 |
| **流式输出** | 逐字显示生成过程 | 长内容生成 |
| **Diff 视图** | 显示修改前后对比 | 编辑润色 |

### 6.3 用户体验最佳实践

**Replit Ghostwriter 的演进**：
> "之前 Ghostwriter 使用弹出窗口来生成、解释和编辑代码。虽然最初有效，但有时会打断编码流程，点击外部或移动时弹窗可能丢失。"
>
> "现在 Ghostwriter 内联操作作为持久内联小部件打开，即使移动也保持打开并保留信息。所有功能包括快捷键都在一个易于访问的位置。"

**关键设计原则**：
1. **减少干扰**：AI 建议不应打断用户流程
2. **渐进式披露**：简单功能易于发现，高级功能可探索
3. **可撤销**：所有 AI 操作都可撤销
4. **透明度**：让用户知道 AI 在做什么
5. **控制感**：用户始终可以接受、拒绝或修改 AI 输出

---

## 七、技术实现参考

### 7.1 语义搜索 / RAG 架构

```
┌─────────────────────────────────────────────────────────┐
│                      用户查询                            │
│                  "项目进度怎么样了"                       │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  Embedding 模型                          │
│           text-embedding-3-small / E5 / BGE            │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    向量数据库                            │
│           pgvector / Pinecone / Milvus                 │
│                                                         │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐               │
│   │ Note 1  │  │ Note 2  │  │ Note 3  │  ...          │
│   │ [0.1,   │  │ [0.3,   │  │ [0.2,   │               │
│   │  0.8,   │  │  0.2,   │  │  0.7,   │               │
│   │  ...]   │  │  ...]   │  │  ...]   │               │
│   └─────────┘  └─────────┘  └─────────┘               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    相似度计算                            │
│              余弦相似度 / 内积 / 欧氏距离                 │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Top-K 结果                           │
│                                                         │
│   Note 2 (score: 0.92) - "上周项目会议纪要..."          │
│   Note 5 (score: 0.87) - "Q3 项目里程碑..."             │
│   Note 1 (score: 0.81) - "团队周报..."                  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                      LLM 生成                           │
│                                                         │
│   System: 基于以下笔记回答用户问题                       │
│   Context: [相关笔记内容]                                │
│   User: 项目进度怎么样了                                 │
│                                                         │
│   → "根据上周会议纪要，项目目前进度正常，                │
│      已完成 3/5 个里程碑..."                            │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Embedding 模型选择

| 模型 | 提供商 | 维度 | 特点 |
|------|--------|------|------|
| text-embedding-3-small | OpenAI | 1536 | 性价比高 |
| text-embedding-3-large | OpenAI | 3072 | 更高精度 |
| E5-large-v2 | Microsoft | 1024 | 开源，多语言 |
| BGE-large-zh | BAAI | 1024 | 中文优化 |
| all-MiniLM-L6-v2 | Sentence Transformers | 384 | 轻量级 |

### 7.3 本地 vs 云端

| 方案 | 优点 | 缺点 |
|------|------|------|
| **云端 API** | 无需部署、持续更新 | 隐私风险、网络依赖、成本 |
| **本地模型** | 隐私保护、离线可用 | 性能要求高、模型较小 |
| **混合方案** | 平衡隐私和能力 | 实现复杂 |

**本地模型选项**：
- Ollama：本地运行 LLM
- Whisper.cpp：本地语音转写
- ONNX Runtime：本地 Embedding

---

## 八、场景优先级建议

基于用户价值和实现复杂度，建议按以下优先级实现：

### 🥇 第一梯队（高价值 + 相对易实现）

**1. 选中文本操作**
- 总结/摘要
- 翻译（中↔英）
- 改写润色（修语法、改语气）
- 扩写/缩写

**2. 续写/补全**
- 光标处继续写作
- 基于上下文生成

**3. 解释说明**
- 解释选中概念
- 简化复杂文本

**实现建议**：
- 触发方式：选中菜单 + 快捷键 `⌘J`
- 响应方式：流式输出 + 替换/插入选项
- 模型：Claude / GPT-4o-mini（平衡成本和质量）

### 🥈 第二梯队（高价值 + 中等复杂度）

**4. Q&A 问答**
- 与当前笔记对话
- 与整个笔记库对话（需要 Embedding）

**5. 智能搜索**
- 语义搜索（需要向量数据库）
- 相关笔记推荐

**6. 内容生成**
- 大纲生成
- 头脑风暴

**实现建议**：
- 需要构建 Embedding Pipeline
- 考虑使用 SQLite + sqlite-vss 或 pgvector
- 侧边面板交互

### 🥉 第三梯队（探索性功能）

**7. Ghost Text 补全**
- 打字时实时提示（需要优化延迟）

**8. 自动标签/分类**
- AI 建议标签

**9. 语音输入**
- Whisper 转写

**10. 多模态**
- 图片理解
- PDF 解析

**实现建议**：
- Ghost Text 需要解决延迟问题（目标 < 200ms）
- 语音可用 Whisper API 或本地 whisper.cpp
- 多模态需要 Vision 模型支持

---

## 九、参考资料

### 产品官方文档

| 产品 | 链接 |
|------|------|
| Notion AI | [完整功能指南](https://www.notion.com/help/guides/everything-you-can-do-with-notion-ai) |
| Craft | [AI Assistant](https://support.craft.do/hc/en-us/articles/8104602502557-About-Craft-AI-Assistant) |
| Apple Notes | [AI 功能](https://support.apple.com/guide/iphone/use-apple-intelligence-in-notes-iph59143007d/ios) |
| Mem | [官网](https://get.mem.ai/) |
| NotebookLM | [Audio Overview](https://support.google.com/notebooklm/answer/16212820) |
| Reflect | [官网](https://reflect.app/) |
| Tana | [官网](https://tana.inc/) |

### 技术实现参考

| 主题 | 链接 |
|------|------|
| Obsidian Smart Connections | [GitHub](https://github.com/brianpetro/obsidian-smart-connections) |
| Replit Ghostwriter UX | [博客](https://blog.replit.com/ghostwriter-inline) |
| OpenAI Whisper | [官网](https://openai.com/index/whisper/) |
| 向量搜索实现 | [Supabase 文档](https://supabase.com/docs/guides/ai/semantic-search) |

### 行业分析

| 主题 | 链接 |
|------|------|
| AI 笔记应用对比 2025 | [Mem Blog](https://get.mem.ai/blog/best-ai-note-taking-apps-2025) |
| GPT Obsidian 插件对比 | [Medium](https://medium.com/@airabbitX/comprehensive-comparison-of-gpt-powered-obsidian-plugins-in-2024-f3fdfc983362) |
| AI 写作工具 | [ClickUp](https://clickup.com/blog/how-to-use-ai-for-note-taking/) |

---

## 更新日志

| 日期 | 更新内容 |
|------|----------|
| 2024-12-20 | 初版完成，涵盖主要产品和场景分析 |
