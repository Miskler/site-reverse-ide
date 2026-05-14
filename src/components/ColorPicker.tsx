import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DEFAULT_NODE_COLORS } from '../shared/graph';

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface HSV {
  h: number;
  s: number;
  v: number;
}

const PRESET_COLORS = [
  ...DEFAULT_NODE_COLORS,
  '#324360',
  '#f2d3cf',
  '#5f2f8f',
  '#7fd3c8',
];

const FALLBACK_COLOR = DEFAULT_NODE_COLORS[0];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeHex(value: string): string | null {
  const raw = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const expanded = raw
      .split('')
      .map((char) => char + char)
      .join('');
    return `#${expanded.toLowerCase()}`;
  }

  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }

  return null;
}

function hexToRgb(hex: string): RGB {
  const normalized = normalizeHex(hex) ?? FALLBACK_COLOR;
  const raw = normalized.slice(1);

  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  return `#${[r, g, b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

function rgbToHsv({ r, g, b }: RGB): HSV {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
  }

  hue = Math.round(hue * 60);
  if (hue < 0) {
    hue += 360;
  }

  const saturation = max === 0 ? 0 : delta / max;

  return {
    h: hue,
    s: saturation,
    v: max,
  };
}

function hsvToRgb({ h, s, v }: HSV): RGB {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment >= 0 && segment < 1) {
    red = chroma;
    green = x;
  } else if (segment < 2) {
    red = x;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = x;
  } else if (segment < 4) {
    green = x;
    blue = chroma;
  } else if (segment < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const match = v - chroma;
  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  };
}

function hsvToHex(hsv: HSV): string {
  return rgbToHex(hsvToRgb(hsv));
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const safeValue = normalizeHex(value) ?? FALLBACK_COLOR;
  const [currentColor, setCurrentColor] = useState(safeValue);
  const hsv = useMemo(() => rgbToHsv(hexToRgb(currentColor)), [currentColor]);
  const hueColor = useMemo(() => hsvToHex({ h: hsv.h, s: 1, v: 1 }), [hsv.h]);
  const dragModeRef = useRef<'square' | 'hue' | null>(null);
  const squareRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  const hsvRef = useRef(hsv);

  useEffect(() => {
    setCurrentColor(safeValue);
  }, [safeValue]);

  useEffect(() => {
    hsvRef.current = hsv;
  }, [hsv]);

  const emitColor = (nextColor: string) => {
    setCurrentColor(nextColor);
    onChange(nextColor);
  };

  const updateFromSquare = (clientX: number, clientY: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    const saturation = clamp((clientX - rect.left) / rect.width, 0, 1);
    const brightness = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
    emitColor(hsvToHex({ h: hsvRef.current.h, s: saturation, v: brightness }));
  };

  const updateFromHue = (clientY: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    const ratio = clamp((clientY - rect.top) / rect.height, 0, 1);
    const hue = 360 - ratio * 360;
    const current = hsvRef.current;
    emitColor(hsvToHex({ h: hue, s: current.s, v: current.v }));
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (dragModeRef.current === 'square' && squareRef.current) {
        updateFromSquare(event.clientX, event.clientY, squareRef.current);
      } else if (dragModeRef.current === 'hue' && hueRef.current) {
        updateFromHue(event.clientY, hueRef.current);
      }
    };

    const clearDrag = () => {
      dragModeRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('pointercancel', clearDrag);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('pointercancel', clearDrag);
    };
  }, []);

  return (
    <div className="color-picker">
      <div className="color-picker__main">
        <div
          ref={squareRef}
          className="color-picker__square"
          style={{ backgroundColor: hueColor } as CSSProperties}
          onPointerDown={(event) => {
            event.preventDefault();
            dragModeRef.current = 'square';
            event.currentTarget.setPointerCapture(event.pointerId);
            updateFromSquare(event.clientX, event.clientY, event.currentTarget);
          }}
          onPointerMove={(event) => {
            if (dragModeRef.current !== 'square') {
              return;
            }
            updateFromSquare(event.clientX, event.clientY, event.currentTarget);
          }}
          onPointerUp={() => {
            dragModeRef.current = null;
          }}
          onPointerCancel={() => {
            dragModeRef.current = null;
          }}
        >
          <span className="color-picker__square-overlay color-picker__square-overlay--white" />
          <span className="color-picker__square-overlay color-picker__square-overlay--black" />
          <span
            className="color-picker__cursor"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              backgroundColor: safeValue,
            }}
          />
        </div>

        <div
          ref={hueRef}
          className="color-picker__hue"
          onPointerDown={(event) => {
            event.preventDefault();
            dragModeRef.current = 'hue';
            event.currentTarget.setPointerCapture(event.pointerId);
            updateFromHue(event.clientY, event.currentTarget);
          }}
          onPointerMove={(event) => {
            if (dragModeRef.current === 'hue') {
              updateFromHue(event.clientY, event.currentTarget);
            }
          }}
          onPointerUp={() => {
            dragModeRef.current = null;
          }}
          onPointerCancel={() => {
            dragModeRef.current = null;
          }}
          onWheel={(event) => {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -5 : 5;
            onChange(hsvToHex({ h: hsv.h + delta, s: hsv.s, v: hsv.v }));
          }}
        >
          <span className="color-picker__hue-track" />
          <span className="color-picker__hue-thumb" style={{ top: `${100 - (hsv.h / 360) * 100}%` }} />
        </div>
      </div>

      <div className="color-picker__footer">
        <div className="color-picker__preview" style={{ backgroundColor: safeValue }} />
        <div className="color-picker__readout">
          <span>HEX</span>
          <strong>{safeValue.toUpperCase()}</strong>
        </div>
      </div>

      <div className="color-picker__swatches" aria-label="Быстрые цвета">
        {PRESET_COLORS.map((presetColor) => (
          <button
            key={presetColor}
            type="button"
            className={`color-picker__swatch${presetColor === safeValue ? ' is-active' : ''}`}
            style={{ backgroundColor: presetColor }}
            aria-label={`Выбрать цвет ${presetColor.toUpperCase()}`}
            onClick={() => onChange(presetColor)}
          />
        ))}
      </div>
    </div>
  );
}
