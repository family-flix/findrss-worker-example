// Geometry from public/brand/logo.svg. Keep paths and timing in sync with public/brand/loading.svg.
export const loading_art = {
  "tag": "svg",
  "attrs": {
    "viewBox": "0 0 1024 1024",
    "data-n": "findrss-loading-art",
    "aria-hidden": "true",
    "focusable": "false"
  },
  "children": [
    {
      "tag": "path",
      "attrs": {
        "fill": "var(--frui-brand-blue, #2563EB)",
        "d": "M512 100c172 0 258 0 321 31 27 13 47 33 60 60 31 63 31 149 31 321s0 258-31 321c-13 27-33 47-60 60-63 31-149 31-321 31s-258 0-321-31c-27-13-47-33-60-60-31-63-31-149-31-321s0-258 31-321c13-27 33-47 60-60 63-31 149-31 321-31Z"
      }
    },
    {
      "tag": "g",
      "attrs": {
        "fill": "var(--frui-brand-white, #FFFFFF)",
        "transform": "translate(138.88 151.91) scale(1.5) rotate(4 256 256)"
      },
      "children": [
        {
          "tag": "path",
          "attrs": {
            "d": "M116 365 L116 148 C116 108 138 88 177 88 L318 88 C340 88 354 101 354 122 C354 143 340 156 318 156 L224 156 C202 156 184 174 184 196 L184 365 C184 389 171 403 150 403 C129 403 116 389 116 365 Z"
          }
        },
        {
          "tag": "path",
          "attrs": {
            "class": "animation-findrss-signal-1-8s-ease-in-out-infinite media-prefers-reduced-motion-reduce-animation-none",
            "data-n": "findrss-loading-signal",
            "transform": "translate(22 0)",
            "d": "M229 191 C321 191 396 266 396 358 C396 378 384 390 365 390 C346 390 334 378 334 358 C334 300 287 253 229 253 C209 253 197 241 197 222 C197 203 209 191 229 191 Z"
          }
        },
        {
          "tag": "circle",
          "attrs": {
            "class": "animation-findrss-dot-1-8s-ease-in-out-infinite media-prefers-reduced-motion-reduce-animation-none",
            "data-n": "findrss-loading-dot",
            "cx": "270",
            "cy": "350",
            "r": "46"
          }
        }
      ]
    }
  ]
};
