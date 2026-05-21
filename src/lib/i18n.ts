export type Lang = 'en' | 'zh'

interface Translations {
  // App
  appTitle: string
  statusReady: string
  statusPreprocessing: string
  statusRunning: string
  statusDone: string
  statusError: string
  btnNew: string
  btnRunInpainting: string
  btnProcessing: string
  stepUpload: string
  stepMask: string
  stepResult: string
  uploadTitle: string
  uploadDesc: string
  uploadHint: string
  maskTitle: string
  maskDesc: string
  maskPlaceholder: string
  resultTitle: string
  resultDesc: string
  footer: string
  // MaskEditor
  brush: string
  erase: string
  size: string
  clear: string
  maskHintDraw: string
  maskHintErase: string
  // ResultViewer
  resultTab: string
  originalTab: string
  download: string
  resultPlaceholder: string
  before: string
  after: string
  privacyBadge: string
  privacyUploadHint: string
  privacyFooter: string
  // Misc
  [key: string]: string
}

const dict: Record<Lang, Translations> = {
  en: {
    appTitle: 'MIGAN Inpainting',
    statusReady: 'Ready',
    statusPreprocessing: 'Preprocessing...',
    statusRunning: 'Running inference in WebWorker...',
    statusDone: 'Inpainting complete',
    statusError: 'Error',
    btnNew: 'New',
    btnRunInpainting: 'Run Inpainting',
    btnProcessing: 'Processing...',
    stepUpload: 'Upload',
    stepMask: 'Mask',
    stepResult: 'Result',
    uploadTitle: 'Upload Image',
    uploadDesc: 'Choose a photo to remove objects or restore damaged areas',
    uploadHint: 'Drop image here or click to browse',
    uploadSubHint: 'Supports JPG, PNG · Max 5MB · 512×512 recommended',
    maskTitle: 'Draw Mask',
    maskDesc: 'Paint over the area you want to inpaint',
    maskPlaceholder: 'Upload an image first to start masking',
    resultTitle: 'Result',
    resultDesc: 'AI-powered image restoration',
    footer: 'Powered by ONNX Runtime Web with WebGPU / WASM fallback',
    brush: 'Brush',
    erase: 'Erase',
    size: 'Size',
    clear: 'Clear',
    maskHintDraw: 'Paint over the area to remove',
    maskHintErase: 'Erase mask strokes',
    resultTab: 'Result',
    originalTab: 'Original',
    download: 'Download',
    resultPlaceholder: 'Your inpainted image will appear here',
    before: 'Before',
    after: 'After',
    privacyBadge: 'Privacy First',
    privacyUploadHint: 'Your image is processed entirely in your browser. Nothing is uploaded to any server.',
    privacyFooter: 'Your images never leave your browser. All AI processing runs locally on your device.',
  },
  zh: {
    appTitle: 'MIGAN 图像修复',
    statusReady: '就绪',
    statusPreprocessing: '预处理中...',
    statusRunning: 'WebWorker 推理中...',
    statusDone: '修复完成',
    statusError: '错误',
    btnNew: '新建',
    btnRunInpainting: '开始修复',
    btnProcessing: '处理中...',
    stepUpload: '上传',
    stepMask: '涂抹',
    stepResult: '结果',
    uploadTitle: '上传图片',
    uploadDesc: '选择一张需要移除物体或修复的照片',
    uploadHint: '拖拽图片到此处或点击浏览',
    uploadSubHint: '支持 JPG、PNG · 最大 5MB · 推荐 512×512',
    maskTitle: '绘制蒙版',
    maskDesc: '在需要修复的区域上涂抹',
    maskPlaceholder: '请先上传图片以开始涂抹',
    resultTitle: '修复结果',
    resultDesc: 'AI 驱动的图像修复',
    footer: '由 ONNX Runtime Web 驱动，支持 WebGPU / WASM 降级',
    brush: '画笔',
    erase: '橡皮擦',
    size: '粗细',
    clear: '清空',
    maskHintDraw: '在需要移除的区域涂抹',
    maskHintErase: '擦除蒙版笔画',
    resultTab: '修复结果',
    originalTab: '原图',
    download: '下载',
    resultPlaceholder: '修复后的图片将显示在此处',
    before: '修复前',
    after: '修复后',
    privacyBadge: '隐私优先',
    privacyUploadHint: '图片仅在您的浏览器中处理，不会上传到任何服务器。',
    privacyFooter: '您的图片不会离开浏览器，所有 AI 处理均在本地设备上运行。',
  },
}

export function getT(lang: Lang) {
  return (key: keyof Translations) => dict[lang][key] ?? key
}
