# 应用图标规范与生成指南

本文档记录「心流」应用的图标规范、目录结构和生成流程。

## 图标规范

### macOS 应用图标 (.icns)

macOS 使用 `.icns` 格式，需要提供多种尺寸以适配不同分辨率和使用场景。

| 文件名 | 尺寸 | 用途 |
|--------|------|------|
| icon_16x16.png | 16×16 | Finder 列表、Spotlight |
| icon_16x16@2x.png | 32×32 | Retina @2x |
| icon_32x32.png | 32×32 | Finder 图标 |
| icon_32x32@2x.png | 64×64 | Retina @2x |
| icon_128x128.png | 128×128 | Finder 预览 |
| icon_128x128@2x.png | 256×256 | Retina @2x |
| icon_256x256.png | 256×256 | Finder 大图标 |
| icon_256x256@2x.png | 512×512 | Retina @2x |
| icon_512x512.png | 512×512 | App Store |
| icon_512x512@2x.png | 1024×1024 | Retina @2x / App Store |

**要求：**
- 格式：PNG，支持透明背景
- 源图建议至少 1024×1024 像素
- 图标应为正方形，无需圆角（系统会自动处理）

### Windows 应用图标 (.ico)

Windows 使用 `.ico` 格式，一个文件内包含多种尺寸。

| 尺寸 | 用途 |
|------|------|
| 16×16 | 标题栏、文件列表小图标 |
| 24×24 | 任务栏图标 |
| 32×32 | 桌面图标（标准） |
| 48×48 | 资源管理器大图标 |
| 256×256 | 超大图标、高 DPI 显示 |

**要求：**
- 256×256 尺寸建议使用 PNG 压缩以减小文件体积
- 32 位色深（含 alpha 通道）

### macOS 托盘图标 (Menu Bar)

macOS 菜单栏有严格的尺寸限制，使用 **Template Image** 可自动适配明暗模式。

| 文件名 | 尺寸 | 说明 |
|--------|------|------|
| trayTemplate.png | 18×18 | @1x 标准分辨率 |
| trayTemplate@2x.png | 36×36 | @2x Retina 分辨率 |

**Template Image 要求：**
- 文件名必须包含 `Template` 后缀
- 图像为单色（黑色），使用 alpha 通道控制形状
- 系统会自动根据明/暗模式着色
- 最大高度 22pt，推荐图标主体 16-18pt

### Windows 托盘图标 (System Tray)

| 尺寸 | 用途 |
|------|------|
| 16×16 | 标准 DPI |
| 24×24 | 中等 DPI (125%-150%) |
| 32×32 | 高 DPI (200%) |

**要求：**
- 可以使用彩色图标
- 32 位色深
- 建议打包为 `.ico` 文件

## 目录结构

```
resources/icons/
├── mac/
│   ├── icon.icns              # macOS 应用图标（打包用）
│   └── icon.iconset/          # 源 PNG 文件集
│       ├── icon_16x16.png
│       ├── icon_16x16@2x.png
│       ├── icon_32x32.png
│       ├── icon_32x32@2x.png
│       ├── icon_128x128.png
│       ├── icon_128x128@2x.png
│       ├── icon_256x256.png
│       ├── icon_256x256@2x.png
│       ├── icon_512x512.png
│       └── icon_512x512@2x.png
├── win/
│   ├── icon.ico               # Windows 应用图标（打包用）
│   ├── icon_16x16.png
│   ├── icon_24x24.png
│   ├── icon_32x32.png
│   ├── icon_48x48.png
│   └── icon_256x256.png
└── tray/
    ├── trayTemplate.png       # macOS 托盘 @1x
    ├── trayTemplate@2x.png    # macOS 托盘 @2x
    ├── tray.ico               # Windows 托盘图标
    ├── tray_16x16.png
    ├── tray_24x24.png
    └── tray_32x32.png
```

## 生成流程

### 前置条件

- Python 3 + Pillow 库
- macOS（用于生成 .icns）

```bash
pip3 install Pillow
```

### 从源图生成全套图标

假设源图为 `flow-logo.png`（正方形，透明背景，建议 1024×1024 以上）：

