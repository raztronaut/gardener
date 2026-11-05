// Canonical semantic roles. Legacy aliases bridge existing widget CSS.
export const TOKEN_CONTRACT = Object.freeze({
  "--color-accent-ring": {
    "group": "colors",
    "description": "color accent ring",
    "aliases": [
      "--accent-ring"
    ],
    "cssProperty": "color"
  },
  "--color-accent-wash": {
    "group": "colors",
    "description": "color accent wash",
    "aliases": [
      "--accent-wash"
    ],
    "cssProperty": "color"
  },
  "--color-canvas": {
    "group": "colors",
    "description": "color canvas",
    "aliases": [
      "--bg-0"
    ],
    "cssProperty": "color"
  },
  "--color-canvas-raised": {
    "group": "colors",
    "description": "color canvas raised",
    "aliases": [
      "--bg-1"
    ],
    "cssProperty": "color"
  },
  "--color-button-fill": {
    "group": "colors",
    "description": "color button fill",
    "aliases": [
      "--button-fill"
    ],
    "cssProperty": "color"
  },
  "--color-button-hover": {
    "group": "colors",
    "description": "color button hover",
    "aliases": [
      "--button-hover"
    ],
    "cssProperty": "color"
  },
  "--color-button-text": {
    "group": "colors",
    "description": "color button text",
    "aliases": [
      "--button-ink"
    ],
    "cssProperty": "color"
  },
  "--space-button-padding": {
    "group": "spacing",
    "description": "space button padding",
    "aliases": [
      "--button-padding"
    ],
    "cssProperty": "padding"
  },
  "--radius-button": {
    "group": "shape",
    "description": "radius button",
    "aliases": [
      "--button-radius"
    ],
    "cssProperty": "border-radius"
  },
  "--cursor-default": {
    "group": "cursor",
    "description": "cursor default",
    "aliases": [
      "--c-arrow"
    ],
    "cssProperty": "cursor"
  },
  "--cursor-pointer": {
    "group": "cursor",
    "description": "cursor pointer",
    "aliases": [
      "--c-hand"
    ],
    "cssProperty": "cursor"
  },
  "--cursor-text": {
    "group": "cursor",
    "description": "cursor text",
    "aliases": [
      "--c-text"
    ],
    "cssProperty": "cursor"
  },
  "--color-choice-description": {
    "group": "colors",
    "description": "color choice description",
    "aliases": [
      "--choice-description"
    ],
    "cssProperty": "color"
  },
  "--color-choice-fill": {
    "group": "colors",
    "description": "color choice fill",
    "aliases": [
      "--choice-fill"
    ],
    "cssProperty": "color"
  },
  "--color-choice-text": {
    "group": "colors",
    "description": "color choice text",
    "aliases": [
      "--choice-ink"
    ],
    "cssProperty": "color"
  },
  "--radius-choice": {
    "group": "shape",
    "description": "radius choice",
    "aliases": [
      "--choice-radius"
    ],
    "cssProperty": "border-radius"
  },
  "--color-choice-selected": {
    "group": "colors",
    "description": "color choice selected",
    "aliases": [
      "--choice-selected"
    ],
    "cssProperty": "color"
  },
  "--font-body": {
    "group": "typography",
    "description": "font body",
    "aliases": [
      "--font"
    ],
    "cssProperty": "font-family"
  },
  "--font-heading": {
    "group": "typography",
    "description": "Headlines and large numbers; separate from body copy.",
    "aliases": [
      "--font-display"
    ],
    "cssProperty": "font-family"
  },
  "--font-code": {
    "group": "typography",
    "description": "font code",
    "aliases": [
      "--font-mono"
    ],
    "cssProperty": "font-family"
  },
  "--space-grid-gap": {
    "group": "spacing",
    "description": "Space between wall cards.",
    "aliases": [
      "--gap"
    ],
    "cssProperty": "padding"
  },
  "--surface-glass": {
    "group": "materials",
    "description": "surface glass",
    "aliases": [
      "--glass"
    ],
    "cssProperty": "background"
  },
  "--surface-glass-raised": {
    "group": "materials",
    "description": "surface glass raised",
    "aliases": [
      "--glass-2"
    ],
    "cssProperty": "background"
  },
  "--glass-base": {
    "group": "materials",
    "description": "glass base",
    "aliases": [],
    "cssProperty": "background"
  },
  "--glass-drop": {
    "group": "materials",
    "description": "glass drop",
    "aliases": [],
    "cssProperty": "box-shadow"
  },
  "--glass-edge": {
    "group": "materials",
    "description": "glass edge",
    "aliases": [],
    "cssProperty": "box-shadow"
  },
  "--glass-fill": {
    "group": "materials",
    "description": "glass fill",
    "aliases": [],
    "cssProperty": "background"
  },
  "--glass-rim": {
    "group": "materials",
    "description": "glass rim",
    "aliases": [],
    "cssProperty": "color"
  },
  "--glass-tint": {
    "group": "materials",
    "description": "glass tint",
    "aliases": [],
    "cssProperty": "background"
  },
  "--color-warning": {
    "group": "colors",
    "description": "Semantic attention/permission state; preserve meaning.",
    "aliases": [
      "--gold"
    ],
    "cssProperty": "color"
  },
  "--color-text-primary": {
    "group": "colors",
    "description": "color text primary",
    "aliases": [
      "--ink"
    ],
    "cssProperty": "color"
  },
  "--color-text-muted": {
    "group": "colors",
    "description": "Readable secondary descriptions and fine labels.",
    "aliases": [
      "--ink-faint"
    ],
    "cssProperty": "color"
  },
  "--color-text-secondary": {
    "group": "colors",
    "description": "color text secondary",
    "aliases": [
      "--ink-soft"
    ],
    "cssProperty": "color"
  },
  "--color-accent": {
    "group": "colors",
    "description": "Primary interactive accent; independent of success/status colors.",
    "aliases": [
      "--mint"
    ],
    "cssProperty": "color"
  },
  "--color-accent-secondary": {
    "group": "colors",
    "description": "color accent secondary",
    "aliases": [
      "--mint-2"
    ],
    "cssProperty": "color"
  },
  "--color-overlay-description": {
    "group": "colors",
    "description": "color overlay description",
    "aliases": [
      "--overlay-description"
    ],
    "cssProperty": "color"
  },
  "--color-overlay-text": {
    "group": "colors",
    "description": "color overlay text",
    "aliases": [
      "--overlay-ink"
    ],
    "cssProperty": "color"
  },
  "--radius-overlay": {
    "group": "shape",
    "description": "radius overlay",
    "aliases": [
      "--overlay-radius"
    ],
    "cssProperty": "border-radius"
  },
  "--space-card-padding": {
    "group": "spacing",
    "description": "space card padding",
    "aliases": [
      "--pad"
    ],
    "cssProperty": "padding"
  },
  "--radius-card": {
    "group": "shape",
    "description": "Shared wall-card corner radius.",
    "aliases": [
      "--radius"
    ],
    "cssProperty": "border-radius"
  },
  "--color-error": {
    "group": "colors",
    "description": "Semantic error state; preserve meaning.",
    "aliases": [
      "--rose"
    ],
    "cssProperty": "color"
  },
  "--shadow-overlay": {
    "group": "materials",
    "description": "shadow overlay",
    "aliases": [
      "--shadow"
    ],
    "cssProperty": "box-shadow"
  },
  "--space-shell-padding": {
    "group": "spacing",
    "description": "space shell padding",
    "aliases": [
      "--shell-padding"
    ],
    "cssProperty": "padding"
  },
  "--border-subtle": {
    "group": "materials",
    "description": "border subtle",
    "aliases": [
      "--stroke"
    ],
    "cssProperty": "color"
  },
  "--border-strong": {
    "group": "materials",
    "description": "border strong",
    "aliases": [
      "--stroke-strong"
    ],
    "cssProperty": "color"
  },
  "--surface-hover": {
    "group": "materials",
    "description": "surface hover",
    "aliases": [],
    "cssProperty": "background"
  },
  "--surface-overlay": {
    "group": "materials",
    "description": "Opaque menu, caption, and floating-card surface.",
    "aliases": [],
    "cssProperty": "background"
  },
  "--surface-raised": {
    "group": "materials",
    "description": "surface raised",
    "aliases": [],
    "cssProperty": "background"
  },
  "--surface-selected": {
    "group": "materials",
    "description": "surface selected",
    "aliases": [],
    "cssProperty": "background"
  },
  "--text-body": {
    "group": "typography",
    "description": "text body",
    "aliases": [],
    "cssProperty": "font-size"
  },
  "--text-description": {
    "group": "typography",
    "description": "text description",
    "aliases": [],
    "cssProperty": "font-size"
  },
  "--text-heading": {
    "group": "typography",
    "description": "text heading",
    "aliases": [],
    "cssProperty": "font-size"
  },
  "--text-label": {
    "group": "typography",
    "description": "text label",
    "aliases": [],
    "cssProperty": "font-size"
  },
  "--color-voice-1": {
    "group": "colors",
    "description": "Optional voice glow palette stop 1; absent preserves the original shader palette.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-voice-2": {
    "group": "colors",
    "description": "Optional voice glow palette stop 2; absent preserves the original shader palette.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-voice-3": {
    "group": "colors",
    "description": "Optional voice glow palette stop 3; absent preserves the original shader palette.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-voice-4": {
    "group": "colors",
    "description": "Optional voice glow palette stop 4; absent preserves the original shader palette.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-voice-5": {
    "group": "colors",
    "description": "Optional voice glow palette stop 5; absent preserves the original shader palette.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-voice-success": {
    "group": "colors",
    "description": "Optional successful voice reply tint; preserve success meaning.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-voice-error": {
    "group": "colors",
    "description": "Optional failed voice reply tint; preserve error meaning.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-touch-target": {
    "group": "colors",
    "description": "Optional touch calibration outline color.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-touch-tip": {
    "group": "colors",
    "description": "Optional touch calibration tip color.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-map-canvas": {
    "group": "colors",
    "description": "Optional map loading/background color.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--color-map-credit": {
    "group": "colors",
    "description": "Optional map attribution text color; preserve legibility.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--surface-canvas-aura": {
    "group": "materials",
    "description": "Static canvas background composition.",
    "aliases": [],
    "cssProperty": "background"
  },
  "--color-dialog-veil": {
    "group": "colors",
    "description": "Dimmed backdrop behind a dialog; separate from dialog surface.",
    "aliases": [],
    "cssProperty": "color"
  },
  "--shadow-drag-ghost": {
    "group": "materials",
    "description": "Depth of a dragged card preview.",
    "aliases": [],
    "cssProperty": "box-shadow"
  }
});
export const TOKEN_GROUPS = Object.freeze(["palette", "colors", "typography", "spacing", "shape", "materials", "cursor", "overrides"]);
