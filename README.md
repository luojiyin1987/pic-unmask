# MIGAN Web Inpainting

Browser-side image inpainting with React, Vite, `onnxruntime-web`, and Cloudflare Pages.

Large uploads keep their original output resolution. The app now runs inference on a mask-guided `512x512` crop patch and composites the generated patch back onto the full-size image in the browser.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

Deploy the `dist/` directory to Cloudflare Pages:

```bash
npx wrangler pages deploy dist
```

See [DEPLOY.md](./DEPLOY.md) for the full deployment notes.

## Model

Default model (~29.5 MiB):

```text
https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx
```

The inference worker automatically adapts to the model's input metadata:

- **MI-GAN ONNX pipeline**: `image` (`uint8` RGB) + `mask` (`uint8` Grayscale)
- **Standard dual-input**: `image` (`float16/float32` NCHW) + `mask` (`float16/float32` NCHW)
- **Single-input**: auto-concatenates masked image + mask into 4 channels

Override the model URL at build time:

```text
VITE_MODEL_URL=...
```

## ORT WASM Risk

This project loads ONNX Runtime Web WASM files from a CDN by default.

Default base URL:

```text
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/
```

Fallback:

```text
https://unpkg.com/onnxruntime-web@1.26.0/dist/
```

Important risk:

- The npm package version of `onnxruntime-web` and the CDN WASM version must match exactly.
- If they do not match, the app may fail with errors such as:
  - `ort-wasm-simd-threaded.jsep.mjs 404`
  - WASM initialization failure
  - runtime incompatibility between JS and WASM artifacts

Rule:

- If you change `onnxruntime-web` in [package.json](./package.json), update the CDN version in:
  - [src/App.tsx](./src/App.tsx)
  - [src/workers/inference.worker.ts](./src/workers/inference.worker.ts)
  - [.env.example](./.env.example)

Cloudflare Pages risk:

- Pages has a 25 MiB single-asset limit.
- `ort-wasm-simd-threaded.jsep.wasm` and some ONNX models can exceed that limit.
- That is why this repo does not ship the large ORT WASM binaries as local Pages assets by default.
