import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { Link } from 'react-router-dom';
import { useModelSettings } from '../contexts/ModelSettingsContext';
import {
  applyCameraPositionTransform,
  getExposureFilterString,
  getHandTrackingRuntimeConfig,
} from '../utils/handTracking';

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

const toWorldSpace = (landmark) => {
  const x = (landmark.x - 0.5) * 2; // Center at origin
  const y = -(landmark.y - 0.5) * 2; // Invert so up is positive
  const z = -landmark.z * 2; // MediaPipe gives negative z when closer to camera
  return new THREE.Vector3(x, y, z);
};

const BASE_EDGE_COLOR = new THREE.Color(0x4fc3f7);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const transformLandmarksForCamera = (landmarks, cameraPosition) => {
  if (!Array.isArray(landmarks)) {
    return [];
  }

  return landmarks.map((landmark) => {
    const { x, y } = applyCameraPositionTransform(
      landmark.x,
      landmark.y,
      cameraPosition,
    );

    return {
      ...landmark,
      x,
      y,
    };
  });
};

const applyEdgeMaterialSettings = (material, settings) => {
  if (!material) {
    return;
  }

  const brightness = THREE.MathUtils.clamp(settings.tesseractBrightness ?? 1, 0.1, 5);
  const hsl = { h: 0, s: 0, l: 0 };
  BASE_EDGE_COLOR.getHSL(hsl);
  const adjustedColor = new THREE.Color().setHSL(
    hsl.h,
    THREE.MathUtils.clamp(hsl.s * (0.8 + (brightness - 1) * 0.2), 0, 1),
    THREE.MathUtils.clamp(hsl.l * brightness, 0, 1),
  );

  material.color.copy(adjustedColor);
  material.opacity = THREE.MathUtils.clamp(0.35 + brightness * 0.3, 0.25, 1);
  material.needsUpdate = true;
};

const updateEdgeInstances = (mesh, projectedVertices, edges, settings) => {
  if (!mesh) {
    return;
  }

  const radius = Math.max(0.004, (settings.lineThickness ?? 6) * 0.005);
  const tempMatrix = new THREE.Matrix4();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  edges.forEach(([startIndex, endIndex], instanceIndex) => {
    start.copy(projectedVertices[startIndex]);
    end.copy(projectedVertices[endIndex]);
    midpoint.addVectors(start, end).multiplyScalar(0.5);
    direction.subVectors(end, start);
    const length = direction.length();
    if (length <= 1e-6) {
      quaternion.identity();
      scale.set(radius, radius, radius);
      tempMatrix.compose(midpoint, quaternion, scale);
    } else {
      direction.normalize();
      quaternion.setFromUnitVectors(Y_AXIS, direction);
      scale.set(radius, length, radius);
      tempMatrix.compose(midpoint, quaternion, scale);
    }
    mesh.setMatrixAt(instanceIndex, tempMatrix);
  });

  mesh.instanceMatrix.needsUpdate = true;
};

const applyGlowSettings = (glowMaterial, glowPoints, settings) => {
  if (glowMaterial) {
    const brightness = THREE.MathUtils.clamp(settings.tesseractBrightness ?? 1, 0.1, 5);
    glowMaterial.opacity = THREE.MathUtils.clamp(0.3 * brightness, 0.05, 1);
    glowMaterial.size = 0.06 * (0.6 + brightness * 0.7);
    glowMaterial.needsUpdate = true;
  }

  if (glowPoints) {
    glowPoints.visible = Boolean(settings.glowEnabled);
  }
};

const createTesseract = (settings) => {
  const group = new THREE.Group();

  const distance = 2.8;
  const vertices4d = [];
  for (let x = -1; x <= 1; x += 2) {
    for (let y = -1; y <= 1; y += 2) {
      for (let z = -1; z <= 1; z += 2) {
        for (let w = -1; w <= 1; w += 2) {
          vertices4d.push(new THREE.Vector4(x, y, z, w));
        }
      }
    }
  }

  const projectVertex = (vertex) => {
    const wFactor = distance / (distance - vertex.w);
    return new THREE.Vector3(vertex.x * wFactor, vertex.y * wFactor, vertex.z * wFactor);
  };

  const projectedVertices = vertices4d.map(projectVertex);

  const edges = [];
  for (let i = 0; i < vertices4d.length; i += 1) {
    for (let j = i + 1; j < vertices4d.length; j += 1) {
      const diff =
        (vertices4d[i].x !== vertices4d[j].x) +
        (vertices4d[i].y !== vertices4d[j].y) +
        (vertices4d[i].z !== vertices4d[j].z) +
        (vertices4d[i].w !== vertices4d[j].w);
      if (diff === 1) {
        edges.push([i, j]);
      }
    }
  }

  const edgeGeometry = new THREE.CylinderGeometry(1, 1, 1, 24, 1, false);
  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: BASE_EDGE_COLOR.clone(),
    transparent: true,
    opacity: 0.9,
  });
  const edgeMesh = new THREE.InstancedMesh(edgeGeometry, edgeMaterial, edges.length);
  edgeMesh.instanceMatrix.setUsage?.(THREE.DynamicDrawUsage ?? THREE.StaticDrawUsage);
  updateEdgeInstances(edgeMesh, projectedVertices, edges, settings);
  applyEdgeMaterialSettings(edgeMaterial, settings);
  group.add(edgeMesh);

  const glowGeometry = new THREE.BufferGeometry().setFromPoints(projectedVertices);
  const glowMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.06,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true,
  });

  const glowPoints = new THREE.Points(glowGeometry, glowMaterial);
  group.add(glowPoints);
  applyGlowSettings(glowMaterial, glowPoints, settings);

  group.userData = {
    edgeMesh,
    edges,
    projectedVertices,
    glowMaterial,
    glowPoints,
  };

  return group;
};

