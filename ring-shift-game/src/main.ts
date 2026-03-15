type Point = { x: number; y: number };

type CircleRotateTransform = {
  kind: "circleRotate";
  label: string;
  description: string;
  baseStep: number;
  center: Point;
  radius: number;
};

type RectShiftTransform = {
  kind: "rectShift";
  label: string;
  description: string;
  baseStep: number;
  rect: { x: number; y: number; w: number; h: number };
  axis: "x" | "y";
};

type HueOrbitTransform = {
  kind: "hueOrbit";
  label: string;
  description: string;
  baseStep: number;
  center: Point;
  radius: number;
};

type TransformConfig =
  | CircleRotateTransform
  | RectShiftTransform
  | HueOrbitTransform;

const IMAGE_SIZE = 512;
const STEP_COUNT = 10;
const sourceCanvas = document.getElementById("source-canvas") as HTMLCanvasElement;
const outputCanvas = document.getElementById("output-canvas") as HTMLCanvasElement;
const sourceCtx = sourceCanvas.getContext("2d")!;
const outputCtx = outputCanvas.getContext("2d")!;
const dialList = document.getElementById("dial-list")!;
const legend = document.getElementById("legend")!;
const statusBox = document.getElementById("status")!;
const dialShell = document.getElementById("dial-shell")!;

let dialValues: number[] = [];
let selectedDial = 0;
let originalImageData: ImageData | null = null;
let transforms: TransformConfig[] = [];
let levelSize = 3;

