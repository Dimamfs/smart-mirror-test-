export const CAMERA_POSITION_OPTIONS = [
  { value: 'top', label: 'Top (center)' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' }
];

export const CAMERA_POSITION_ROTATIONS = {
  top: 0,
  right: 90,
  bottom: 180,
  left: -90
};

export const CAMERA_ORIENTATION_ROTATIONS = {
  landscape: 0,
  landscape_flipped: 180,
  portrait: 90,
  portrait_flipped: -90
};

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

const clampExposure = (value, min = 0.2, max = 3, fallback = 1) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.min(Math.max(numeric, min), max);
  }
  return fallback;
};

const clampConfidence = (value, fallback = 0.5) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.min(Math.max(numeric, 0.1), 0.99);
  }
  return fallback;
};

const QUALITY_PRESETS = {
  low: {
    maxWidth: 320,
    maxHeight: 240,
    cameraWidth: 320,
    cameraHeight: 240,
    modelComplexity: 0,
    maxFrameRate: 15
  },
  medium: {
    maxWidth: 480,
    maxHeight: 360,
    cameraWidth: 480,
    cameraHeight: 360,
    modelComplexity: 0,
    maxFrameRate: 20
  },
  full: {
    maxWidth: null,
    maxHeight: null,
    cameraWidth: 640,
    cameraHeight: 480,
    modelComplexity: 1,
    maxFrameRate: 30
  }
};

const getQualityPreset = (settings = {}) => {
  const quality = settings.preprocessingQuality || 'medium';
  return QUALITY_PRESETS[quality] || QUALITY_PRESETS.medium;
};

const getTargetDimensions = (videoElement, preset) => {
  const videoWidth = videoElement.videoWidth;
  const videoHeight = videoElement.videoHeight;

  if (!videoWidth || !videoHeight) {
    return { width: videoWidth, height: videoHeight };
  }

  const { maxWidth, maxHeight } = preset;

  if (!maxWidth || !maxHeight) {
    return { width: videoWidth, height: videoHeight };
  }

  const widthScale = Math.min(1, maxWidth / videoWidth);
  const heightScale = Math.min(1, maxHeight / videoHeight);
  const scale = Math.min(widthScale, heightScale);

  if (scale >= 0.999) {
    return { width: videoWidth, height: videoHeight };
  }

  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale))
  };
};

export const getHandTrackingRuntimeConfig = (settings = {}) => {
  const preset = getQualityPreset(settings);
  return {
    options: {
      maxNumHands: 2,
      modelComplexity: preset.modelComplexity,
      minDetectionConfidence: clampConfidence(settings.minDetectionConfidence, 0.5),
      minTrackingConfidence: clampConfidence(settings.minTrackingConfidence, 0.5)
    },
    camera: {
      width: preset.cameraWidth,
      height: preset.cameraHeight
    },
    processing: {
      maxWidth: preset.maxWidth,
      maxHeight: preset.maxHeight
    },
    maxFrameRate: preset.maxFrameRate
  };
};

const rotateNormalizedPoint = (x, y, rotation) => {
  if (!rotation) {
    return {
      x: clamp(x),
      y: clamp(y)
    };
  }

  const angle = (rotation * Math.PI) / 180;
  const centeredX = x - 0.5;
  const centeredY = y - 0.5;

  const rotatedX = centeredX * Math.cos(angle) - centeredY * Math.sin(angle);
  const rotatedY = centeredX * Math.sin(angle) + centeredY * Math.cos(angle);

  return {
    x: clamp(rotatedX + 0.5),
    y: clamp(rotatedY + 0.5)
  };
};

export const applyCameraPositionTransform = (x, y, cameraPosition = 'top') => {
  const mirroredX = 1 - x;
  const mirroredY = y;
  const rotation = CAMERA_POSITION_ROTATIONS[cameraPosition] ?? 0;

  return rotateNormalizedPoint(mirroredX, mirroredY, rotation);
};

export const transformHandCoordinates = (
  x,
  y,
  orientation = 'landscape',
  cameraPosition = 'top'
) => {
  const rotation = CAMERA_ORIENTATION_ROTATIONS[orientation] ?? 0;

  if (rotation === 0) {
    return applyCameraPositionTransform(x, y, cameraPosition);
  }

  const angle = (rotation * Math.PI) / 180;
  const centeredX = x - 0.5;
  const centeredY = y - 0.5;

  const xStd = centeredX;
  const yStd = -centeredY;

  const rotatedXStd = xStd * Math.cos(angle) - yStd * Math.sin(angle);
  const rotatedYStd = xStd * Math.sin(angle) + yStd * Math.cos(angle);

  const rotatedX = rotatedXStd + 0.5;
  const rotatedY = -rotatedYStd + 0.5;

  return applyCameraPositionTransform(rotatedX, rotatedY, cameraPosition);
};

export const getExposureSettings = (settings = {}) => {
  return {
    brightness: clampExposure(settings.brightness, 0.2, 5, 1),
    contrast: clampExposure(settings.contrast, 0.2, 3, 1)
  };
};

export const getExposureFilterString = (settings = {}) => {
  const { brightness, contrast } = getExposureSettings(settings);
  if (Math.abs(brightness - 1) < 0.001 && Math.abs(contrast - 1) < 0.001) {
    return 'none';
  }
  return `brightness(${brightness}) contrast(${contrast})`;
};

export const preprocessVideoFrame = (
  videoElement,
  settings = {},
  canvasRef,
  contextRef,
  processingOverride
) => {
  if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight) {
    return videoElement;
  }

  const { brightness, contrast } = getExposureSettings(settings);
  const processing =
    processingOverride || getHandTrackingRuntimeConfig(settings).processing;
  const targetDimensions = processing.maxWidth && processing.maxHeight
    ? getTargetDimensions(videoElement, processing)
    : { width: videoElement.videoWidth, height: videoElement.videoHeight };

  const needsResize =
    targetDimensions.width !== videoElement.videoWidth ||
    targetDimensions.height !== videoElement.videoHeight;

  const needsExposure = Math.abs(brightness - 1) >= 0.001 || Math.abs(contrast - 1) >= 0.001;

  if (!needsResize && !needsExposure) {
    return videoElement;
  }

  if (!canvasRef.current) {
    const canvas = document.createElement('canvas');
    canvasRef.current = canvas;
  }

  if (canvasRef.current) {
    const canvas = canvasRef.current;
    canvas.width = targetDimensions.width;
    canvas.height = targetDimensions.height;

    if (!contextRef.current) {
      contextRef.current = canvas.getContext('2d');
    }

    const ctx = contextRef.current;

    if (!ctx) {
      return videoElement;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = needsExposure ? `brightness(${brightness}) contrast(${contrast})` : 'none';
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    return canvas;
  }

  return videoElement;
};
