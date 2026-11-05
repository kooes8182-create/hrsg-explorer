/** 색상은 src/index.css 의 CSS 변수(라이트/다크)를 그대로 씁니다. 화면 코드에는 색상 값을 직접 쓰지 않습니다. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),
        surface: v('surface'),
        sunken: v('sunken'),
        line: v('line'),
        ink: v('ink'),
        slate: v('slate'),
        soft: v('soft'),
        peach: v('peach'),
        pale: v('pale'),
        muted: v('muted'),
        faint: v('faint'),
        accent: { DEFAULT: v('accent'), ink: v('accent-ink'), soft: v('accent-soft') },
        caution: { DEFAULT: v('caution'), soft: v('caution-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
        info: { DEFAULT: v('info'), soft: v('info-soft') },
        good: { DEFAULT: v('good'), soft: v('good-soft') },
        s1: v('series-1'),
        s2: v('series-2'),
        s3: v('series-3'),
        grid: v('grid'),
        side: { DEFAULT: v('side'), ink: v('side-ink'), muted: v('side-muted'), hover: v('side-hover') },
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', '"Apple SD Gothic Neo"', '"Noto Sans KR"', '"Segoe UI"', 'sans-serif'],
        mono: ['"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      keyframes: {
        'toast-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'drawer-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'sheet-in': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        'page-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        flow: { to: { strokeDashoffset: '-20' } },
      },
      animation: { 'page-in': 'page-in .18s ease-out', flow: 'flow 1.2s linear infinite', 'toast-in': 'toast-in .18s ease-out', 'drawer-in': 'drawer-in .2s ease-out', 'sheet-in': 'sheet-in .22s ease-out' },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.04)',
        lift: '0 8px 24px -8px rgb(var(--shadow) / 0.12)',
        pop: '0 16px 40px -12px rgb(var(--shadow) / 0.25)',
      },
    },
  },
  plugins: [],
}
