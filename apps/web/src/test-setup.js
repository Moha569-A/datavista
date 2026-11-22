import '@testing-library/jest-dom/vitest';

/**
 * jsdom has no layout engine, so Recharts' ResponsiveContainer measures 0×0
 * and renders no SVG. These stubs give every element a real, stable box and a
 * ResizeObserver that reports it immediately.
 */
class ResizeObserverStub {
  constructor(callback) {
    this.callback = callback;
  }
  observe(target) {
    this.callback(
      [{ target, contentRect: target.getBoundingClientRect() }],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
}

const RECT = { width: 800, height: 320, top: 0, left: 0, bottom: 320, right: 800, x: 0, y: 0 };

global.ResizeObserver = ResizeObserverStub;
HTMLElement.prototype.getBoundingClientRect = function getRect() {
  return { ...RECT, toJSON: () => RECT };
};
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 320 });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 320 });
