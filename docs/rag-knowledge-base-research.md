# RAG 知识库技术调研

> 调研时间: 2024-12-28
> 调研目标: 了解 NotebookLM 及开源替代方案的技术实现原理

## 目录

1. [NotebookLM 技术原理](#1-notebooklm-技术原理)
2. [Open-Notebook 项目分析](#2-open-notebook-项目分析)
3. [RAG 编排流程详解](#3-rag-编排流程详解)
4. [技术选型参考](#4-技术选型参考)

---

## 1. NotebookLM 技术原理

### 1.1 核心架构：RAG (Retrieval-Augmented Generation)

NotebookLM 本质上是一个 **源文档锚定的 RAG 系统**，底层使用 Google Gemini 2.5 Flash 模型。

### 1.2 工作流程

```
用户上传文档 → 文档解析 → 分块(Chunking) → 向量嵌入(Embedding)
                                              ↓
用户查询 → 查询嵌入 → 向量相似度搜索 → 检索相关片段 → LLM生成回答(带引用)
```

### 1.3 关键技术组件

| 组件 | 说明 |
|------|------|
| **Embedding 模型** | Gemini Embedding，支持 8K token 输入，3072 维输出向量 |
| **向量存储** | Google 内部向量数据库（不公开具体实现） |
| **分块策略** | 自动管理，支持语义分块 + 重叠（业界最佳实践是 10-20% 重叠） |
| **检索算法** | 基于向量相似度搜索（推测使用 HNSW 等高性能索引） |
| **生成模型** | Gemini 系列 LLM |

### 1.4 支持的数据源

- PDF、Google Docs、PPT
- 网页 URL、YouTube 视频
- 每个 Notebook 最多 50 个源（Pro 版 300 个）
- 单源最大 500,000 词，总计可达 2500 万词

### 1.5 核心设计理念：Source-Grounded

与通用 LLM 不同，NotebookLM **只基于上传的文档回答问题**：
- 每个回答都带有明确引用
- 大幅减少幻觉（hallucination）
- 答案可追溯验证

### 1.6 技术限制

1. **Notebook 隔离**：不同 Notebook 之间知识无法互通
2. **无持久化知识图谱**：不像传统 PKM 那样有跨领域链接
3. **多模态支持有限**：复杂数学公式、图表解析能力仍有不足

### 1.7 Google 的封装策略

Google 将复杂的 RAG 技术栈完全抽象化，开发者/用户无需关心：
- 具体用哪个 embedding 模型
- 向量数据库选型
- 分块策略调优
- 检索算法实现

这与 Google 新推出的 **File Search Tool**（托管式 RAG API）理念一致。

---

## 2. Open-Notebook 项目分析

> 项目地址: https://github.com/lfnovo/open-notebook
> Stars: 16.6k
> 定位: NotebookLM 的开源替代品，隐私优先、自托管

### 2.1 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js + React)               │
│                         Port 8502                           │
└─────────────────────────┬───────────────────────────────────┘
                          │ /api/* proxy
┌─────────────────────────▼───────────────────────────────────┐
│                    Backend (FastAPI)                        │
│                         Port 5055                           │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │   Graphs    │  │    Domain    │  │     Plugins       │   │
│  │ (RAG/Chat)  │  │  (Entities)  │  │  (Extensions)     │   │
│  └─────────────┘  └──────────────┘  └───────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    SurrealDB (内置)                         │
│               全文搜索 + 向量搜索                            │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心技术栈

| 层级 | 技术选型 |
|------|----------|
| **Frontend** | Next.js + React |
| **Backend** | FastAPI + Pydantic |
| **数据库** | SurrealDB（同时支持全文和向量搜索） |
| **AI 编排** | LangChain + LangGraph |
| **文档解析** | Docling |
| **多模型抽象** | Esperanto 库（自研） |

### 2.3 AI Provider 支持（16+）

| 类型 | 支持的服务商 |
|------|-------------|
| **LLM** | OpenAI, Anthropic, Groq, Ollama, LM Studio, Mistral, DeepSeek, xAI 等 |
| **Embedding** | OpenAI, Google GenAI, Voyage, Mistral |
| **STT** | OpenAI Whisper, Groq |
| **TTS** | OpenAI, ElevenLabs, Google GenAI |

### 2.4 核心模块

**`/graphs` - RAG 核心**
- `ask.py` - 查询处理（策略生成 → 并行检索 → 答案融合）
- `chat.py` - 对话管理
- `source.py` - 文档源处理
- `source_chat.py` - 基于源的上下文对话
- `tools.py` - 工具/函数定义

**`/domain` - 业务实体**
- `notebook.py` - 笔记本实体
- `podcast.py` - 播客生成
- `transformation.py` - 内容转换

**`/prompts` - 提示词模板**
- `ask/` - 查询相关模板（entry, query_process, final_answer）
- `chat.jinja` - 对话模板
- `source_chat.jinja` - 源对话模板
- `podcast/` - 播客生成模板

### 2.5 设计原则

1. **Privacy First** - 自托管，数据不离开用户控制
2. **API-First** - 所有功能必须有 API，前端只是 API 消费者
3. **Multi-Provider** - 通过抽象层支持任意 AI 服务商切换
4. **Async-First** - 长任务（如播客生成）异步处理，不阻塞 UI
5. **Simplicity Over Features** - 宁简勿繁

### 2.6 快速部署

```bash
docker run -d --name open-notebook \
  -p 8502:8502 -p 5055:5055 \
  -v ./notebook_data:/app/data \
  -v ./surreal_data:/mydata \
  -e OPENAI_API_KEY=your_key \
  lfnovo/open_notebook:v1-latest-single
```

---

## 3. RAG 编排流程详解

### 3.1 ASK 流程整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ASK 流程 (ask.py)                           │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │   用户问题   │───▶│  策略生成    │───▶│  并行查询触发         │  │
│  │              │    │ (LLM分解)    │    │ (Send机制)            │  │
│  └──────────────┘    └──────────────┘    └───────────────────────┘  │
│                                                   │                 │
│                                    ┌──────────────┼──────────────┐  │
│                                    ▼              ▼              ▼  │
│                              ┌─────────┐    ┌─────────┐    ┌─────────┐
│                              │ Query 1 │    │ Query 2 │    │ Query N │
│                              │ 向量搜索 │    │ 向量搜索 │    │ 向量搜索 │
│                              └────┬────┘    └────┬────┘    └────┬────┘
│                                   │              │              │  │
│                                   └──────────────┼──────────────┘  │
│                                                  ▼                 │
│                                         ┌───────────────┐          │
│                                         │  答案融合     │          │
│                                         │ (带引用)      │          │
│                                         └───────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 阶段 1：策略生成 (Strategy Generation)

**文件**: `ask.py` → `call_model_with_messages`

```python
# 结构化输出定义
class SearchItem(BaseModel):
    term: str          # 搜索关键词
    instructions: str  # 搜索指令

class Strategy(BaseModel):
    reasoning: str           # 推理过程
    searches: list[SearchItem]  # 最多5个搜索任务
```

**Prompt 模板** (`prompts/ask/entry.jinja`):
- 输入：用户问题 + 格式指令
- 输出：JSON 格式的搜索策略
- LLM 分析问题，拆解为多个可并行的搜索任务

### 3.3 阶段 2：并行向量检索

**文件**: `ask.py` → `trigger_queries` + `provide_answer`

```python
def trigger_queries(state: AskState):
    """为每个搜索项触发并行查询"""
    return [
        Send("provide_answer", {
            "question": state["question"],
            "search": search,
            ...
        })
        for search in state["strategy"].searches
    ]
```

**向量搜索实现** (`notebook.py` → `vector_search`):

```python
async def vector_search(keyword, num_results, scope, min_similarity=0.2):
    # 1. 获取 embedding 模型
    embedding_model = model_manager.get_default_embedding_model()

    # 2. 将关键词转为向量
    vector = await embedding_model.aembed([keyword])[0]

    # 3. 调用 SurrealDB 向量搜索函数
    results = await db.query(
        "fn::vector_search($vector, $num, $scope, $min_sim)",
        vector=vector,
        num=num_results,
        scope=scope,
        min_sim=min_similarity
    )
    return results
```

### 3.4 阶段 3：答案合成

**文件**: `ask.py` → `write_final_answer`

**Prompt 模板** (`prompts/ask/final_answer.jinja`):
- 输入：原始问题 + 策略推理 + 所有检索结果
- 输出：带引用的最终答案

**引用格式要求**:
```
必须使用完整文档ID: [source:abc123] 或 [note:xyz789]
禁止编造文档ID
引用内容需准确，有字符限制
```

### 3.5 文档源处理流程 (Source Processing)

**文件**: `source.py`

```
START
  │
  ▼
┌─────────────────┐
│ content_process │  ← 使用 Docling 解析 PDF/网页/音视频
│   提取内容      │  ← 音频用 Whisper 转文字
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   save_source   │  ← 保存到 SurrealDB
│   向量化存储    │  ← 生成 embedding 并索引
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ trigger_transformations │  ← 可选：应用转换规则
└────────┬────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│ 摘要  │ │ 问答  │  ← 并行执行多个转换
└───────┘ └───────┘
         │
         ▼
        END
```

### 3.6 对话流程 (Chat)

**文件**: `chat.py` + `source_chat.py`

```
用户消息
    │
    ▼
┌─────────────────────┐
│ 构建系统提示        │  ← Jinja 模板渲染
│ (注入 notebook 上下文)│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  检索相关上下文     │  ← context_config 控制深度
│  (可选向量搜索)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   LLM 生成回答      │  ← 清理 <think> 标签
│   (带源引用)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ SqliteSaver 持久化  │  ← 保存对话状态
└─────────────────────┘
```

### 3.7 关键设计模式

| 模式 | 实现方式 | 价值 |
|------|----------|------|
| **查询分解** | LLM 输出结构化 Strategy | 复杂问题拆解为多个简单检索 |
| **并行检索** | LangGraph Send 机制 | 提升响应速度 |
| **向量+全文混合** | SurrealDB 原生支持 | 单一数据库简化架构 |
| **引用追踪** | 强制 `[doc_id]` 格式 | 可验证性，减少幻觉 |
| **异步优先** | async/await 全链路 | 高并发处理 |
| **状态检查点** | SqliteSaver | 对话可恢复 |

---

## 4. 技术选型参考

### 4.1 NotebookLM vs Open-Notebook 对比

| 特性 | NotebookLM | Open-Notebook |
|------|------------|---------------|
| 查询策略 | 黑盒 | 透明（Strategy 可见） |
| 向量数据库 | Google 内部 | SurrealDB（自托管） |
| 模型选择 | Gemini 固定 | 16+ 供应商可切换 |
| 引用机制 | 有 | 有，格式更严格 |
| 部署方式 | SaaS | 自托管 Docker |
| 隐私控制 | Google 托管 | 完全自控 |
| 播客生成 | 有 | 有，支持多角色 |

### 4.2 对三千笔记的启发

如果要实现类似的知识库能力，核心组件包括：

| 组件 | 可选方案 | 建议 |
|------|----------|------|
| **文档解析** | Docling, Unstructured, LlamaParse | Docling 开源免费 |
| **Embedding** | OpenAI, Gemini, 本地模型 | 根据成本和隐私需求选择 |
| **向量数据库** | SurrealDB, Qdrant, Milvus, SQLite+向量扩展 | SurrealDB 一体化方案值得考虑 |
| **AI 编排** | LangChain, LangGraph, 自研 | LangGraph 适合复杂流程 |
| **Re-ranking** | Cohere, 本地模型 | 提升检索精度 |

### 4.3 值得借鉴的设计

1. **查询分解策略**：LLM 先分析问题，生成多个搜索任务，比单次检索更精准
2. **严格的引用机制**：强制 `[doc_id]` 格式，确保可追溯
3. **API-First 架构**：前后端解耦，便于扩展
4. **Multi-Provider 抽象**：通过适配层支持多模型切换，避免供应商锁定
5. **Jinja 模板管理 Prompt**：便于维护和版本控制

---

## 参考资料

- [NotebookLM Official Site](https://notebooklm.google/)
- [NotebookLM: An LLM with RAG for active learning (arXiv)](https://arxiv.org/html/2504.09720v2)
- [Gemini Embedding: Powering RAG and context engineering](https://developers.googleblog.com/en/gemini-embedding-powering-rag-context-engineering/)
- [RAG and grounding on Vertex AI](https://cloud.google.com/blog/products/ai-machine-learning/rag-and-grounding-on-vertex-ai)
- [Open-Notebook GitHub](https://github.com/lfnovo/open-notebook)
- [Open-Notebook Design Principles](https://github.com/lfnovo/open-notebook/blob/main/DESIGN_PRINCIPLES.md)