const disposeObject = (object) => {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
};

const Model = () => {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const animationRef = useRef(null);
  const handsRef = useRef(null);
  const mediaPipeCameraRef = useRef(null);
  const tesseractRef = useRef(null);
  const handTargetRef = useRef({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: 0.6,
    visible: false,
  });
  const smoothedHandRef = useRef({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: 0.6,
    visible: false,
  });
  const detectionStateRef = useRef(false);
  const { settings } = useModelSettings();
  const settingsRef = useRef(settings);
  const [status, setStatus] = useState('Initializing hand tracking…');

  useEffect(() => {
    settingsRef.current = settings;
    if (tesseractRef.current) {
      const { edgeMesh, edges, projectedVertices, glowMaterial, glowPoints } = tesseractRef.current.userData ?? {};
      if (edgeMesh && edges && projectedVertices) {
        applyEdgeMaterialSettings(edgeMesh.material, settings);
        updateEdgeInstances(edgeMesh, projectedVertices, edges, settings);
      }
      applyGlowSettings(glowMaterial, glowPoints, settings);
    }

    if (videoRef.current) {
      videoRef.current.style.filter = getExposureFilterString(settings);
    }
  }, [settings]);

  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio ?? 1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.01, 20);
    camera.position.set(0, 0, 4);
    cameraRef.current = camera;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const fillLight = new THREE.DirectionalLight(0x4fc3f7, 0.9);
    fillLight.position.set(3, 4, 5);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xff6fb7, 0.6);
    rimLight.position.set(-3, -2, -4);
    scene.add(rimLight);

    const tesseract = createTesseract(settingsRef.current);
    tesseract.visible = false;
    scene.add(tesseract);
    tesseractRef.current = tesseract;

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      const rendererInstance = rendererRef.current;
      const sceneInstance = sceneRef.current;
      const cameraInstance = cameraRef.current;
      if (!rendererInstance || !sceneInstance || !cameraInstance) {
        return;
      }

      const target = handTargetRef.current;
      const smoothed = smoothedHandRef.current;

      const smoothingValue = THREE.MathUtils.clamp(
        settingsRef.current.smoothing ?? 0.8,
        0,
        0.95,
      );
      const interpolation = Math.max(0.05, 1 - smoothingValue);
      const rotationInterpolation = Math.max(0.05, interpolation * 0.75);

      if (target.visible) {
        smoothed.visible = true;
        smoothed.position.lerp(target.position, interpolation);
        smoothed.quaternion.slerp(target.quaternion, rotationInterpolation);
        smoothed.scale += (target.scale - smoothed.scale) * interpolation;
      } else {
        smoothed.visible = false;
      }

      if (tesseractRef.current) {
        tesseractRef.current.visible = smoothed.visible;
        if (smoothed.visible) {
          tesseractRef.current.position.copy(smoothed.position);
          tesseractRef.current.quaternion.copy(smoothed.quaternion);
          const scale = Math.max(0.05, smoothed.scale);
          tesseractRef.current.scale.setScalar(scale);
        }
      }

      rendererInstance.render(sceneInstance, cameraInstance);
    };

    animate();

    const handleResize = () => {
      if (!rendererRef.current || !cameraRef.current) {
        return;
      }
      const width = window.innerWidth;
      const height = window.innerHeight;
      rendererRef.current.setSize(width, height);
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);

    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    const onResults = (results) => {
      if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        handTargetRef.current.visible = false;
        if (detectionStateRef.current) {
          detectionStateRef.current = false;
          setStatus('Show your hand to the camera to control the tesseract');
        }
        return;
      }

      if (!detectionStateRef.current) {
        detectionStateRef.current = true;
        setStatus('Hand detected — pinch and move to manipulate the tesseract');
      }

      const landmarks = results.multiHandLandmarks[0];
      const cameraPosition = settingsRef.current.cameraPosition || 'top';
      const orientedLandmarks = transformLandmarksForCamera(landmarks, cameraPosition);
      const worldLandmarks = orientedLandmarks.map((landmark) => toWorldSpace(landmark));

      const thumbTip = worldLandmarks[4];
      const indexTip = worldLandmarks[8];
      const wrist = worldLandmarks[0];
      const middleBase = worldLandmarks[9];
      const midpoint = new THREE.Vector3().addVectors(thumbTip, indexTip).multiplyScalar(0.5);

      let totalDistance = 0;
      HAND_CONNECTIONS.forEach(([start, end]) => {
        totalDistance += worldLandmarks[start].distanceTo(worldLandmarks[end]);
      });
      const averageDistance = HAND_CONNECTIONS.length
        ? totalDistance / HAND_CONNECTIONS.length
        : 0.25;

      const handX = new THREE.Vector3().subVectors(indexTip, thumbTip);
      const handY = new THREE.Vector3().subVectors(middleBase, wrist);
      let handZ = new THREE.Vector3().crossVectors(handX, handY);

      if (handX.lengthSq() < 1e-6 || handY.lengthSq() < 1e-6 || handZ.lengthSq() < 1e-6) {
        handTargetRef.current.visible = false;
        return;
      }

      handX.normalize();
      handY.normalize();
      handZ.normalize();
      // Recompute handY to ensure orthogonality
      const orthoY = new THREE.Vector3().crossVectors(handZ, handX).normalize();
      const orthoZ = new THREE.Vector3().crossVectors(handX, orthoY).normalize();

      const basisMatrix = new THREE.Matrix4().makeBasis(handX, orthoY, orthoZ);
      const orientation = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);

      const target = handTargetRef.current;
      const sensitivity = THREE.MathUtils.clamp(
        settingsRef.current.sensitivity ?? 1,
        0.25,
        3,
      );
      midpoint.multiplyScalar(sensitivity);
      target.position.copy(midpoint);
      target.quaternion.copy(orientation);
      const sizeScaler = settingsRef.current.sizeScaler ?? 3.2;
      target.scale = Math.max(0.05, averageDistance * sizeScaler);
      target.visible = true;
    };

    const runtimeConfig = getHandTrackingRuntimeConfig(settingsRef.current);

    hands.setOptions({
      ...runtimeConfig.options,
      maxNumHands: 1,
      selfieMode: true,
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    const videoElement = videoRef.current;
    if (videoElement) {
      const mpCamera = new Camera(videoElement, {
        onFrame: async () => {
          if (handsRef.current) {
            await handsRef.current.send({ image: videoElement });
          }
        },
        width: runtimeConfig.camera?.width ?? 640,
        height: runtimeConfig.camera?.height ?? 480,
      });
      mediaPipeCameraRef.current = mpCamera;
      videoElement.style.filter = getExposureFilterString(settingsRef.current);
      mpCamera.start().then(() => {
        setStatus('Show your hand to the camera to control the tesseract');
      }).catch((error) => {
        console.error('Unable to start camera', error);
        setStatus('Unable to access camera — check permissions and reload');
      });
    }

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);

      if (mediaPipeCameraRef.current) {
        mediaPipeCameraRef.current.stop();
        mediaPipeCameraRef.current = null;
      }

      if (handsRef.current) {
        handsRef.current.close();
        handsRef.current = null;
      }

      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }

      if (tesseractRef.current) {
        disposeObject(tesseractRef.current);
        tesseractRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!handsRef.current) {
      return;
    }

    const runtimeConfig = getHandTrackingRuntimeConfig(settings);
    handsRef.current.setOptions({
      ...runtimeConfig.options,
      maxNumHands: 1,
      selfieMode: true,
    });
  }, [settings.minDetectionConfidence, settings.minTrackingConfidence, settings.preprocessingQuality]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        autoPlay
        muted
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-4 p-6 text-center">
        <div className="pointer-events-auto ml-auto">
          <Link
            to="/modelsettings"
            className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-200 transition hover:bg-cyan-400/20"
          >
            Adjust model settings
          </Link>
        </div>
        <div className="rounded-full bg-white/10 px-6 py-2 text-sm font-medium backdrop-blur">
          {status}
        </div>
        <div className="max-w-xl rounded-2xl bg-white/5 p-4 text-sm leading-relaxed text-slate-200 backdrop-blur">
          <p className="font-semibold text-slate-100">How to interact</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-left text-xs sm:text-sm">
            <li>Move your hand in front of the camera — the tesseract follows the midpoint between your thumb and index finger.</li>
            <li>Rotate your hand — the tesseract orientation is driven by the vector between thumb and index and the palm plane.</li>
            <li>Open or close your hand to change the overall scale; the average length of hand connections sets the size.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Model;
