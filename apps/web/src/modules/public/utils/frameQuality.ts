export type FrameQualityResult = {
  score: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  motion: number;
  isGood: boolean;
  hint: string;
  level: "good" | "warn" | "bad";
  lumaBuffer: Uint8Array;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function analyzeFrameQuality(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  previousLuma: Uint8Array | null
): FrameQualityResult {
  const totalPixels = width * height;
  const lumaBuffer = new Uint8Array(totalPixels);

  let sum = 0;
  let index = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const luma = Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
    lumaBuffer[index] = luma;
    sum += luma;
    index += 1;
  }

  const brightness = sum / totalPixels;

  let varianceSum = 0;
  let edgeSum = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const value = lumaBuffer[i];
      const delta = value - brightness;
      varianceSum += delta * delta;

      if (x > 0) {
        edgeSum += Math.abs(value - lumaBuffer[i - 1]);
      }
      if (y > 0) {
        edgeSum += Math.abs(value - lumaBuffer[i - width]);
      }
    }
  }

  const contrast = Math.sqrt(varianceSum / totalPixels);
  const sharpness = edgeSum / totalPixels;

  let motion = 0;
  if (previousLuma && previousLuma.length === lumaBuffer.length) {
    let motionSum = 0;
    for (let i = 0; i < lumaBuffer.length; i += 1) {
      motionSum += Math.abs(lumaBuffer[i] - previousLuma[i]);
    }
    motion = motionSum / lumaBuffer.length;
  }

  const brightnessScore = 100 - Math.min(100, Math.abs(brightness - 145) * 0.9);
  const contrastScore = clamp((contrast / 32) * 100, 0, 100);
  const sharpnessScore = clamp((sharpness / 20) * 100, 0, 100);
  const motionPenalty = clamp((motion / 35) * 100, 0, 100);

  const score = clamp(
    brightnessScore * 0.25 + contrastScore * 0.3 + sharpnessScore * 0.45 - motionPenalty * 0.3,
    0,
    100
  );

  let isGood = true;
  let hint = "Calidad correcta, leyendo...";
  let level: "good" | "warn" | "bad" = "good";

  if (brightness < 58) {
    isGood = false;
    hint = "Necesitas mas luz";
    level = "bad";
  } else if (brightness > 232) {
    isGood = false;
    hint = "Reduce reflejos de luz";
    level = "bad";
  } else if (motion > 30) {
    isGood = false;
    hint = "Manten el telefono mas quieto";
    level = "warn";
  } else if (contrast < 16 || sharpness < 8) {
    isGood = false;
    hint = "Acerca y enfoca mejor el serial";
    level = "warn";
  } else if (score < 56) {
    isGood = false;
    hint = "Ajusta el encuadre del serial";
    level = "warn";
  }

  return {
    score: Math.round(score),
    brightness: Math.round(brightness),
    contrast: Number(contrast.toFixed(1)),
    sharpness: Number(sharpness.toFixed(1)),
    motion: Number(motion.toFixed(1)),
    isGood,
    hint,
    level,
    lumaBuffer
  };
}
