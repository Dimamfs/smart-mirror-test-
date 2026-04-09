import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import {
  CAMERA_ORIENTATION_ROTATIONS,
  CAMERA_POSITION_OPTIONS,
  CAMERA_POSITION_ROTATIONS,
  getExposureFilterString,
  getHandTrackingRuntimeConfig,
  preprocessVideoFrame,
  transformHandCoordinates
} from '../utils/handTracking';

const FPS_SMOOTHING = 0.9;

const ORIENTATION_OPTIONS = [
  { value: 'landscape', label: 'Landscape', rotation: 0 },
  { value: 'landscape_flipped', label: 'Landscape (Flipped)', rotation: 180 },
  { value: 'portrait', label: 'Portrait', rotation: 90 },
  { value: 'portrait_flipped', label: 'Portrait (Flipped)', rotation: -90 }
];

const HandTrackingApp = ({ onClose, onHandPosition, settings = {} }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [hands, setHands] = useState(null);
  const cameraRef = useRef(null);
  const [isEnabled, setIsEnabled] = useState(settings.enabled || false);
  const [showPreview, setShowPreview] = useState(settings.showPreview || false);
  const [cameraOrientation, setCameraOrientation] = useState(
    settings.cameraOrientation || 'landscape'
  );
  const [cameraPosition, setCameraPosition] = useState(
    settings.cameraPosition || 'top'
  );
  const processingCanvasRef = useRef(null);
  const processingContextRef = useRef(null);
  const settingsRef = useRef(settings);
  const lastFrameTimestampRef = useRef(0);
  const fpsRef = useRef({
    value: 0,
    lastTimestamp: typeof performance !== 'undefined' ? performance.now() : Date.now()
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    setCameraPosition(settings.cameraPosition || 'top');
  }, [settings.cameraPosition]);

  const orientationRotation = CAMERA_ORIENTATION_ROTATIONS[cameraOrientation] ?? 0;
  const cameraRotation = CAMERA_POSITION_ROTATIONS[cameraPosition] ?? 0;

  const onResults = useCallback(
    (results) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (!canvas || !video) {
        return;
      }

      const ctx = canvas.getContext('2d');

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const exposureFilter = getExposureFilterString(settingsRef.current);

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = now - fpsRef.current.lastTimestamp;
      fpsRef.current.lastTimestamp = now;
      const instantFps = elapsed > 0 ? 1000 / elapsed : 0;
      fpsRef.current.value =
        FPS_SMOOTHING * fpsRef.current.value + (1 - FPS_SMOOTHING) * instantFps;
      const smoothedFps = fpsRef.current.value;

      // Draw the video frame if preview is enabled
      if (showPreview) {
        ctx.save();
        ctx.filter = exposureFilter;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      if (showPreview) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(12, 12, 96, 32);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '16px "Segoe UI", Arial, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(`FPS: ${smoothedFps.toFixed(1)}`, 20, 28);
        ctx.restore();
      }

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const hand = results.multiHandLandmarks[0];

        if (showPreview) {
          // Draw hand connections
          drawConnectors(ctx, hand, Hands.HAND_CONNECTIONS, {
            color: '#00FF00',
            lineWidth: 2
          });

          // Draw all landmarks
          drawLandmarks(ctx, hand, {
            color: '#FF0000',
            lineWidth: 1
          });

          // Highlight index finger tip (landmark 8)
          const indexTip = hand[8];
          ctx.beginPath();
          ctx.arc(indexTip.x * canvas.width, indexTip.y * canvas.height, 8, 0, 2 * Math.PI);
          ctx.fillStyle = '#00FF00';
          ctx.fill();
        }

        // Send index finger position to parent component
        if (onHandPosition && hand[8]) {
          const indexTip = hand[8];
          const { x: normalizedX, y: normalizedY } = transformHandCoordinates(
            indexTip.x,
            indexTip.y,
            cameraOrientation,
            cameraPosition
          );

          const screenX = normalizedX * window.innerWidth;
          const screenY = normalizedY * window.innerHeight;

          onHandPosition({
            x: screenX,
            y: screenY,
            detected: true
          });
        }
      } else {
        // No hand detected
        if (onHandPosition) {
          onHandPosition({ detected: false });
        }
      }
    },
    [cameraOrientation, cameraPosition, onHandPosition, showPreview]
  );

  useEffect(() => {
    if (!isEnabled) return;

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
              const currentRuntime = getHandTrackingRuntimeConfig(settingsRef.current);
              const maxFrameRate = currentRuntime.maxFrameRate;
              if (maxFrameRate) {
                const now = performance.now();
                if (now - lastFrameTimestampRef.current < 1000 / maxFrameRate) {
                  return;
                }
                lastFrameTimestampRef.current = now;
              }

              const frameSource = preprocessVideoFrame(
                videoRef.current,
                settingsRef.current,
                processingCanvasRef,
                processingContextRef,
                currentRuntime.processing
              );
              await handsInstance.send({ image: frameSource });
            },
            width: runtimeConfig.camera.width,
            height: runtimeConfig.camera.height
          });

          await cameraInstance.start();
          cameraRef.current = cameraInstance;
        }
      } catch (error) {
        console.error('Error initializing hand tracking:', error);
      }
    };

    initializeHandTracking();

    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      setHands(null);
    };
  }, [isEnabled, settings.preprocessingQuality]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (hands) {
      const runtimeConfig = getHandTrackingRuntimeConfig(settingsRef.current);
      hands.setOptions(runtimeConfig.options);
      hands.onResults(onResults);
    }
  }, [hands, onResults, settings.minDetectionConfidence, settings.minTrackingConfidence, settings.preprocessingQuality]);

  const toggleEnabled = () => {
    setIsEnabled(!isEnabled);
  };

  const togglePreview = () => {
    setShowPreview(!showPreview);
  };

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gray-800">
        <h3 className="text-lg font-semibold">Hand Tracking</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-xl"
        >
          ×
        </button>
      </div>

      {/* Controls */}
      <div className="p-4 bg-gray-800 border-t border-gray-700">
        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <span>Enable Tracking</span>
            <button
              onClick={toggleEnabled}
              className={`px-3 py-1 rounded text-sm ${
                isEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'
              }`}
            >
              {isEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {isEnabled && (
            <div className="flex items-center justify-between">
              <span>Show Camera Preview</span>
              <button
                onClick={togglePreview}
                className={`px-3 py-1 rounded text-sm ${
                  showPreview ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-600 hover:bg-gray-700'
                }`}
              >
                {showPreview ? 'ON' : 'OFF'}
              </button>
            </div>
          )}

          <div className="flex flex-col">
            <span className="mb-1">Camera Position on Mirror</span>
            <select
              value={cameraPosition}
              onChange={(event) => setCameraPosition(event.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CAMERA_POSITION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <span className="mb-1">Camera Orientation</span>
            <select
              value={cameraOrientation}
              onChange={(event) => setCameraOrientation(event.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ORIENTATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Camera View */}
      <div className="flex-1 p-4">
        {isEnabled ? (
          <div className="relative w-full h-full">
            <video
              ref={videoRef}
              className="hidden"
              playsInline
            />
            <canvas
              ref={canvasRef}
              className={`w-full h-full object-contain ${showPreview ? 'bg-black' : 'bg-transparent'}`}
              style={{
                transform: `scaleX(-1) rotate(${-1 * (orientationRotation + cameraRotation)}deg)`,
                transformOrigin: 'center',
                maxHeight: '200px'
              }}
            />
            <div className="mt-2 text-sm text-gray-400">
              {showPreview
                ? 'Camera preview with hand tracking overlay'
                : 'Hand tracking active (preview hidden)'}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <div className="text-4xl mb-2">👋</div>
              <p>Enable hand tracking to start</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HandTrackingApp;
