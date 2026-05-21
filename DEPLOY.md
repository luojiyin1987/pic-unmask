# 部署指南

## 前置条件

- Node.js 18+
- Cloudflare 账号
- Wrangler CLI 已登录: `npx wrangler login`

## 1. 准备模型与静态资源

### 方案 A: 默认方案，直接使用 Hugging Face 公开直链

这个项目默认已经指向公开模型：

```text
https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx
```

如果你不想用 R2，也不想自己托管模型，可以直接保持默认配置部署。

### 方案 B: 模型放 R2

`migan-fp16.onnx` 常见分发版本约 **29.5 MiB**，超过 Cloudflare Pages 单个静态文件 **25 MiB** 上限，所以推荐把模型放 R2，只把前端和 ORT wasm 部署到 Pages。

```bash
# 创建 R2 bucket 存放模型
wrangler r2 bucket create migan-assets

# 上传 MIGAN FP16 ONNX 模型
wrangler r2 object put migan-assets/models/migan-fp16.onnx --file=/path/to/migan-fp16.onnx
```

### R2 Custom Domain / Public Access

在 Cloudflare Dashboard 中为 bucket 绑定 Custom Domain（如 `https://cdn.example.com`），并开启 **Public Access**。这样浏览器可以直接下载模型。

### 方案 C: 仅本地开发，模型放 Pages 静态目录

如果你的模型文件小于 25 MiB，可以直接放到：

```bash
public/models/migan-fp16.onnx
```

本仓库默认就会从 `/models/migan-fp16.onnx` 加载。

## 2. 配置环境变量

```bash
cp .env.example .env
# 默认可不改。
# 如果模型放 R2，把 VITE_MODEL_URL 改成你的 R2 Custom Domain URL。
```

## 3. 本地开发

```bash
npm install
npm run dev
```

开发服务器会自动加上 `Cross-Origin-Embedder-Policy: require-corp`，以支持 WASM SharedArrayBuffer 多线程。
同时 `npm run dev` 会自动把 ORT 所需的 `.mjs/.wasm` 文件同步到 `public/ort/`。

## 4. 构建

```bash
npm run build
```

构建产物输出到 `dist/`：
- 包含 `public/_headers`
- 包含 `public/ort/` 下的 ONNX Runtime `.mjs/.wasm`
- 主包约 150KB

## 5. 部署到 Cloudflare Pages

### 方式 A: Wrangler CLI 直接上传

```bash
npm run pages:deploy
```

### 方式 B: Git 集成（推荐）

在 Cloudflare Dashboard > Pages 中连接 GitHub/GitLab 仓库：
- **Build command**: `npm run build`
- **Build output directory**: `dist`

## 6. CORS / COOP / COEP 说明

Pages 侧的静态响应头通过 `public/_headers` 提供：

```text
/*
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
```

这确保了：
1. `SharedArrayBuffer` 可用（WASM 多线程必需）
2. 与 Hugging Face 或 R2 的跨域请求需要远端允许 `Access-Control-Allow-Origin`

## 7. 模型输入输出适配

当前 Worker 会根据模型元数据自动选择输入适配方式：

- 官方 MI-GAN ONNX pipeline:
  - `image`: `uint8` RGB
  - `mask`: `uint8` Grayscale
- 传统双输入网络:
  - `image`: `float16/float32 [1,3,H,W]`
  - `mask`: `float16/float32 [1,1,H,W]`
- 单输入网络:
  - 自动拼成 4 通道 `masked_image + mask`

## 8. 性能提示

- **WebGPU**: 首次加载模型时可能需要几秒编译 shader；后续同 session 推理很快。
- **WASM fallback**: 在不支持 WebGPU 的浏览器上自动回退；首次也会编译 WASM，建议添加加载指示器。
- **FP16**: WebGPU 路径天然支持 FP16；WASM 路径 FP16 会以 FP32 模拟或依赖 WASM SIMD，速度会慢一些。

## 9. 已知限制

- Pages Functions 有 50MB 内存限制，但模型在浏览器端运行，不经过 Pages Function。
- Pages 单文件上限是 25 MiB；29.5 MiB 的 `migan.onnx` 不适合直接作为 Pages 静态文件发布。