```python
from PIL import Image
import os

src = Image.open('flow-logo.png')
base_dir = 'resources/icons'

# === macOS 应用图标 ===
mac_sizes = [
    ('icon_16x16.png', 16),
    ('icon_16x16@2x.png', 32),
    ('icon_32x32.png', 32),
    ('icon_32x32@2x.png', 64),
    ('icon_128x128.png', 128),
    ('icon_128x128@2x.png', 256),
    ('icon_256x256.png', 256),
    ('icon_256x256@2x.png', 512),
    ('icon_512x512.png', 512),
    ('icon_512x512@2x.png', 1024),
]

iconset_dir = f'{base_dir}/mac/icon.iconset'
os.makedirs(iconset_dir, exist_ok=True)

for name, size in mac_sizes:
    resized = src.resize((size, size), Image.LANCZOS)
    resized.save(f'{iconset_dir}/{name}', 'PNG')

# === Windows 应用图标 ===
win_sizes = [16, 24, 32, 48, 256]
os.makedirs(f'{base_dir}/win', exist_ok=True)

for size in win_sizes:
    resized = src.resize((size, size), Image.LANCZOS)
    resized.save(f'{base_dir}/win/icon_{size}x{size}.png', 'PNG')

src.save(f'{base_dir}/win/icon.ico', format='ICO',
         sizes=[(s, s) for s in win_sizes])

# === 托盘图标 ===
os.makedirs(f'{base_dir}/tray', exist_ok=True)

# macOS Template Image（单色）
for name, size in [('trayTemplate.png', 18), ('trayTemplate@2x.png', 36)]:
    resized = src.resize((size, size), Image.LANCZOS).convert('RGBA')
    pixels = resized.load()
    for y in range(size):
        for x in range(size):
            r, g, b, a = pixels[x, y]
            if a > 0:
                luminance = r * 0.299 + g * 0.587 + b * 0.114
                new_alpha = int((255 - luminance) * a / 255)
                pixels[x, y] = (0, 0, 0, new_alpha)
            else:
                pixels[x, y] = (0, 0, 0, 0)
    resized.save(f'{base_dir}/tray/{name}', 'PNG')

# Windows 托盘（彩色）
tray_sizes = [16, 24, 32]
for size in tray_sizes:
    resized = src.resize((size, size), Image.LANCZOS)
    resized.save(f'{base_dir}/tray/tray_{size}x{size}.png', 'PNG')

src.save(f'{base_dir}/tray/tray.ico', format='ICO',
         sizes=[(s, s) for s in tray_sizes])
```

### 生成 macOS .icns 文件

在 macOS 上使用系统自带的 `iconutil` 命令：

```bash
iconutil -c icns resources/icons/mac/icon.iconset -o resources/icons/mac/icon.icns
```

## 在 Electron 中使用

### electron-builder 配置

```json
{
  "build": {
    "mac": {
      "icon": "resources/icons/mac/icon.icns"
    },
    "win": {
      "icon": "resources/icons/win/icon.ico"
    }
  }
}
```

### Tray 图标加载

```typescript
import { Tray, nativeImage } from 'electron'
import path from 'path'

function createTray() {
  let trayIcon: string

  if (process.platform === 'darwin') {
    // macOS: 使用 Template Image
    trayIcon = path.join(__dirname, '../resources/icons/tray/trayTemplate.png')
  } else {
    // Windows: 使用 ICO
    trayIcon = path.join(__dirname, '../resources/icons/tray/tray.ico')
  }

  const icon = nativeImage.createFromPath(trayIcon)

  // macOS: 标记为 Template Image
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true)
  }

  const tray = new Tray(icon)
  return tray
}
```

## 参考资料

- [Apple Icon Image format - Wikipedia](https://en.wikipedia.org/wiki/Apple_Icon_Image_format)
- [Designing macOS menu bar extras - Bjango](https://bjango.com/articles/designingmenubarextras/)
- [Construct your Windows app's icon - Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/design/style/iconography/app-icon-construction)
- [Windows ICO Made Simple - Creative Freedom](https://www.creativefreedom.co.uk/icon-designers-blog/windows-ico-made-simple/)
