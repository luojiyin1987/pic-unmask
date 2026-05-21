# MIGAN Web Inpainting — Cloudflare Pages 部署架构

## 1. 架构概览

```
User Browser
│
├─ Cloudflare Pages (React/Vite SPA)
│  ├─ UI: Upload / Mask Editor / Result Preview
│  ├─ Image Preprocess (mask-guided crop → 512×512 inference patch)
│  ├─ Mask Editor (Canvas-based brush / polygon)
│  └─ WebWorker (inference.js)
│     └─ ONNX Runtime Web
│         ├─ WebGPU (preferred, compute-intensive)
│         └─ WASM fallback (CPU)
│
└─ Cloudflare R2 / CDN
   ├─ migan_pipeline_v2.onnx (model, ~29.5 MiB)
   ├─ ort-wasm-simd.wasm
   ├─ ort-wasm-simd-threaded.wasm
   ├─ ort-wasm-simd.jsep.wasm
   └─ ort.webgpu.min.js / ort.min.js
```

## 2. 关键技术决策

| 决策项 | 选型 | 理由 |
|--------|------|------|
| 前端框架 | React 18 + Vite 5 | 构建快、Tree-shaking 好、Pages 原生支持 |
| 推理后端 | onnxruntime-web 1.17+ | 官方支持 WebGPU / WASM / WebNN |
| 执行后端优先级 | WebGPU → WASM SIMD threaded | WebGPU 对 Conv/TransposeConv 收益巨大；WASM 保底 |
| 数据类型 | fp16 | 模型体积减半，WebGPU 原生支持 fp16 storage |
| 输入尺寸 | 512×512 patch (固定) | 模型仍吃固定 patch，但只对 mask 局部区域推理，输出再贴回原图 |
| 模型加载 | R2 Custom Domain / CDN | Pages Function 有 50MB limit，大模型走 R2 + 签名 URL |
| 线程隔离 | 必须 WebWorker | 避免阻塞主线程；WASM 多线程需在 Worker 中启用 |

## 3. 目录结构

```
.
├── public/
│   ├── _headers                 # Pages 静态响应头
│   └── models/                  # 可选：本地调试用模型占位目录
├── src/
│   ├── components/
│   │   ├── UploadPanel.tsx
│   │   ├── MaskEditor.tsx
│   │   └── ResultViewer.tsx
│   ├── workers/
│   │   └── inference.worker.ts   # ONNX Runtime 推理 Worker
│   ├── lib/
│   │   ├── preprocess.ts         # Mask-guided crop / patch compose
│   │   ├── postprocess.ts        # Tensor → Image
│   │   └── ort-env.ts            # ORT backend 初始化与环境配置
│   └── App.tsx
├── index.html
├── vite.config.ts
├── wrangler.toml                 # Pages 项目配置
└── package.json
```

## 4. 模型加载策略

Cloudflare Pages 的免费/Pro 计划对单个文件大小有限制（通过 Functions 请求也受 CPU/Memory 限制）。MIGAN FP16 ONNX 模型可能 50MB-150MB，因此：

1. **默认从 Hugging Face 公开直链加载模型**，零额外托管配置即可部署。
2. **大于 25 MiB 的模型可放 R2 bucket**，通过 Custom Domain 或 Public Access 提供。
3. **应用启动后懒加载模型**，可通过 `VITE_MODEL_URL` 切换到 Hugging Face、R2 或自有 CDN。
4. **ORT WASM 文件默认从公网 CDN 加载**，优先 `jsDelivr`，失败时回退 `unpkg`，并在 Worker 中用 `ort.env.wasm.wasmPaths` 显式指定。

## 5. 输入输出规范 (512×512 patch)

- **输入图像**：用户上传任意尺寸图片，编辑器按原图比例显示，并在原图坐标系上保存 mask。
- **Crop-region inference**：根据 mask 包围盒计算带上下文的 square crop，将该局部区域 resize 到 512×512 做推理。
- **Mask**：推理前将 crop 内 mask resize 到 512×512，二值化，并做 4px 膨胀处理。
- **ONNX Input**（Worker 会根据模型元数据自动适配）：
  - **官方 MI-GAN ONNX pipeline**：`image` 为 `uint8` RGB，`mask` 为 `uint8` Grayscale
  - **传统双输入网络**：`image` 为 `float16/float32 [1,3,H,W]`，`mask` 为 `float16/float32 [1,1,H,W]`
  - **单输入网络**：自动将图像与 mask 拼成 4 通道输入
- **ONNX Output**：
  - 支持 `float16` / `float32` / `uint8` 输出
  - 输出 layout 支持 NCHW (`[1,3,H,W]`)、NHWC (`[1,H,W,3]`) 或 CHW (`[3,H,W]`)
  - 反归一化后 → Canvas → PNG/DataURL

## 6. WebWorker 职责

主线程与 Worker 通过 `postMessage` 通信：

```
Main → Worker: { type: 'INFER', imageTensor: Float32Array, maskTensor: Float32Array }
Worker → Main: { type: 'RESULT', imageData: ImageData } | { type: 'ERROR', message: string }
```

Worker 内完成：
1. `ort.env.wasm.numThreads = navigator.hardwareConcurrency` (WASM 多线程)
2. `ort.InferenceSession.create(url, { executionProviders: ['webgpu', 'wasm'] })`
3. 构造 `ort.Tensor` → `session.run({ image, mask })` → 返回结果

## 7. WebGPU 与 Fallback

- **检测**: `navigator.gpu ? 'webgpu' : 'wasm'`
- **ONNX Runtime 配置**:
  - `executionProviders: ['webgpu', 'wasm']`（自动 fallback）
  - WebGPU 模式下 FP16 计算/存储路径最优
- **WASM 优化**: 启用 SIMD + Multi-thread (`ort-wasm-simd-threaded.wasm`)

## 8. Pages 部署配置

- 使用 `wrangler pages project create` 或直接 Git 集成。
- `vite.config.ts` 中需配置 `base: './'` 或具体路径，确保相对路径正确。
- WASM 文件默认不随 Pages 产物发布，而是通过 CDN 提供；Vite 的 `assetsInlineLimit` 设为 0 避免意外内联大资源。

## 9. 安全与性能

- **CORS**: 如果模型放在 R2 Custom Domain，需允许 Pages domain 的 `cross-origin` 请求。
- **Cache-Control**: R2 上的模型和 WASM 设置长期缓存（immutable）。
- **内存**: WebGPU 推理时 GPU buffer 占用仍主要由 512×512 patch 决定，显存压力可控；主线程额外承担一次原图回贴。
- **降级提示**: WebGPU 不可用时给出 UI 提示“正在使用 CPU 模式，速度较慢”。

## 10. 后续扩展

- Dynamic shape: 导出多分辨率 ONNX (256/512/1024) 或支持 dynamic axes，减少当前固定 patch 对极大/极小区域的折中。
- WebNN: 待 ONNX Runtime Web 的 WebNN backend 成熟后可加入 `['webnn', 'webgpu', 'wasm']`。
- Tile-based inference: 对于 2048+ 大图分块推理。
