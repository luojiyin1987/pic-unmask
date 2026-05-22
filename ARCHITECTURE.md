# MIGAN Web Inpainting Architecture

## 1. Overview

This project is a browser-only image inpainting app built with React, Vite, and `onnxruntime-web`, then deployed as a static site on Cloudflare Pages.

The key architectural constraint is simple:

- User images must stay in the browser.
- Model inference must run locally on the client device.
- Cloudflare Pages is only responsible for serving static assets.

At runtime, the app performs local preprocessing on the main thread, runs ONNX inference inside a Web Worker, and composites the generated patch back onto the original full-resolution image in the browser.

## 2. Runtime Topology

```text
Browser
│
├─ React SPA
│  ├─ UploadPanel        -> accepts local image file
│  ├─ MaskEditor         -> keeps editable full-resolution mask
│  ├─ ResultViewer       -> compare/download final result
│  └─ App                -> orchestrates workflow and worker messaging
│
├─ Main-thread image pipeline
│  └─ src/lib/preprocess.ts
│     ├─ load original image
│     ├─ find mask bounds
│     ├─ expand to square crop with padding
│     ├─ resize crop to 512x512
│     └─ pack RGB image bytes + binary mask bytes
│
├─ Web Worker
│  └─ src/workers/inference.worker.ts
│     ├─ detect backend: WebGPU -> WebNN -> WASM
│     ├─ download/cache ONNX model
│     ├─ configure ORT WASM asset URLs
│     ├─ adapt inputs to model metadata
│     ├─ run inference
│     └─ convert output tensor to ImageData
│
└─ Static asset hosts
   ├─ Cloudflare Pages   -> app bundle, headers, HTML/CSS/JS
   ├─ Hugging Face / R2  -> ONNX model URL
   └─ jsDelivr / unpkg   -> ORT WASM runtime assets
```

## 3. Module Map

### Entry and shell

- [src/main.tsx](/home/luo/devOps/pic-unmask/src/main.tsx): mounts the app and wraps it with `I18nProvider`.
- [src/App.tsx](/home/luo/devOps/pic-unmask/src/App.tsx): owns the user workflow state, worker lifecycle, status text, language switch, and step-based UI.
- [src/index.css](/home/luo/devOps/pic-unmask/src/index.css): global design tokens and shared visual primitives.

### UI components

- [src/components/UploadPanel.tsx](/home/luo/devOps/pic-unmask/src/components/UploadPanel.tsx): drag-and-drop or click upload; converts a local file to an object URL.
- [src/components/MaskEditor.tsx](/home/luo/devOps/pic-unmask/src/components/MaskEditor.tsx): renders a scaled preview canvas, maintains a separate full-resolution offscreen mask canvas, and supports draw/erase/clear.
- [src/components/ResultViewer.tsx](/home/luo/devOps/pic-unmask/src/components/ResultViewer.tsx): shows the result, before/after comparison slider, and download action.

### Processing and runtime helpers

- [src/lib/preprocess.ts](/home/luo/devOps/pic-unmask/src/lib/preprocess.ts): main-thread image loading, crop computation, mask dilation, inference input packing, and final patch compositing.
- [src/lib/ort-env.ts](/home/luo/devOps/pic-unmask/src/lib/ort-env.ts): backend detection helper for `webgpu`, `webnn`, and `wasm`.
- [src/lib/postprocess.ts](/home/luo/devOps/pic-unmask/src/lib/postprocess.ts): generic tensor-to-image helper. Current worker code performs its own output conversion and does not depend on this helper.
- [src/lib/i18n.ts](/home/luo/devOps/pic-unmask/src/lib/i18n.ts) and [src/lib/I18nContext.tsx](/home/luo/devOps/pic-unmask/src/lib/I18nContext.tsx): bilingual text dictionary and persisted language selection.

### Worker

- [src/workers/inference.worker.ts](/home/luo/devOps/pic-unmask/src/workers/inference.worker.ts): the inference boundary. It owns model caching, ORT initialization, tensor adaptation, execution provider fallback, session reuse, and output decoding.

### Deployment config

- [vite.config.ts](/home/luo/devOps/pic-unmask/vite.config.ts): Vite build target, relative base path, dev headers for cross-origin isolation, and worker output format.
- [public/_headers](/home/luo/devOps/pic-unmask/public/_headers): Cloudflare Pages response headers needed for isolation and caching.
- [wrangler.toml](/home/luo/devOps/pic-unmask/wrangler.toml): Pages project metadata.

## 4. End-to-End Flow

### 4.1 Upload

1. The user selects an image in `UploadPanel`.
2. The file is converted into a local object URL.
3. `App` stores the URL and resets any prior result state.

### 4.2 Mask authoring

1. `MaskEditor` loads the original image.
2. It creates:
   - one display canvas scaled down for interaction
   - one offscreen mask canvas at original image resolution
3. Brush strokes drawn on the display canvas are mapped back to the full-resolution mask canvas.
4. The full-resolution mask canvas is passed back to `App`.

### 4.3 Preprocess

When the user clicks Run:

1. `prepareInferenceInputs()` loads the original image again.
2. It scans the mask alpha channel to find the masked bounding box.
3. It expands that region to a square crop using:
   - a minimum padding of `32px`
   - a relative padding ratio of `25%`
4. It renders both image crop and mask crop to fixed `512x512` canvases.
5. It packs:
   - RGB image bytes into `Uint8Array`
   - binary mask values into `Uint8Array`
6. It dilates the mask by radius `4` to give the model more context around the edited edge.

### 4.4 Worker inference

