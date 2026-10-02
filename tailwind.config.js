/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['"Sora"', 'system-ui', 'sans-serif'],
      },
      colors: {
        ocean: {
          50: '#eefbfd',
          100: '#d4f3f9',
          200: '#aee7f3',
          300: '#76d4ea',
          400: '#37b8d9',
          500: '#1b9bbf',
          600: '#197da1',
          700: '#1b6583',
          800: '#1f536c',
          900: '#1e465c',
          950: '#0a2540',
        },
        deep: {
          800: '#0d2b4b',
          900: '#081e38',
          950: '#04142a',
        },
        sand: '#f6f8fb',
      },
      boxShadow: {
        soft: '0 6px 24px -8px rgba(8, 30, 56, 0.12)',
        lift: '0 16px 40px -12px rgba(8, 30, 56, 0.22)',
        glow: '0 0 24px rgba(55, 184, 217, 0.35)',
      },
      animation: {
        'fade-up': 'fadeUp .6s ease both',
        float: 'float 6s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
        wave: 'wave 10s linear infinite',
        ripple: 'ripple 2.2s ease-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '.55' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-500px 0' },
          '100%': { backgroundPosition: '500px 0' },
        },
        wave: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        ripple: {
          '0%': { transform: 'scale(1)', opacity: '.6' },
          '100%': { transform: 'scale(2.6)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
