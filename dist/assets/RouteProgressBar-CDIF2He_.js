import{aW as s,aX as a,j as e}from"./index-BownPAjB.js";const n=400;function r(){const t=s(),o=a(t,n);return e.jsxs("div",{"aria-hidden":!0,className:`pointer-events-none fixed inset-x-0 top-0 z-[9998] h-[3px] overflow-hidden bg-ocean-500/15 transition-opacity duration-300 ${o?"opacity-100":"opacity-0"}`,children:[e.jsx("div",{className:"bp-route-sweep h-full w-[45%] rounded-full bg-gradient-to-r from-ocean-400 via-ocean-500 to-ocean-300"}),e.jsx("style",{children:`
        @keyframes bp-route-sweep {
          0%   { transform: translateX(-110%); }
          100% { transform: translateX(240%); }
        }
        .bp-route-sweep { animation: bp-route-sweep 1.15s ease-in-out infinite; }
        /* Reduced motion: a static filled track still conveys "working". */
        @media (prefers-reduced-motion: reduce) {
          .bp-route-sweep { animation: none; width: 100%; opacity: 0.5; }
        }
      `})]})}export{r as R};