function wrapStep(value: number): number {
  return ((value % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
}

function wrapIndex(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function wrapCoord(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function idx(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choose<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function copyImageData(data: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
}

function sampleNearest(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): [number, number, number, number] {
  const sx = clamp(Math.round(x), 0, width - 1);
  const sy = clamp(Math.round(y), 0, height - 1);
  const offset = idx(width, sx, sy);
  return [
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  ];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === nr) {
      h = ((ng - nb) / delta) % 6;
    } else if (max === ng) {
      h = (nb - nr) / delta + 2;
    } else {
      h = (nr - ng) / delta + 4;
    }
    h /= 6;
    if (h < 0) {
      h += 1;
    }
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const mod = i % 6;

  let r = 0;
  let g = 0;
  let b = 0;

  if (mod === 0) [r, g, b] = [v, t, p];
  if (mod === 1) [r, g, b] = [q, v, p];
  if (mod === 2) [r, g, b] = [p, v, t];
  if (mod === 3) [r, g, b] = [p, q, v];
  if (mod === 4) [r, g, b] = [t, p, v];
  if (mod === 5) [r, g, b] = [v, p, q];

  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
  ];
}

function makeCircleRotate(index: number): CircleRotateTransform {
  return {
    kind: "circleRotate",
    label: `${index + 1}  Circle Twist`,
    description: "Rotates pixels inside a circle. Full turn wraps cleanly to the original image.",
    baseStep: randomInt(1, 9),
    center: {
      x: randomInt(120, 392),
      y: randomInt(120, 392),
    },
    radius: randomInt(88, 150),
  };
}

function makeRectShift(index: number): RectShiftTransform {
  return {
    kind: "rectShift",
    label: `${index + 1}  ${choose(["Ribbon Drift", "Panel Drift", "Strip Drift"])}`,
    description: "Shifts pixels inside one rectangle with wrap-around.",
    baseStep: randomInt(1, 9),
    rect: {
      x: randomInt(50, 210),
      y: randomInt(50, 210),
      w: randomInt(120, 260),
      h: randomInt(120, 260),
    },
    axis: Math.random() < 0.5 ? "x" : "y",
  };
}

function makeHueOrbit(index: number): HueOrbitTransform {
  return {
    kind: "hueOrbit",
    label: `${index + 1}  Prism Orbit`,
    description: "Cycles hue inside a circle. A full hue loop returns to the same colors.",
    baseStep: randomInt(1, 9),
    center: {
      x: randomInt(110, 402),
      y: randomInt(110, 402),
    },
    radius: randomInt(80, 170),
  };
}

function createTransforms(count: number): TransformConfig[] {
  const factories = [makeCircleRotate, makeRectShift, makeHueOrbit];
  return Array.from({ length: count }, (_, index) => choose(factories)(index));
}

function effectiveStep(index: number): number {
  return wrapStep(transforms[index].baseStep + dialValues[index]);
}

function isSolved(): boolean {
  return transforms.every((_, index) => effectiveStep(index) === 0);
}

function renderHud(): void {
  dialList.innerHTML = transforms
    .map((transform, index) => {
      const selectedClass = index === selectedDial ? " selected" : "";
      return `
        <div class="dial-row${selectedClass}" data-dial-index="${index}">
          <div class="dial-top">
            <div class="dial-name">${transform.label}</div>
            <div class="dial-value">${dialValues[index]}</div>
          </div>
          <div class="dial-desc">adds ${(dialValues[index] * 10) % 100}% with wrap-around</div>
        </div>
      `;
    })
    .join("");

  legend.innerHTML = transforms
    .map((transform) => {
      return `
        <div class="legend-card">
          <strong>${transform.label}</strong>
          <span>${transform.description}</span>
        </div>
      `;
    })
    .join("");

  if (isSolved()) {
    statusBox.classList.add("solved");
    statusBox.innerHTML = `
      <strong>Restored</strong>
      All ${transforms.length} effective transforms are back at 0%. The transformed panel now matches the reference image.
    `;
  } else {
    statusBox.classList.remove("solved");
    statusBox.innerHTML = `
      <strong>Controls</strong>
      Up/Down selects. Left/Right changes the digit. Press 1 to 9 for a new level size.
    `;
  }

  const selectedRow = dialList.querySelector<HTMLElement>(`[data-dial-index="${selectedDial}"]`);
  selectedRow?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function applyCircleRotate(source: ImageData, transform: CircleRotateTransform, step: number): ImageData {
  const output = copyImageData(source);
  if (step === 0) {
    return output;
  }

  const angle = (Math.PI * 2 * step) / STEP_COUNT;
  const sin = Math.sin(-angle);
  const cos = Math.cos(-angle);
  const radiusSq = transform.radius * transform.radius;
  const minX = Math.max(0, Math.floor(transform.center.x - transform.radius));
  const maxX = Math.min(source.width - 1, Math.ceil(transform.center.x + transform.radius));
  const minY = Math.max(0, Math.floor(transform.center.y - transform.radius));
  const maxY = Math.min(source.height - 1, Math.ceil(transform.center.y + transform.radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - transform.center.x;
      const dy = y - transform.center.y;
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }
      const srcX = transform.center.x + dx * cos - dy * sin;
      const srcY = transform.center.y + dx * sin + dy * cos;
      const [r, g, b, a] = sampleNearest(source.data, source.width, source.height, srcX, srcY);
      const offset = idx(source.width, x, y);
      output.data[offset] = r;
      output.data[offset + 1] = g;
      output.data[offset + 2] = b;
      output.data[offset + 3] = a;
    }
  }

  return output;
}

function applyRectShift(source: ImageData, transform: RectShiftTransform, step: number): ImageData {
  const output = copyImageData(source);
  if (step === 0) {
    return output;
  }

  const shiftAmount = transform.axis === "x"
    ? Math.round((transform.rect.w * step) / STEP_COUNT)
    : Math.round((transform.rect.h * step) / STEP_COUNT);

  for (let localY = 0; localY < transform.rect.h; localY += 1) {
    for (let localX = 0; localX < transform.rect.w; localX += 1) {
      const srcLocalX = transform.axis === "x"
        ? wrapCoord(localX - shiftAmount, transform.rect.w)
        : localX;
      const srcLocalY = transform.axis === "y"
        ? wrapCoord(localY - shiftAmount, transform.rect.h)
        : localY;

      const srcX = transform.rect.x + srcLocalX;
      const srcY = transform.rect.y + srcLocalY;
      const destX = transform.rect.x + localX;
      const destY = transform.rect.y + localY;
      const sourceOffset = idx(source.width, srcX, srcY);
      const destOffset = idx(output.width, destX, destY);

      output.data[destOffset] = source.data[sourceOffset];
      output.data[destOffset + 1] = source.data[sourceOffset + 1];
      output.data[destOffset + 2] = source.data[sourceOffset + 2];
      output.data[destOffset + 3] = source.data[sourceOffset + 3];
    }
  }

  return output;
}

function applyHueOrbit(source: ImageData, transform: HueOrbitTransform, step: number): ImageData {
  const output = copyImageData(source);
  if (step === 0) {
    return output;
  }

  const radiusSq = transform.radius * transform.radius;
  const hueDelta = step / STEP_COUNT;
  const minX = Math.max(0, Math.floor(transform.center.x - transform.radius));
  const maxX = Math.min(source.width - 1, Math.ceil(transform.center.x + transform.radius));
  const minY = Math.max(0, Math.floor(transform.center.y - transform.radius));
  const maxY = Math.min(source.height - 1, Math.ceil(transform.center.y + transform.radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - transform.center.x;
      const dy = y - transform.center.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > radiusSq) {
        continue;
      }

      const offset = idx(source.width, x, y);
      const alpha = source.data[offset + 3];
      if (alpha === 0) {
        continue;
      }

      const [h, s, v] = rgbToHsv(
        source.data[offset],
        source.data[offset + 1],
        source.data[offset + 2]
      );
      const radiusNorm = 1 - Math.sqrt(distanceSq) / transform.radius;
      const shiftedHue = (h + hueDelta * (0.45 + radiusNorm * 0.55)) % 1;
      const boostedS = clamp(s * (1.02 + radiusNorm * 0.12), 0, 1);
      const [r, g, b] = hsvToRgb(shiftedHue, boostedS, v);
      output.data[offset] = r;
      output.data[offset + 1] = g;
      output.data[offset + 2] = b;
      output.data[offset + 3] = alpha;
    }
  }

  return output;
}

function applyTransform(source: ImageData, transform: TransformConfig, step: number): ImageData {
  if (transform.kind === "circleRotate") {
    return applyCircleRotate(source, transform, step);
  }
  if (transform.kind === "rectShift") {
    return applyRectShift(source, transform, step);
  }
  return applyHueOrbit(source, transform, step);
}

function render(): void {
  if (!originalImageData) {
    return;
  }

  let working = copyImageData(originalImageData);
  transforms.forEach((transform, index) => {
    working = applyTransform(working, transform, effectiveStep(index));
  });

  outputCtx.putImageData(working, 0, 0);
  renderHud();
}

function handleKeydown(event: KeyboardEvent): void {
  if (/^[1-9]$/.test(event.key)) {
    event.preventDefault();
    startNewLevel(Number(event.key));
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    selectedDial = wrapIndex(selectedDial - 1, transforms.length);
    renderHud();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectedDial = wrapIndex(selectedDial + 1, transforms.length);
    renderHud();
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    dialValues[selectedDial] = wrapStep(dialValues[selectedDial] - 1);
    render();
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    dialValues[selectedDial] = wrapStep(dialValues[selectedDial] + 1);
    render();
  }
}

function startNewLevel(count: number): void {
  levelSize = clamp(count, 1, 9);
  transforms = createTransforms(levelSize);
  dialValues = Array.from({ length: levelSize }, () => 0);
  selectedDial = 0;
  render();
}

async function loadImage(): Promise<void> {
  const imageUrl = new URL("./rainbow_rings.png", import.meta.url).href;
  const image = new Image();
  image.decoding = "async";
  image.src = imageUrl;

  await image.decode();
  sourceCtx.clearRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  sourceCtx.drawImage(image, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
  originalImageData = sourceCtx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  outputCtx.imageSmoothingEnabled = true;
  sourceCtx.imageSmoothingEnabled = true;
}

async function init(): Promise<void> {
  await loadImage();
  startNewLevel(levelSize);
  window.addEventListener("keydown", handleKeydown);
  dialShell.scrollTop = 0;
}

init().catch((error) => {
  console.error(error);
  statusBox.classList.remove("solved");
  statusBox.innerHTML = `
    <strong>Load error</strong>
    The generated source image could not be loaded. Regenerate <code>src/rainbow_rings.png</code> and reload.
  `;
});
