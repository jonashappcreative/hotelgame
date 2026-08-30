import '@testing-library/jest-dom';

// jsdom implements no ResizeObserver, and recharts' ResponsiveContainer calls
// it on mount — without this, any component containing a chart throws before it
// renders. An environment gap, not a component concern, so it is stubbed here
// rather than mocked away per test file.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
