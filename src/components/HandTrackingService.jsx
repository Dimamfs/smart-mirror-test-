import { useRef, useEffect, useState } from 'react';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import {
  CAMERA_ORIENTATION_ROTATIONS,
  CAMERA_POSITION_ROTATIONS,
  getExposureFilterString,
  getHandTrackingRuntimeConfig,
  preprocessVideoFrame,
  transformHandCoordinates
} from '../utils/handTracking';

// Define hand connections manually if import fails
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index finger
  [0, 9], [9, 10], [10, 11], [11, 12],  // Middle finger
  [0, 13], [13, 14], [14, 15], [15, 16], // Ring finger
  [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
  [5, 9], [9, 13], [13, 17]             // Palm connections
];

const clampValue = (value, min, max, fallback) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.min(Math.max(numeric, min), max);
  }
  return fallback;
};

const clamp01 = (value) => Math.min(Math.max(value, 0), 1);

const FPS_SMOOTHING = 0.9;

const HandTrackingService = ({ onHandPosition, settings = {}, enabled }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [hands, setHands] = useState(null); // eslint-disable-line no-unused-vars
  const [camera, setCamera] = useState(null);
  const [isEnabled, setIsEnabled] = useState(enabled ?? settings.enabled ?? false);
  const [showPreview, setShowPreview] = useState(settings.showPreview || false);
  const [previewPosition, setPreviewPosition] = useState({ x: 16, y: 16 }); // Default position (top-4 left-4 = 16px)
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const cameraOrientation = settings.cameraOrientation || 'landscape';
  const cameraPosition = settings.cameraPosition || 'top';
  const orientationRotation = CAMERA_ORIENTATION_ROTATIONS[cameraOrientation] ?? 0;
  const cameraRotation = CAMERA_POSITION_ROTATIONS[cameraPosition] ?? 0;
  const processingCanvasRef = useRef(null);
  const processingContextRef = useRef(null);
  const settingsRef = useRef(settings);
  const handPositionCallbackRef = useRef(onHandPosition);
  const showPreviewRef = useRef(settings.showPreview || false);
  const lastFrameTimestampRef = useRef(0);
  const isProcessingFrameRef = useRef(false);
  const smoothedPositionRef = useRef(null);
  const smoothingRef = useRef(0);
  const sensitivityRef = useRef(1);
  const fpsRef = useRef({
    value: 0,
    lastTimestamp: typeof performance !== 'undefined' ? performance.now() : Date.now()
  });

  useEffect(() => {
    settingsRef.current = settings;
    setIsEnabled(enabled ?? settings.enabled ?? false);
    setShowPreview(settings.showPreview || false);
    smoothingRef.current = clampValue(settings.smoothing, 0, 0.95, 0);
    sensitivityRef.current = clampValue(settings.sensitivity, 0.25, 3, 1);
  }, [enabled, settings]);

  useEffect(() => {
    handPositionCallbackRef.current = onHandPosition;
  }, [onHandPosition]);

  useEffect(() => {
    showPreviewRef.current = showPreview;
  }, [showPreview]);

  useEffect(() => () => {
    handPositionCallbackRef.current = null;
  }, []);

  useEffect(() => {
    if (!isEnabled) {
      // Clean up when disabled
      if (camera) {
        camera.stop();
        setCamera(null);
      }
      smoothedPositionRef.current = null;
      isProcessingFrameRef.current = false;
      const callback = handPositionCallbackRef.current;
      if (callback) {
        callback({ detected: false });
      }
      return;
    }

    const initializeHandTracking = async () => {
      try {
        // Initialize MediaPipe Hands
        const handsInstance = new Hands({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
          }
        });

        const runtimeConfig = getHandTrackingRuntimeConfig(settingsRef.current);
        lastFrameTimestampRef.current = 0;
        handsInstance.setOptions(runtimeConfig.options);

        handsInstance.onResults(onResults);
        setHands(handsInstance);

        // Initialize camera
        if (videoRef.current) {
          const cameraInstance = new Camera(videoRef.current, {
            onFrame: async () => {
              if (isProcessingFrameRef.current) {
                return;
              }

              // Video element may become null if the component is disabled
              // while this async callback is still in-flight. Guard here to
              // prevent MediaPipe from crashing on null.width.
              if (!videoRef.current) {
                return;
              }

              const currentRuntime = getHandTrackingRuntimeConfig(settingsRef.current);
              const maxFrameRate = currentRuntime.maxFrameRate;
              if (maxFrameRate) {
                const now = performance.now();
                if (now - lastFrameTimestampRef.current < 1000 / maxFrameRate) {
                  return;
                }
                lastFrameTimestampRef.current = now;
              }

              isProcessingFrameRef.current = true;
              const frameSource = preprocessVideoFrame(
                videoRef.current,
                settingsRef.current,
                processingCanvasRef,
                processingContextRef,
                currentRuntime.processing
              );
              // preprocessVideoFrame returns null if the video isn't ready yet
              if (!frameSource) {
                isProcessingFrameRef.current = false;
                return;
              }
              try {
                await handsInstance.send({ image: frameSource });
              } finally {
                isProcessingFrameRef.current = false;
              }
            },
            width: runtimeConfig.camera.width,
            height: runtimeConfig.camera.height
          });

          await cameraInstance.start();
          setCamera(cameraInstance);
        }
      } catch (error) {
        console.error('Error initializing hand tracking:', error);
      }
    };

    initializeHandTracking();

    return () => {
      if (camera) {
        camera.stop();
      }
    };
  }, [isEnabled, settings.preprocessingQuality]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (hands) {
      const runtimeConfig = getHandTrackingRuntimeConfig(settingsRef.current);
      hands.setOptions(runtimeConfig.options);
    }
  }, [hands, settings.minDetectionConfidence, settings.minTrackingConfidence, settings.preprocessingQuality]);

  const onResults = (results) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    if (!canvas || !video) return;
    
    const ctx = canvas.getContext('2d');
    const w = canvas.width = video.videoWidth;
    const h = canvas.height = video.videoHeight;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Draw the video frame if preview is enabled
    const currentSettings = settingsRef.current || {};
    const exposureFilter = getExposureFilterString(currentSettings);

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - fpsRef.current.lastTimestamp;
    fpsRef.current.lastTimestamp = now;
    const instantFps = elapsed > 0 ? 1000 / elapsed : 0;
    fpsRef.current.value =
      FPS_SMOOTHING * fpsRef.current.value + (1 - FPS_SMOOTHING) * instantFps;
    const smoothedFps = fpsRef.current.value;

    if (showPreviewRef.current) {
      ctx.save();
      ctx.filter = exposureFilter;
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(10, 10, 92, 28);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '14px "Segoe UI", Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(`FPS: ${smoothedFps.toFixed(1)}`, 18, 24);
      ctx.restore();
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const hand = results.multiHandLandmarks[0];
      
      // Get thumb tip (landmark 4), index tip (landmark 8), and pinky tip (landmark 20)
      const thumbTip = hand[4];
      const indexTip = hand[8];
      const pinkyTip = hand[20];
      
      if (showPreviewRef.current) {
        // Draw hand connections
        drawConnectors(ctx, hand, HAND_CONNECTIONS, {
          color: '#00FF00',
          lineWidth: 2
        });
        
        // Draw all landmarks
        drawLandmarks(ctx, hand, {
          color: '#FF0000',
          lineWidth: 1
        });
        
        // Highlight thumb tip and index finger tip
        const tx = thumbTip.x * w;
        const ty = thumbTip.y * h;
        const ix = indexTip.x * w;
        const iy = indexTip.y * h;
        
        // Draw thumb tip
        ctx.beginPath();
        ctx.arc(tx, ty, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#FF00FF'; // Magenta for thumb
        ctx.fill();
        
        // Draw index tip
        ctx.beginPath();
        ctx.arc(ix, iy, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#00FF00'; // Green for index
        ctx.fill();
        
        // Draw midpoint
        const midX = (tx + ix) / 2;
        const midY = (ty + iy) / 2;
        ctx.beginPath();
        ctx.arc(midX, midY, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#00FFFF'; // Cyan for midpoint
        ctx.fill();
      }

      // Calculate pinch detection
      const tx = thumbTip.x * w;
      const ty = thumbTip.y * h;
      const ix = indexTip.x * w;
      const iy = indexTip.y * h;
      const px = pinkyTip.x * w;
      const py = pinkyTip.y * h;

      // Calculate pinch distance
      const pinchDistance = Math.hypot(tx - ix, ty - iy);
      const pinkyThumbDistance = Math.hypot(tx - px, ty - py);
      
      // Calculate average distance of all hand connections for normalization
      let totalDistance = 0;
      let connectionCount = 0;
      for (const [a, b] of HAND_CONNECTIONS) {
        const sx = hand[a].x * w;
        const sy = hand[a].y * h;
        const ex = hand[b].x * w;
        const ey = hand[b].y * h;
        totalDistance += Math.hypot(sx - ex, sy - ey);
        connectionCount++;
      }
      const avgConnectionDistance = connectionCount ? totalDistance / connectionCount : 1;
      
      // Calculate pinch strength (0-1, normalized by hand scale)
      const pinchThreshold = currentSettings.pinchSensitivity || 0.2; // Default 20%
      const normalizedPinchDistance = Math.min(Math.max((pinchDistance - 10) / (avgConnectionDistance * 4.5), 0), 1);
      const pinchStrength = Math.max(0, 1 - (normalizedPinchDistance / pinchThreshold));
      const isPinching = normalizedPinchDistance < pinchThreshold;

      const fistThreshold = currentSettings.fistThreshold || 0.35;
      const openThreshold = Math.max(currentSettings.openThreshold || 0.65, fistThreshold + 0.1);
      const normalizedPinkyThumbDistance = avgConnectionDistance ? pinkyThumbDistance / avgConnectionDistance : 0;
      const fistStrengthRaw = 1 - (normalizedPinkyThumbDistance / fistThreshold);
      const fistStrength = Math.max(0, Math.min(fistStrengthRaw, 1));
      const isFist = normalizedPinkyThumbDistance <= fistThreshold;
      const isHandOpen = normalizedPinkyThumbDistance >= openThreshold;

      // Calculate midpoint between thumb and index finger
      const midpointX = (thumbTip.x + indexTip.x) / 2;
      const midpointY = (thumbTip.y + indexTip.y) / 2;

      // Convert to screen coordinates
      const { x: normalizedX, y: normalizedY } = transformHandCoordinates(
        midpointX,
        midpointY,
        currentSettings.cameraOrientation || 'landscape',
        currentSettings.cameraPosition || 'top'
      );

      const sensitivity = sensitivityRef.current;
      const adjustedNormalizedX = clamp01(((normalizedX - 0.5) * sensitivity) + 0.5);
      const adjustedNormalizedY = clamp01(((normalizedY - 0.5) * sensitivity) + 0.5);

      const smoothing = smoothingRef.current;
      let smoothedX = adjustedNormalizedX;
      let smoothedY = adjustedNormalizedY;

      if (smoothing > 0 && smoothedPositionRef.current) {
        const alpha = 1 - smoothing;
        smoothedX = smoothedPositionRef.current.x + (adjustedNormalizedX - smoothedPositionRef.current.x) * alpha;
        smoothedY = smoothedPositionRef.current.y + (adjustedNormalizedY - smoothedPositionRef.current.y) * alpha;
      }

      smoothedPositionRef.current = { x: smoothedX, y: smoothedY };

      const screenX = smoothedX * window.innerWidth;
      const screenY = smoothedY * window.innerHeight;

      // Send position and pinch data to parent component
      const callback = handPositionCallbackRef.current;
      if (callback) {
        callback({
          x: screenX,
          y: screenY,
          detected: true,
          isPinching,
          pinchStrength: Math.min(pinchStrength, 1), // Clamp to 0-1
          pinchDistance: normalizedPinchDistance,
          isFist,
          fistStrength,
          isHandOpen,
          pinkyThumbDistanceRatio: normalizedPinkyThumbDistance
        });
      }
    } else {
      // No hand detected
      smoothedPositionRef.current = null;
      const callback = handPositionCallbackRef.current;
      if (callback) {
        callback({ detected: false });
      }
    }
  };

  const handleMouseDown = (e) => {
    setIsDraggingPreview(true);
    setDragStart({
      x: e.clientX - previewPosition.x,
      y: e.clientY - previewPosition.y
    });
  };

  const handleMouseMove = (e) => {
    if (isDraggingPreview) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      // Keep preview within viewport bounds
      const maxX = window.innerWidth - 272; // 256px width + 16px padding
      const maxY = window.innerHeight - 200; // 192px height + 8px padding
      
      setPreviewPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
    }
  };

  const handleMouseUp = () => {
    setIsDraggingPreview(false);
  };

  // Add global mouse event listeners
  useEffect(() => {
    if (isDraggingPreview) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDraggingPreview, dragStart]);

  if (!isEnabled) {
    return null;
  }

  return (
    <div 
      className={`fixed z-40 ${showPreview ? 'block' : 'hidden'}`}
      style={{
        left: `${previewPosition.x}px`,
        top: `${previewPosition.y}px`
      }}
    >
      <div 
        className="bg-black/80 backdrop-blur-sm rounded-lg p-2 cursor-move select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="text-white text-xs mb-2 text-center">Hand Tracking Preview</div>
        <div className="relative">
          <video
            ref={videoRef}
            className="hidden"
            playsInline
            autoPlay
            muted
          />
          <canvas
            ref={canvasRef}
            className="w-64 h-48 object-contain bg-black rounded"
            style={{
              transform: `scaleX(-1) rotate(${-1 * (orientationRotation + cameraRotation)}deg)`,
              transformOrigin: 'center'
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default HandTrackingService;
