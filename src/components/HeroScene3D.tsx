import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

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
    grad.addColorStop(0.32, 'rgba(255,255,255,0.68)');
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
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 440, container.clientHeight || 300);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b0e23, 0.042);

    const camera = new THREE.PerspectiveCamera(
      38,
      (container.clientWidth || 440) / (container.clientHeight || 300),
      0.1,
      50
    );
    camera.position.set(0, 0.25, 6.25);

    // Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Balanced Three-Point Studio Lighting + Area Softboxes
    const hemi = new THREE.HemisphereLight(0xc7d8ff, 0x13112c, 0.95);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.1);
    keyLight.position.set(4.2, 5.2, 5.0);
    scene.add(keyLight);

    const cyanRim = new THREE.PointLight(0x38bdf8, 8.5, 16, 1.8);
    cyanRim.position.set(-3.8, 1.8, 2.8);
    scene.add(cyanRim);

    const purpleRim = new THREE.PointLight(0x9333ea, 9.0, 16, 1.8);
    purpleRim.position.set(3.8, -1.5, 2.4);
    scene.add(purpleRim);

    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const topSoftbox = new THREE.RectAreaLight(0xe0f2fe, 2.4, 5.0, 2.2);
      topSoftbox.position.set(0, 3.8, 2.2);
      topSoftbox.lookAt(0, 0, 0);
      scene.add(topSoftbox);

      const sideSoftbox = new THREE.RectAreaLight(0xc084fc, 1.8, 3.2, 2.5);
      sideSoftbox.position.set(-4.0, -0.5, 2.4);
      sideSoftbox.lookAt(0, 0, 0);
      scene.add(sideSoftbox);
    }

    const disposables: { dispose: () => void }[] = [envTex];
    const dynamicGeometries: THREE.BufferGeometry[] = [];

    // Root tiltable stage group
    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 1. Composite 3D Orbital Data Visualization Assembly
    const donutGroup = new THREE.Group();
    donutGroup.position.set(-0.36, 0.08, 0);
    donutGroup.rotation.set(0.3, -0.26, 0.08);
    rootGroup.add(donutGroup);

    // Primary Retained Arc: Deep Cobalt-to-Cyan Clearcoat Glass-Metal
    const retainedMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x0c3478,
      emissiveIntensity: 0.42,
      metalness: 0.44,
      roughness: 0.14,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.35,
    });

    // Secondary Risk/Churn Arc: Refined Amethyst-Violet Clearcoat
    const churnedMat = new THREE.MeshPhysicalMaterial({
      color: 0xa855f7,
      emissive: 0x3b0764,
      emissiveIntensity: 0.48,
      metalness: 0.44,
      roughness: 0.14,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.35,
    });

    // Brushed Titanium-Silver Collar
    const collarMat = new THREE.MeshPhysicalMaterial({
      color: 0xdbeafe,
      metalness: 0.94,
      roughness: 0.16,
      anisotropy: 0.85,
      anisotropyRotation: Math.PI / 4,
      envMapIntensity: 1.4,
    });

    // Outer Optical Glass Shroud (sapphire crystal lens around inner kernel)
    const outerGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      metalness: 0.0,
      roughness: 0.06,
      transmission: isSoftwareGl ? 0 : 0.92,
      transparent: true,
      opacity: isSoftwareGl ? 0.36 : 1.0,
      ior: 1.56,
      thickness: 1.4,
      attenuationColor: new THREE.Color(0x6366f1),
      attenuationDistance: 1.6,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      depthWrite: false,
      envMapIntensity: 1.5,
    });

    // Inner Luminous Faceted Kernel
    const innerKernelMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x7655e8,
      emissiveIntensity: 0.95,
      metalness: 0.35,
      roughness: 0.15,
      clearcoat: 0.9,
      flatShading: true,
    });

    disposables.push(retainedMat, churnedMat, collarMat, outerGlassMat, innerKernelMat);

    // Inner brushed metallic collar
    const collarGeo = new THREE.TorusGeometry(0.88, 0.026, 22, 84);
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    donutGroup.add(collarMesh);

    // Precision Instanced Radial Ticks around collar (24 ticks)
    const tickGeo = new THREE.BoxGeometry(0.014, 0.055, 0.014);
    const tickMat = new THREE.MeshStandardMaterial({
      color: 0x93c5fd,
      metalness: 0.9,
      roughness: 0.18,
    });
    const tickCount = 24;
    const tickInstanced = new THREE.InstancedMesh(tickGeo, tickMat, tickCount);
    const dummyObj = new THREE.Object3D();
    for (let i = 0; i < tickCount; i++) {
      const theta = (i / tickCount) * Math.PI * 2;
      dummyObj.position.set(Math.cos(theta) * 0.79, Math.sin(theta) * 0.79, 0);
      dummyObj.rotation.set(0, 0, theta + Math.PI / 2);
      dummyObj.updateMatrix();
      tickInstanced.setMatrixAt(i, dummyObj.matrix);
    }
    tickInstanced.instanceMatrix.needsUpdate = true;
    tickInstanced.computeBoundingSphere();
    donutGroup.add(tickInstanced);
    disposables.push(tickGeo, tickMat);

    // Outer optical glass sphere + inner faceted core
    const outerGlassGeo = new THREE.IcosahedronGeometry(0.46, 3);
    const outerGlassMesh = new THREE.Mesh(outerGlassGeo, outerGlassMat);
    outerGlassMesh.renderOrder = 2;
    const innerKernelGeo = new THREE.OctahedronGeometry(0.24, 1);
    const innerKernelMesh = new THREE.Mesh(innerKernelGeo, innerKernelMat);
    innerKernelMesh.renderOrder = 1;
    donutGroup.add(innerKernelMesh, outerGlassMesh);
    disposables.push(collarGeo, outerGlassGeo, innerKernelGeo);

    let retainedMesh: THREE.Mesh | null = null;
    let churnedMesh: THREE.Mesh | null = null;

    const buildDonutArcs = () => {
      if (retainedMesh) donutGroup.remove(retainedMesh);
      if (churnedMesh) donutGroup.remove(churnedMesh);
      while (dynamicGeometries.length > 0) {
        dynamicGeometries.pop()?.dispose();
      }

      const safeRetained = THREE.MathUtils.clamp(propsRef.current.retainedRatio, 0.08, 0.92);
      const gap = 0.095;
      const retainedArc = Math.max(0.22, safeRetained * Math.PI * 2 - gap);
      const churnedArc = Math.max(0.22, (1 - safeRetained) * Math.PI * 2 - gap);

      const retGeo = new THREE.TorusGeometry(1.16, 0.185, 32, 72, retainedArc);
      const chuGeo = new THREE.TorusGeometry(1.16, 0.185, 32, 52, churnedArc);
      dynamicGeometries.push(retGeo, chuGeo);

      retainedMesh = new THREE.Mesh(retGeo, retainedMat);
      churnedMesh = new THREE.Mesh(chuGeo, churnedMat);
      churnedMesh.rotation.z = retainedArc + gap;
      donutGroup.add(retainedMesh, churnedMesh);
    };
    buildDonutArcs();

    // 2. Twin Precision Orbital Gyroscope Rings + Outer Hairline Halo
    const orbitMat1 = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0c4a6e,
      emissiveIntensity: 0.5,
      metalness: 0.88,
      roughness: 0.16,
    });
    const orbitMat2 = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      emissive: 0x3b0764,
      emissiveIntensity: 0.45,
      metalness: 0.88,
      roughness: 0.18,
    });
    const orbitMat3 = new THREE.MeshStandardMaterial({
      color: 0xc4b5fd,
      metalness: 0.92,
      roughness: 0.22,
      transparent: true,
      opacity: 0.55,
    });
    const orbitGeo1 = new THREE.TorusGeometry(1.74, 0.015, 16, 108);
    const orbitGeo2 = new THREE.TorusGeometry(2.02, 0.013, 16, 108);
    const orbitGeo3 = new THREE.TorusGeometry(2.24, 0.008, 12, 120);
    const orbitRing1 = new THREE.Mesh(orbitGeo1, orbitMat1);
    const orbitRing2 = new THREE.Mesh(orbitGeo2, orbitMat2);
    const orbitRing3 = new THREE.Mesh(orbitGeo3, orbitMat3);
    orbitRing1.rotation.set(Math.PI / 3.1, 0.22, 0);
    orbitRing2.rotation.set(-Math.PI / 3.4, -0.32, 0.36);
    orbitRing3.rotation.set(0.55, 0.42, -0.2);
    donutGroup.add(orbitRing1, orbitRing2, orbitRing3);
    disposables.push(orbitMat1, orbitMat2, orbitMat3, orbitGeo1, orbitGeo2, orbitGeo3);

    // 3. Orbiting Precision Data Nodes
    const nodeGeo = new THREE.SphereGeometry(0.068, 22, 22);
    const nodeColors = [0x38bdf8, 0x818cf8, 0xa855f7, 0x22d3ee];
    const satellitePivot = new THREE.Group();
    donutGroup.add(satellitePivot);
    const satelliteMeshes: THREE.Mesh[] = [];
    disposables.push(nodeGeo);

    nodeColors.forEach((hex, idx) => {
      const mat = new THREE.MeshPhysicalMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: 1.05,
        roughness: 0.1,
        metalness: 0.25,
        clearcoat: 1.0,
      });
      disposables.push(mat);
      const sphere = new THREE.Mesh(nodeGeo, mat);
      const angle = (idx / nodeColors.length) * Math.PI * 2;
      const r = idx % 2 === 0 ? 1.74 : 2.02;
      sphere.position.set(
        Math.cos(angle) * r,
        Math.sin(angle) * r * 0.42,
        Math.sin(angle) * r * 0.52
      );
      satellitePivot.add(sphere);
      satelliteMeshes.push(sphere);
    });

    // 4. Floating Glass-Capped Analytic Bar Pillars (Right Flank)
    const barsGroup = new THREE.Group();
    barsGroup.position.set(1.92, -0.62, 0.28);
    barsGroup.rotation.y = -0.34;
    rootGroup.add(barsGroup);

    const plinthGeo = new THREE.CylinderGeometry(0.125, 0.135, 0.045, 24);
    const barCoreGeo = new THREE.CylinderGeometry(0.068, 0.082, 1.0, 20);
    barCoreGeo.translate(0, 0.5, 0);
    const barShellGeo = new THREE.CylinderGeometry(0.102, 0.112, 1.0, 24);
    barShellGeo.translate(0, 0.5, 0);
    disposables.push(plinthGeo, barCoreGeo, barShellGeo);

    const barShellMat = new THREE.MeshPhysicalMaterial({
      color: 0xe0f2fe,
      metalness: 0.05,
      roughness: 0.08,
      transmission: isSoftwareGl ? 0 : 0.78,
      transparent: true,
      opacity: isSoftwareGl ? 0.32 : 0.92,
      ior: 1.48,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      depthWrite: false,
      envMapIntensity: 1.4,
    });
    disposables.push(barShellMat);

    const barPalette = [0x38bdf8, 0x3b82f6, 0x6366f1, 0x8b5cf6, 0xa855f7];
    const barPillars: { core: THREE.Mesh; shell: THREE.Mesh; baseGroup: THREE.Group; phase: number }[] = [];

    for (let i = 0; i < 5; i++) {
      const pillarGroup = new THREE.Group();
      pillarGroup.position.set((i - 2) * 0.3, 0, Math.sin(i * 0.65) * 0.11);

      const plinth = new THREE.Mesh(plinthGeo, collarMat);
      plinth.position.y = -0.025;

      const coreMat = new THREE.MeshPhysicalMaterial({
        color: barPalette[i],
        emissive: barPalette[i],
        emissiveIntensity: 0.48,
        metalness: 0.3,
        roughness: 0.2,
        clearcoat: 0.8,
      });
      disposables.push(coreMat);

      const core = new THREE.Mesh(barCoreGeo, coreMat);
      core.scale.y = 0.25;
      core.renderOrder = 1;

      const shell = new THREE.Mesh(barShellGeo, barShellMat);
      shell.scale.y = 0.28;
      shell.renderOrder = 2;

      pillarGroup.add(plinth, core, shell);
      barsGroup.add(pillarGroup);
      barPillars.push({ core, shell, baseGroup: pillarGroup, phase: i * 0.7 });
    }

    // 5. Restrained Ambient Depth Field
    const particleCount = isMobile ? 30 : 64;
    const pPositions = new Float32Array(particleCount * 3);
    const pColors = new Float32Array(particleCount * 3);
    const paletteThree = [
      new THREE.Color(0x38bdf8),
      new THREE.Color(0x6366f1),
      new THREE.Color(0xa855f7),
      new THREE.Color(0x60a5fa),
    ];
    for (let i = 0; i < particleCount; i++) {
      pPositions[i * 3] = (Math.random() - 0.5) * 7.6;
      pPositions[i * 3 + 1] = (Math.random() - 0.5) * 4.2;
      pPositions[i * 3 + 2] = (Math.random() - 0.5) * 3.4 - 0.9;
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
      size: 0.11,
      map: particleTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
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

    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth || 440;
      const h = container.clientHeight || 300;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglUnavailable(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

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
        // Calm, weighted orbital & crystal motion
        donutGroup.position.y = 0.08 + Math.sin(elapsed * 0.85) * 0.06;
        donutGroup.rotation.z = 0.08 + Math.sin(elapsed * 0.42) * 0.05;

        innerKernelMesh.rotation.y += delta * 0.34;
        innerKernelMesh.rotation.x += delta * 0.2;
        outerGlassMesh.rotation.y -= delta * 0.16;

        orbitRing1.rotation.z += delta * 0.22;
        orbitRing2.rotation.z -= delta * 0.17;
        orbitRing3.rotation.y += delta * 0.12;
        satellitePivot.rotation.y += delta * 0.28;

        satelliteMeshes.forEach((s, i) => {
          s.position.y += Math.sin(elapsed * 1.2 + i) * 0.0007;
        });

        particles.rotation.y = elapsed * 0.025;
        particles.position.y = Math.sin(elapsed * 0.45) * 0.05;
      }

      // Smooth damped pointer parallax
      const targetRotY = propsRef.current.pointerTilt.x * 0.18;
      const targetRotX = propsRef.current.pointerTilt.y * -0.12;
      rootGroup.rotation.y = THREE.MathUtils.damp(rootGroup.rotation.y, targetRotY, 4.5, delta || 0.016);
      rootGroup.rotation.x = THREE.MathUtils.damp(rootGroup.rotation.x, targetRotX, 4.5, delta || 0.016);

      const ratios = propsRef.current.barRatios;
      barPillars.forEach((pillar, i) => {
        const baseHeight = Math.max(0.28, (ratios[i] ?? 0.6) * 1.28);
        const breathe = prefersReducedMotion ? 0 : Math.sin(elapsed * 1.1 + pillar.phase) * 0.035;
        const targetCore = Math.max(0.24, baseHeight + breathe);
        const targetShell = targetCore + 0.07;

        pillar.core.scale.y = THREE.MathUtils.damp(pillar.core.scale.y, targetCore, 4.2, delta || 0.016);
        pillar.shell.scale.y = THREE.MathUtils.damp(pillar.shell.scale.y, targetShell, 4.2, delta || 0.016);
        if (!prefersReducedMotion) {
          pillar.baseGroup.position.y = Math.sin(elapsed * 0.9 + pillar.phase) * 0.025;
        }
      });

      renderer.render(scene, camera);

      if (prefersReducedMotion) {
        return;
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
        className="w-full h-full flex items-center justify-center rounded-2xl bg-gradient-to-br from-[#38BDF8]/15 via-[#6366F1]/15 to-[#A855F7]/15 border border-white/15"
        aria-hidden="true"
      >
        <div className="w-36 h-36 rounded-full border-4 border-[#38BDF8]/50 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#38BDF8] to-[#A855F7] opacity-80" />
        </div>
      </div>
    );
  }

  return <div ref={mountRef} className="w-full h-full" aria-hidden="true" />;
};

export default HeroScene3D;
