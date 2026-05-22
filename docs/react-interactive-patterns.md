# React 高频交互优化笔记

> 记录 2026-05-22 在优化「对比滑块」拖拽体验时的踩坑与复盘。

---

## 一、问题描述

在「修复结果」页面中，拖动对比线（before/after slider）时出现以下问题：

1. **拖拽卡顿**：拖动时滑块位置更新不跟手，有明显延迟感。
2. **图片拖拽幽灵图标**：拖动时浏览器显示图片的半透明缩略图 + 禁止图标（🚫）。
3. **鼠标移出容器后拖拽中断**：鼠标划出图片区域后，滑块不再跟随。

---

## 二、根本原因分析

### 问题 1：拖拽卡顿

**原始代码**：

```tsx
onMouseMove={(e) => {
  const pct = calculatePercentage(e.clientX)
  setSliderPos(pct)  // 每次 mousemove 都触发 React 重渲染
}}
```

`mousemove` 事件每秒触发 **60~120 次**。每次调用 `setSliderPos` 都会触发：

1. React 重新渲染 `ResultViewer` 组件
2. 虚拟 DOM diff
3. 计算新的 `style={{ clipPath: ... }}`
4. 浏览器重新 layout + paint

**这不是 React 慢，而是把 React 用在了错误的场景。**

React 擅长**低频状态驱动 UI**（点击按钮、切换 Tab），不适合**高频实时反馈**（拖拽、滚动、游戏、复杂动画）。

### 问题 2：图片拖拽幽灵图标

```tsx
<img src={originalUrl} alt="original" />
```

浏览器默认 `<img>` 的 `draggable` 属性为 `auto`，即**允许拖拽**。当鼠标在图片上按下并开始移动时，浏览器认为这是「拖拽图片」操作，于是显示一个半透明的 ghost image。

**这跟 React 完全无关**，纯 HTML 也会这样。

### 问题 3：鼠标移出容器后拖拽中断

原始代码把 `onMouseMove` / `onMouseUp` 绑定在 `<div className="compare-container">` 上：

```tsx
<div
  onMouseDown={handleMouseDown}
  onMouseUp={handleMouseUp}
  onMouseLeave={handleMouseUp}
  onMouseMove={handleMouseMove}
>
```

一旦鼠标移出这个 `div`，事件就不再触发，导致拖拽中断。

这是**浏览器 DOM 事件冒泡/捕获范围**的基础知识，也不是 React 的限制。

---

## 三、解决方案

### 3.1 拖拽卡顿 → 绕过 React 渲染，直接操作 DOM

**核心思路**：拖拽期间直接修改 DOM（`ref.current.style.xxx`），松手后再同步一次 React state。

```tsx
const overlayRef = useRef<HTMLDivElement>(null)
const sliderRef = useRef<HTMLDivElement>(null)
const isDragging = useRef(false)
const rafId = useRef<number>(0)

const updateSlider = useCallback((clientX: number) => {
  if (!containerRef.current) return
  const rect = containerRef.current.getBoundingClientRect()
  const x = clientX - rect.left
  const pct = Math.max(0, Math.min(100, (x / rect.width) * 100))

  // 直接操作 DOM，不触发 React 重渲染
  if (overlayRef.current) {
    overlayRef.current.style.clipPath = `inset(0 ${100 - pct}% 0 0)`
  }
  if (sliderRef.current) {
    sliderRef.current.style.left = `${pct}%`
  }
}, [])

useEffect(() => {
  const onMove = (e: MouseEvent) => {
    if (!isDragging.current) return
    e.preventDefault()
    if (rafId.current) cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => updateSlider(e.clientX))
  }
  // ...mouseup 时同步 state 回 React
}, [updateSlider])
```

同时给频繁变化的元素加上 `will-change` 提示浏览器提前优化：

```tsx
<div style={{ willChange: 'clip-path' }} />
<div style={{ willChange: 'left' }} />
```

### 3.2 图片拖拽幽灵图标 → 禁用原生拖拽

```tsx
{/* 两张对比图都加 draggable={false} */}
<img src={originalUrl} draggable={false} />
<img src={resultUrl} draggable={false} />
```

同时在容器上阻止 `dragstart`：

```tsx
<div onDragStart={(e) => e.preventDefault()}>
```

### 3.3 鼠标移出容器中断 → 全局事件监听

把 `mousemove` / `mouseup` / `touchmove` / `touchend` 绑定到 `document` 上，而不是容器 `div`：

```tsx
useEffect(() => {
  document.addEventListener('mousemove', onMove, { passive: false })
  document.addEventListener('mouseup', onUp)
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('touchend', onTouchEnd)
  // ...cleanup
}, [])
```

这样无论鼠标/手指移动到哪里，事件都能正常捕获。

---

## 四、关键认知

### React 没有限制你做丝滑的拖拽

React 的声明式模型（state → UI）在某些场景下反而是「过度设计」。

| 场景 | 推荐方式 |
|------|---------|
| 按钮点击、表单输入、Tab 切换 | React state |
| 拖拽、滚动监听、游戏循环、复杂动画 | ref + 直接 DOM 操作 |

**遇到实时交互时，第一反应应该是**：「这里需要绕过 React 的渲染周期，直接操作 DOM」。

### 浏览器原生行为容易被忽略

- `<img>` 默认可拖拽
- `touchmove` 默认是 passive 事件，无法调用 `preventDefault()`
- 事件绑定在元素上时，鼠标移出即失效

这些都不是框架问题，而是**HTML/CSS/DOM 标准行为**。做交互优化时，不能只看 React，必须回到浏览器底层。

---

## 五、最佳实践 Checklist

下次实现拖拽/滑动类交互时，对照检查：

- [ ] 高频更新走 `ref` + `requestAnimationFrame`，不走 `setState`
- [ ] 松手后再把最终值 `setState` 同步回 React
- [ ] 事件绑定在 `document` 上，而不是容器元素
- [ ] 图片加 `draggable={false}`
- [ ] 触摸事件需要 `{ passive: false }` 才能 `preventDefault()`
- [ ] 频繁变化的样式加 `will-change` 做性能提示
- [ ] 组件卸载时清理 RAF 和事件监听器