1. `App` transfers the packed `ArrayBuffer`s to the worker.
2. The worker detects execution providers with this preference:
   - `webgpu`
   - `webnn`
   - `wasm`
3. The worker downloads the ONNX model, then caches it using the browser Cache API.
4. It configures ORT WASM runtime URLs from:
   - `VITE_WASM_BASE_URL` or the default jsDelivr path
   - `unpkg` as fallback
5. It reuses the existing `InferenceSession` as long as `modelUrl` does not change.
6. It inspects model metadata and adapts inputs dynamically.

Supported input shapes/types:

- Two-input `uint8` models, such as the MI-GAN pipeline variant.
- Two-input `float16` / `float32` models with separate image and mask tensors.
- One-input 4-channel models, where RGB + mask are concatenated.

### 4.5 Postprocess and compose

1. The worker converts the first output tensor into `ImageData`.
2. `App` receives the patch result.
3. `composeResultImage()` pastes the generated patch back into the original full-resolution image.
4. The final image is exported as a PNG data URL for preview and download.

## 5. Data and State Boundaries

### Main thread responsibilities

- User interaction
- Upload state
- Mask editing
- Crop preparation
- Final compositing
- Status rendering and localization

### Worker responsibilities

- Model loading
- Model caching
- Runtime backend selection
- Tensor creation and format adaptation
- ONNX inference execution
- Output tensor decoding

### Why this split exists

- Inference is compute-heavy and must not block pointer input or rendering.
- WASM multi-threading and large model initialization are better isolated in a worker.
- The main thread still needs DOM/canvas access for file handling, crop extraction, and result compositing.

## 6. Key Design Decisions

| Area | Current design | Reason |
| --- | --- | --- |
| Hosting | Static SPA on Cloudflare Pages | No server-side inference required |
| Privacy model | Entirely local image processing | Avoids image upload and reduces backend scope |
| Inference granularity | Fixed `512x512` local crop patch | Preserves output resolution while bounding inference cost |
| Worker usage | Dedicated module worker | Keeps UI responsive and isolates runtime setup |
| Backend fallback | `webgpu -> webnn -> wasm` | Prefer acceleration, keep CPU fallback |
| Model loading | Remote URL via env override | Decouples app deploy from model hosting choice |
| ORT WASM assets | External CDN with fallback | Avoids shipping oversized runtime assets on Pages |
| Model reuse | Session cached per `modelUrl` | Avoids repeated initialization during a session |
| Localization | In-app dictionary, localStorage persistence | Minimal dependency surface for bilingual UI |

## 7. Deployment Architecture

This app is not a Cloudflare Worker inference service. Cloudflare Pages only serves the frontend bundle.

### Required static hosting behavior

- `base: './'` in Vite so the build works under Pages paths.
- Cross-origin isolation headers in both local dev and deployed Pages responses:
  - `Cross-Origin-Embedder-Policy: require-corp`
  - `Cross-Origin-Opener-Policy: same-origin`
- Immutable caching for built assets.

### External asset expectations

- The ONNX model must be reachable by the browser with valid CORS.
- ORT WASM files must match the exact `onnxruntime-web` package version used by the app.
- If Cloudflare Pages cannot host a file because of asset-size limits, that file must remain external.

## 8. Configuration Surface

Build-time environment variables:

- `VITE_MODEL_URL`
  - Overrides the default Hugging Face model URL.
  - Can point to Hugging Face, R2, or any other CDN/static host.

- `VITE_WASM_BASE_URL`
  - Overrides the primary ONNX Runtime WASM base URL.
  - Must contain artifacts compatible with the app's `onnxruntime-web` version.

Hardcoded defaults currently live in [src/App.tsx](/home/luo/devOps/pic-unmask/src/App.tsx) and [src/workers/inference.worker.ts](/home/luo/devOps/pic-unmask/src/workers/inference.worker.ts), so version bumps need coordinated updates.

## 9. Current Constraints and Risks

### Browser/runtime constraints

- WebGPU support varies by browser and device.
- WASM fallback is slower and still depends on cross-origin isolation for threaded execution.
- Large models and large images can increase memory pressure on weaker devices.

### Deployment constraints

- Cloudflare Pages is suitable here because inference never runs on the server.
- Large ONNX models and ORT runtime artifacts may exceed Pages static asset limits, so remote hosting remains part of the architecture.

### Code-level constraints

- `src/lib/postprocess.ts` is currently not on the main runtime path.
- Worker status strings are emitted directly in English, while app UI strings go through i18n.
- The current comparison between original and result is patch-composited PNG output, not a layer-preserving editable project state.

## 10. Extension Points

Reasonable next steps within the current architecture:

- Support touch drawing in `MaskEditor` for mobile/tablet workflows.
- Move more status messages through i18n for consistent localization.
- Add multi-model selection if several ONNX variants need to be tested.
- Add persistent model warm-up and backend diagnostics UI.
- Add tile-based or dynamic-shape inference for extremely large masked regions.
- Consolidate worker output decoding with `src/lib/postprocess.ts` if shared conversion logic becomes desirable.

## 11. Architecture Summary

The actual architecture is a client-side inpainting pipeline, not a server-assisted image service:

- React owns workflow and presentation.
- Canvas utilities own crop extraction and patch compositing.
- A dedicated worker owns ONNX Runtime and model execution.
- Cloudflare Pages only hosts the static application shell.
- The model and ORT runtime are treated as externally addressable dependencies that can be swapped via environment variables.

That separation keeps the app private-by-default, cheap to host, and portable across different model hosting setups without changing the UI architecture.
