import { useEffect, useRef } from "react";

/**
 * 让原生 <details> 披露控件具备现代浮层行为：指针在面板外按下或按 Escape
 * 时自动关闭。summary 与面板内部点击保持原生切换语义不变，因此既有
 * 「点击 summary 开/关」流程（含 E2E 逐步切换）完全不受影响。
 *
 * 实现要点：
 * - open 属性始终由浏览器原生管理（React 不接管），这里只在需要时移除它；
 * - handler 内实时读 ref.current：条件渲染的兄弟节点显隐会让 React 重建
 *   details 节点，闭包缓存旧节点会导致外点关闭静默失效；
 * - 指针监听用 mousedown + capture，与应用内 ContextMenu 的外点关闭同一
 *   事件路径（合成事件/真实鼠标均可靠触发）；
 * - Escape 用 capture + stopPropagation：面板打开时第一次 Esc 只关闭面板，
 *   不会穿透到全局的「清空选择」等 Esc 处理。
 */
export function useDismissibleDetails<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    // 关键：handler 内实时读 ref.current，而不是在 effect 里缓存节点。
    // 工具栏存在条件渲染的兄弟节点（保存/AI 搜索入口等），其显隐会改变
    // details 在子数组中的位置，导致 React 重建该 DOM 节点；若闭包持有
    // 旧节点，hasAttribute("open") 永远为 false，外点关闭会静默失效。
    const getElement = () => ref.current;

    const onMouseDown = (event: MouseEvent) => {
      const element = getElement();
      if (!element || !element.hasAttribute("open")) return;
      if (event.target instanceof Node && element.contains(event.target)) {
        return;
      }
      element.removeAttribute("open");
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const element = getElement();
      if (!element || event.key !== "Escape" || !element.hasAttribute("open")) {
        return;
      }
      event.stopPropagation();
      element.removeAttribute("open");
    };

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return ref;
}
