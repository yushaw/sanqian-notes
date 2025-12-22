# 打字机音效文件说明

## 音效来源

所有音效文件来自 [Tickeys](https://github.com/yingDev/Tickeys) 项目的 typewriter 方案（MIT License）。

## 文件列表

### 特殊按键音效

- `backspace.wav` (50KB) - 退格键/删除键音效
- `return-new.wav` (347KB) - 回车键音效
- `space-new.wav` (45KB) - 空格键音效

### 普通按键音效（轮流播放）

- `key-new-01.wav` (54KB)
- `key-new-02.wav` (63KB)
- `key-new-03.wav` (45KB)
- `key-new-04.wav` (41KB)
- `key-new-05.wav` (54KB)

### 未使用的音效

- `scrollDown.wav` (45KB) - 向下滚动音效（保留，暂未使用）
- `scrollUp.wav` (63KB) - 向上滚动音效（保留，暂未使用）

## 音效映射策略

参考 Tickeys 的实现：

```typescript
按键类型           对应音效
---------------------------------------
Backspace/Delete  → backspace.wav
Enter             → return-new.wav
Space             → space-new.wav
普通字符 (a-z等)   → key-new-01~05.wav (轮流播放)
```

## 技术实现

使用 Web Audio API 实现，完全兼容 macOS 和 Windows：

1. **音效预加载**: 所有文件在打字机模式启动时加载到内存
2. **轮流播放**: 普通按键使用 5 个音效文件轮流播放，增加真实感
3. **防抖机制**: 30ms 内的重复按键会被忽略
4. **音频池**: 最多同时播放 3 个音效，避免叠加过多

## 文件格式

- **格式**: WAV (未压缩)
- **采样率**: 44.1kHz
- **位深度**: 16-bit
- **声道**: 单声道/立体声
- **总大小**: ~800KB

## 许可证

这些音效文件来自 Tickeys 项目，遵循 MIT License：

```
Copyright (c) yingDev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction...
```

完整许可证文本：https://github.com/yingDev/Tickeys/blob/master/LICENSE

## 使用方法

在打字机模式下：
1. 默认音效已开启
2. 点击底部工具栏的音效按钮可切换开/关
3. 不同按键会播放不同的音效

## 自定义音效

如果想使用其他音效方案：

1. 替换对应的 `.wav` 文件
2. 确保文件名保持一致
3. 建议使用相同的音频格式和采样率
4. 文件大小建议控制在 50-100KB

## 参考资料

- [Tickeys GitHub](https://github.com/yingDev/Tickeys)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
