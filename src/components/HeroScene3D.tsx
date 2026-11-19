import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface HeroScene3DProps {
  retainedRatio: number; // 0..1
  churnedRatio: number; // 0..1
  barRatios: number[]; // 5 values in 0.2..1.0
  pointerTilt: { x: number; y: number };
}

function createSoftParticleTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
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
    const gl = probeCanvas.getContext('webgl2');
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

export const HeroScene3D: React.FC<HeroScene3DProps> = ({
  retainedRatio,
  churnedRatio,
  barRatios,
  pointerTilt,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  const propsRef = useRef({ retainedRatio, churnedRatio, barRatios, pointerTilt });
  propsRef.current = { retainedRatio, churnedRatio, barRatios, pointerTilt };

  const rebuildDonutRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    rebuildDonutRef.current?.();
  }, [retainedRatio, churnedRatio, barRatios]);

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
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 420, container.clientHeight || 340);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      40,
      (container.clientWidth || 420) / (container.clientHeight || 340),
      0.1,
      50
    );
    camera.position.set(0, 0.35, 6.4);

    // Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Balanced Three-Point Studio Lighting Rig
    const hemi = new THREE.HemisphereLight(0xb8c6ff, 0x181336, 0.9);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff5ec, 2.2);
    keyLight.position.set(4, 5, 5);
    scene.add(keyLight);

    const cyanRim = new THREE.PointLight(0x35c5e8, 8, 16, 1.8);
    cyanRim.position.set(-3.8, 1.6, 2.8);
    scene.add(cyanRim);

    const pinkRim = new THREE.PointLight(0xe84fa8, 9, 16, 1.8);
    pinkRim.position.set(3.8, -1.5, 2.5);
    scene.add(pinkRim);

    // Track disposable resources
    const disposables: { dispose: () => void }[] = [envTex];
    const dynamicGeometries: THREE.BufferGeometry[] = [];

    // Root tiltable stage group
    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 1. Composite 3D Volumetric Churn Doughnut Assembly
    const donutGroup = new THREE.Group();
    donutGroup.position.set(-0.25, 0.12, 0);
    donutGroup.rotation.set(0.32, -0.28, 0.12);
    rootGroup.add(donutGroup);

    const retainedMat = new THREE.MeshPhysicalMaterial({
      color: 0x397bff,
      emissive: 0x102a6b,
      emissiveIntensity: 0.45,
      metalness: 0.35,
      roughness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
    });
    const churnedMat = new THREE.MeshPhysicalMaterial({
      color: 0xe84fa8,
      emissive: 0x5c1142,
      emissiveIntensity: 0.5,
      metalness: 0.35,
      roughness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
    });
    const collarMat = new THREE.MeshStandardMaterial({
      color: 0xc4b5fd,
      metalness: 0.88,
      roughness: 0.2,
    });
    const coreGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x7655e8,
      emissive: 0x35c5e8,
      emissiveIntensity: 0.35,
      metalness: 0.1,
      roughness: 0.12,
      transparent: true,
      opacity: 0.82,
      clearcoat: 1.0,
    });
    disposables.push(retainedMat, churnedMat, collarMat, coreGlassMat);

    // Inner precision metallic ring + luminous center sphere
    const collarGeo = new THREE.TorusGeometry(0.92, 0.032, 20, 72);
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    donutGroup.add(collarMesh);

    const coreGeo = new THREE.IcosahedronGeometry(0.42, 2);
    const coreMesh = new THREE.Mesh(coreGeo, coreGlassMat);
    donutGroup.add(coreMesh);
    disposables.push(collarGeo, coreGeo);

    let retainedMesh: THREE.Mesh | null = null;
    let churnedMesh: THREE.Mesh | null = null;

    const buildDonutArcs = () => {
      if (retainedMesh) {
        donutGroup.remove(retainedMesh);
      }
      if (churnedMesh) {
        donutGroup.remove(churnedMesh);
      }
      while (dynamicGeometries.length > 0) {
        dynamicGeometries.pop()?.dispose();
      }

      const safeRetained = THREE.MathUtils.clamp(propsRef.current.retainedRatio, 0.08, 0.92);
      const gap = 0.09;
      const retainedArc = Math.max(0.2, safeRetained * Math.PI * 2 - gap);
      const churnedArc = Math.max(0.2, (1 - safeRetained) * Math.PI * 2 - gap);

      const retGeo = new THREE.TorusGeometry(1.18, 0.2, 28, 64, retainedArc);
      const chuGeo = new THREE.TorusGeometry(1.18, 0.2, 28, 48, churnedArc);
      dynamicGeometries.push(retGeo, chuGeo);

      retainedMesh = new THREE.Mesh(retGeo, retainedMat);
      churnedMesh = new THREE.Mesh(chuGeo, churnedMat);
      churnedMesh.rotation.z = retainedArc + gap;
      donutGroup.add(retainedMesh, churnedMesh);
    };
    buildDonutArcs();

    // 2. Twin Precision Orbital Gyroscope Rings
    const orbitMat1 = new THREE.MeshStandardMaterial({
      color: 0x35c5e8,
      emissive: 0x166882,
      emissiveIntensity: 0.65,
      metalness: 0.85,
      roughness: 0.2,
    });
    const orbitMat2 = new THREE.MeshStandardMaterial({
      color: 0xb84de0,
      emissive: 0x4b1866,
      emissiveIntensity: 0.55,
      metalness: 0.85,
      roughness: 0.24,
    });
    const orbitGeo1 = new THREE.TorusGeometry(1.78, 0.018, 16, 96);
    const orbitGeo2 = new THREE.TorusGeometry(2.06, 0.015, 16, 96);
    const orbitRing1 = new THREE.Mesh(orbitGeo1, orbitMat1);
    const orbitRing2 = new THREE.Mesh(orbitGeo2, orbitMat2);
    orbitRing1.rotation.set(Math.PI / 3, 0.2, 0);
    orbitRing2.rotation.set(-Math.PI / 3.4, -0.35, 0.4);
    donutGroup.add(orbitRing1, orbitRing2);
    disposables.push(orbitMat1, orbitMat2, orbitGeo1, orbitGeo2);

    // 3. Orbiting Glowing Satellite Nodes
    const nodeGeo = new THREE.SphereGeometry(0.085, 20, 20);
    const nodeColors = [0x35c5e8, 0xe84fa8, 0x7655e8, 0x16c995];
    const satellitePivot = new THREE.Group();
    donutGroup.add(satellitePivot);
    const satelliteMeshes: THREE.Mesh[] = [];
    disposables.push(nodeGeo);

    nodeColors.forEach((hex, idx) => {
      const mat = new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: 1.2,
        roughness: 0.15,
        metalness: 0.2,
      });
      disposables.push(mat);
      const sphere = new THREE.Mesh(nodeGeo, mat);
      const angle = (idx / nodeColors.length) * Math.PI * 2;
      const r = idx % 2 === 0 ? 1.78 : 2.06;
      sphere.position.set(Math.cos(angle) * r, Math.sin(angle) * r * 0.45, Math.sin(angle) * r * 0.55);
      satellitePivot.add(sphere);
      satelliteMeshes.push(sphere);
    });

    // 4. 3D Floating Analytic Bar Pillars (Right Flank)
    const barsGroup = new THREE.Group();
    barsGroup.position.set(1.95, -0.58, 0.35);
    barsGroup.rotation.y = -0.32;
    rootGroup.add(barsGroup);

    const barBaseGeo = new THREE.CylinderGeometry(0.11, 0.13, 1.0, 20);
    barBaseGeo.translate(0, 0.5, 0); // pivot at bottom so scaling grows cleanly upward
    disposables.push(barBaseGeo);

    const barPalette = [0x7655e8, 0x397bff, 0x35c5e8, 0xb84de0, 0xe84fa8];
    const barMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshPhysicalMaterial({
        color: barPalette[i],
        emissive: barPalette[i],
        emissiveIntensity: 0.28,
        metalness: 0.3,
        roughness: 0.22,
        clearcoat: 0.9,
      });
      disposables.push(mat);
      const bar = new THREE.Mesh(barBaseGeo, mat);
      bar.position.set((i - 2) * 0.3, 0, Math.sin(i * 0.6) * 0.12);
      bar.scale.y = 0.2;
      barsGroup.add(bar);
      barMeshes.push(bar);
    }

    // 5. Lightweight Ambient Particle Field
    const particleCount = isMobile ? 38 : 85;
    const pPositions = new Float32Array(particleCount * 3);
    const pColors = new Float32Array(particleCount * 3);
    const paletteThree = [
      new THREE.Color(0x35c5e8),
      new THREE.Color(0x7655e8),
      new THREE.Color(0xe84fa8),
      new THREE.Color(0x397bff),
    ];
    for (let i = 0; i < particleCount; i++) {
      pPositions[i * 3] = (Math.random() - 0.5) * 7.5;
      pPositions[i * 3 + 1] = (Math.random() - 0.5) * 4.5;
      pPositions[i * 3 + 2] = (Math.random() - 0.5) * 3.5 - 0.8;
      const c = paletteThree[i % paletteThree.length];
      pColors[i * 3] = c.r;
      pColors[i * 3 + 1] = c.g;
      pColors[i * 3 + 2] = c.b;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3));
    const particleTex = createSoftParticleTexture();
    const particleMat = new THREE.PointsMaterial({
      size: 0.13,
      map: particleTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    rootGroup.add(particles);
    disposables.push(particleGeo, particleTex, particleMat);

    rebuildDonutRef.current = () => {
      buildDonutArcs();
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // ResizeObserver for crisp responsiveness
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth || 420;
      const h = container.clientHeight || 340;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // WebGL context loss guard
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    // Animation loop with delta clock, zero per-frame allocations, and software WebGL pacing
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const renderFrame = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.08);
      const elapsed = clock.getElapsedTime();

      if (!prefersReducedMotion) {
        // Gentle orbital & floating motion
        donutGroup.position.y = 0.12 + Math.sin(elapsed * 1.15) * 0.09;
        donutGroup.rotation.z = 0.12 + Math.sin(elapsed * 0.55) * 0.08;
        coreMesh.rotation.y += delta * 0.45;
        coreMesh.rotation.x += delta * 0.25;

        orbitRing1.rotation.z += delta * 0.32;
        orbitRing2.rotation.z -= delta * 0.24;
        satellitePivot.rotation.y += delta * 0.42;
        satelliteMeshes.forEach((s, i) => {
          s.position.y += Math.sin(elapsed * 1.8 + i) * 0.0012;
        });

        particles.rotation.y = elapsed * 0.04;
        particles.position.y = Math.sin(elapsed * 0.6) * 0.08;
      }

      // Smooth damped pointer parallax + bar heights
      const targetRotY = propsRef.current.pointerTilt.x * 0.24;
      const targetRotX = propsRef.current.pointerTilt.y * -0.16;
      rootGroup.rotation.y = THREE.MathUtils.damp(rootGroup.rotation.y, targetRotY, 5.5, delta || 0.016);
      rootGroup.rotation.x = THREE.MathUtils.damp(rootGroup.rotation.x, targetRotX, 5.5, delta || 0.016);

      const ratios = propsRef.current.barRatios;
      barMeshes.forEach((bar, i) => {
        const targetHeight = Math.max(0.25, (ratios[i] ?? 0.6) * 1.35);
        bar.scale.y = THREE.MathUtils.damp(bar.scale.y, targetHeight, 4.5, delta || 0.016);
      });

      renderer.render(scene, camera);

      if (prefersReducedMotion) {
        return; // Render crisp single initial frame when user prefers reduced motion
      }
      if (isSoftwareGl) {
        afterDraw(renderFrame);
      } else {
        frameId = requestAnimationFrame(renderFrame);
      }
    };

    renderFrame();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      while (dynamicGeometries.length > 0) {
        dynamicGeometries.pop()?.dispose();
      }
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (webglUnavailable) {
    return (
      <div
        className="w-full h-full flex items-center justify-center rounded-2xl bg-gradient-to-br from-[#397BFF]/20 via-[#7655E8]/20 to-[#E84FA8]/20 border border-white/15"
        aria-hidden="true"
      >
        <div className="w-40 h-40 rounded-full border-4 border-[#35C5E8]/60 flex items-center justify-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#7655E8] to-[#E84FA8] opacity-80" />
        </div>
      </div>
    );
  }

  return <div ref={mountRef} className="w-full h-full" aria-hidden="true" />;
};

export default HeroScene3D;
