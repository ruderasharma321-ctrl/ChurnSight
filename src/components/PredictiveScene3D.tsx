import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export interface PredictiveScene3DProps {
  isTraining?: boolean;
  riskProbability?: number | null; // 0..1
  pointerTilt?: { x: number; y: number };
  variant?: 'header' | 'dial';
}

function createSoftNodeTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.65)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export const PredictiveScene3D: React.FC<PredictiveScene3DProps> = ({
  isTraining = false,
  riskProbability = null,
  pointerTilt = { x: 0, y: 0 },
  variant = 'header',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [fallbackMode, setFallbackMode] = useState(false);

  const propsRef = useRef({ isTraining, riskProbability, pointerTilt });
  propsRef.current = { isTraining, riskProbability, pointerTilt };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const isSoftwareGl = detectSoftwareWebGL();
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setFallbackMode(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 640, container.clientHeight || 220);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      variant === 'dial' ? 38 : 42,
      (container.clientWidth || 640) / (container.clientHeight || 220),
      0.1,
      40
    );
    camera.position.set(0, 0, variant === 'dial' ? 5.6 : 6.8);

    // Subtle Precision Lighting
    const ambient = new THREE.AmbientLight(0xc7d2fe, 0.7);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0x35c5e8, 1.4);
    keyLight.position.set(4, 3, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7655e8, 1.3);
    rimLight.position.set(-4, -2, 3);
    scene.add(rimLight);

    const rootGroup = new THREE.Group();
    if (variant === 'header') {
      rootGroup.position.set(2.1, 0, 0);
    }
    scene.add(rootGroup);

    // Architectural Precision Wireframe Sphere
    const icosaGeom = new THREE.IcosahedronGeometry(variant === 'dial' ? 1.52 : 1.85, 2);
    const wireGeom = new THREE.WireframeGeometry(icosaGeom);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x397bff,
      transparent: true,
      opacity: variant === 'dial' ? 0.16 : 0.22,
    });
    const wireMesh = new THREE.LineSegments(wireGeom, wireMat);
    rootGroup.add(wireMesh);

    // Inner Precision Calibration Torus Rings
    const ring1Geom = new THREE.TorusGeometry(variant === 'dial' ? 1.82 : 2.25, 0.014, 12, 96);
    const ring1Mat = new THREE.MeshBasicMaterial({
      color: 0x35c5e8,
      transparent: true,
      opacity: 0.42,
    });
    const ring1 = new THREE.Mesh(ring1Geom, ring1Mat);
    ring1.rotation.x = Math.PI * 0.38;
    ring1.rotation.y = Math.PI * 0.12;
    rootGroup.add(ring1);

    const ring2Geom = new THREE.TorusGeometry(variant === 'dial' ? 2.06 : 2.55, 0.011, 12, 96);
    const ring2Mat = new THREE.MeshBasicMaterial({
      color: 0x7655e8,
      transparent: true,
      opacity: 0.35,
    });
    const ring2 = new THREE.Mesh(ring2Geom, ring2Mat);
    ring2.rotation.x = -Math.PI * 0.28;
    ring2.rotation.z = Math.PI * 0.22;
    rootGroup.add(ring2);

    // Orbiting Telemetry Satellites
    const satGeom = new THREE.SphereGeometry(0.055, 16, 16);
    const satMat1 = new THREE.MeshBasicMaterial({ color: 0x35c5e8 });
    const satMat2 = new THREE.MeshBasicMaterial({ color: 0xb84de0 });
    const sat1 = new THREE.Mesh(satGeom, satMat1);
    const sat2 = new THREE.Mesh(satGeom, satMat2);
    rootGroup.add(sat1, sat2);

    // Subtle Floating Data-Lattice Particle Field
    const particleCount = isMobile || isSoftwareGl ? 36 : 72;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const palette = [
      new THREE.Color(0x35c5e8),
      new THREE.Color(0x397bff),
      new THREE.Color(0x7655e8),
      new THREE.Color(0xb84de0),
    ];

    for (let i = 0; i < particleCount; i++) {
      const spreadX = variant === 'dial' ? 4.8 : 9.0;
      const spreadY = variant === 'dial' ? 4.2 : 4.6;
      const spreadZ = 3.2;
      positions[i * 3] = (Math.random() - 0.5) * spreadX - (variant === 'header' ? 1.5 : 0);
      positions[i * 3 + 1] = (Math.random() - 0.5) * spreadY;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spreadZ;
      const c = palette[i % palette.length];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const particleGeom = new THREE.BufferGeometry();
    particleGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const nodeTex = createSoftNodeTexture();
    const particleMat = new THREE.PointsMaterial({
      size: variant === 'dial' ? 0.16 : 0.18,
      map: nodeTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeom, particleMat);
    scene.add(particles);

    // Handle WebGL context loss gracefully
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setFallbackMode(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 220;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    let isVisible = true;
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        isVisible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 }
    );
    intersectionObserver.observe(container);

    let rafId = 0;
    let timerId = 0;
    const clock = new THREE.Clock();
    const lowColor = new THREE.Color(0x35c5e8);
    const midColor = new THREE.Color(0x7655e8);
    const highColor = new THREE.Color(0xb84de0);
    const targetColor = new THREE.Color(0x397bff);

    const renderFrame = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      const { isTraining: training, riskProbability: prob, pointerTilt: tilt } = propsRef.current;

      const speedMult = training ? 2.8 : 1.0;

      wireMesh.rotation.y += dt * 0.16 * speedMult;
      wireMesh.rotation.x += dt * 0.07 * speedMult;

      ring1.rotation.z += dt * 0.24 * speedMult;
      ring2.rotation.y -= dt * 0.18 * speedMult;

      const r1 = variant === 'dial' ? 1.82 : 2.25;
      sat1.position.set(
        Math.cos(elapsed * 0.85 * speedMult) * r1,
        Math.sin(elapsed * 0.85 * speedMult) * r1 * 0.45,
        Math.sin(elapsed * 0.85 * speedMult) * r1 * 0.55
      );
      const r2 = variant === 'dial' ? 2.06 : 2.55;
      sat2.position.set(
        Math.sin(-elapsed * 0.65 * speedMult) * r2,
        Math.cos(-elapsed * 0.65 * speedMult) * r2 * 0.65,
        Math.cos(-elapsed * 0.65 * speedMult) * 0.5
      );

      particles.rotation.y = elapsed * 0.03;

      // Subtle risk-reactive accent color shift
      if (typeof prob === 'number') {
        if (prob >= 0.65) {
          targetColor.copy(highColor);
        } else if (prob >= 0.35) {
          targetColor.copy(midColor);
        } else {
          targetColor.copy(lowColor);
        }
        ring1Mat.color.lerp(targetColor, 0.08);
      }

      // Smooth damped pointer parallax
      const targetRotY = tilt.x * 0.22;
      const targetRotX = tilt.y * 0.16;
      rootGroup.rotation.y = THREE.MathUtils.damp(rootGroup.rotation.y, targetRotY, 4.5, dt);
      rootGroup.rotation.x = THREE.MathUtils.damp(rootGroup.rotation.x, targetRotX, 4.5, dt);

      renderer.render(scene, camera);
    };

    const scheduleNext = () => {
      if (prefersReducedMotion) return;
      if (!isVisible) {
        timerId = window.setTimeout(() => {
          rafId = requestAnimationFrame(loop);
        }, 250);
        return;
      }
      if (isSoftwareGl) {
        timerId = window.setTimeout(() => {
          rafId = requestAnimationFrame(loop);
        }, 42);
      } else {
        rafId = requestAnimationFrame(loop);
      }
    };

    const loop = () => {
      renderFrame();
      scheduleNext();
    };

    renderFrame();
    if (!prefersReducedMotion) {
      scheduleNext();
    }

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      icosaGeom.dispose();
      wireGeom.dispose();
      wireMat.dispose();
      ring1Geom.dispose();
      ring1Mat.dispose();
      ring2Geom.dispose();
      ring2Mat.dispose();
      satGeom.dispose();
      satMat1.dispose();
      satMat2.dispose();
      particleGeom.dispose();
      particleMat.dispose();
      nodeTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [variant]);

  if (fallbackMode) {
    return (
      <div className="w-full h-full pointer-events-none relative overflow-hidden" aria-hidden="true">
        <div className="absolute -right-12 -top-12 w-72 h-72 rounded-full border border-[#35C5E8]/20 bg-gradient-to-br from-[#397BFF]/10 to-[#7655E8]/10" />
        <div className="absolute right-8 top-4 w-52 h-52 rounded-full border border-[#7655E8]/25" />
      </div>
    );
  }

  return <div ref={mountRef} className="w-full h-full pointer-events-none" aria-hidden="true" />;
};

export default PredictiveScene3D;
