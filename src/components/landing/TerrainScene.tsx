import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Scroll-driven WebGL scene for the cover page.
 *
 * Two layers:
 *  - a wireframe "price terrain" that ripples like a live surface
 *  - two instanced candlestick fields (bull / bear) rising out of the terrain
 *
 * Scroll progress (0..1 over the whole document) drives a camera path, so the
 * scene reads as one continuous flight rather than a looping background.
 */

const GOLD = "#e0b64f";
const BULL = "#4fd0c2";
const BEAR = "#e2563c";
const VOID_COLOR = "#05070a";

// Camera keyframes: [progress, position, lookAt]
const PATH: Array<{ at: number; pos: [number, number, number]; look: [number, number, number] }> = [
  { at: 0.0, pos: [0, 2.6, 11], look: [0, 0.6, 0] },
  { at: 0.22, pos: [-5.5, 1.5, 6.5], look: [0, 0.9, -2] },
  { at: 0.45, pos: [0, 8.5, 4.5], look: [0, 0, -3] },
  { at: 0.68, pos: [6.5, 1.2, 5.5], look: [0, 1.1, -1] },
  { at: 0.85, pos: [0, 1.0, 3.2], look: [0, 1.0, -6] },
  { at: 1.0, pos: [0, 3.4, 13], look: [0, 0.4, 0] },
];

function sampleValue(t: number, key: "pos" | "look"): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    if (clamped >= a.at && clamped <= b.at) {
      const span = b.at - a.at || 1;
      const raw = (clamped - a.at) / span;
      // smoothstep so section boundaries do not snap
      const k = raw * raw * (3 - 2 * raw);
      const av = a[key];
      const bv = b[key];
      return [av[0] + (bv[0] - av[0]) * k, av[1] + (bv[1] - av[1]) * k, av[2] + (bv[2] - av[2]) * k];
    }
  }
  return PATH[PATH.length - 1][key];
}

/** Deterministic pseudo-noise so server and client agree and frames stay cheap. */
function surface(x: number, z: number, time: number) {
  return (
    Math.sin(x * 0.42 + time * 0.35) * 0.55 +
    Math.cos(z * 0.31 - time * 0.24) * 0.5 +
    Math.sin((x + z) * 0.19 + time * 0.14) * 0.75
  );
}

function Terrain({ segments }: { segments: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(46, 46, segments, segments);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [segments]);

  const base = useMemo(() => {
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    return Float32Array.from(pos.array);
  }, [geometry]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] = surface(base[i], base[i + 2], t);
    }
    pos.needsUpdate = true;
  });

  return (
    <group position={[0, -1.6, -4]}>
      <lineSegments>
        <wireframeGeometry args={[geometry]} />
        <lineBasicMaterial color={GOLD} transparent opacity={0.26} blending={THREE.AdditiveBlending} />
      </lineSegments>
    </group>
  );
}

function CandleField({ count, side }: { count: number; side: "bull" | "bear" }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const s = Math.sin(i * 12.9898 + (side === "bull" ? 4.1 : 8.7)) * 43758.5453;
        return s - Math.floor(s);
      }),
    [count, side],
  );

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();
    const cols = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - cols / 2) * 1.15 + (side === "bull" ? 0.28 : -0.28);
      const z = (row - cols / 2) * 1.15 - 4;
      const seed = seeds[i];
      const h = 0.35 + Math.abs(Math.sin(t * 0.5 + seed * 9.2)) * (0.7 + seed * 1.5);
      const y = surface(x, z + 4, t) - 1.6 + h / 2;
      dummy.position.set(x, y, z);
      dummy.scale.set(0.16, h, 0.16);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        color={side === "bull" ? BULL : BEAR}
        transparent
        opacity={side === "bull" ? 0.5 : 0.44}
      />
    </instancedMesh>
  );
}

function SignalNodes({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 * 7;
      const r = 3 + ((i * 37) % 100) / 12;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = ((i * 17) % 100) / 22;
      arr[i * 3 + 2] = Math.sin(a) * r - 4;
    }
    return arr;
  }, [count]);

  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.03;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={GOLD} size={0.055} transparent opacity={0.6} sizeAttenuation />
    </points>
  );
}

function Rig({ progressRef }: { progressRef: React.MutableRefObject<number> }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 0.6, 0));

  useFrame((_, delta) => {
    const p = progressRef.current;
    const [px, py, pz] = sampleValue(p, "pos");
    const [lx, ly, lz] = sampleValue(p, "look");
    const ease = 1 - Math.pow(0.001, Math.min(delta, 0.05));
    camera.position.lerp(new THREE.Vector3(px, py, pz), ease);
    look.current.lerp(new THREE.Vector3(lx, ly, lz), ease);
    camera.lookAt(look.current);
  });

  return null;
}

export function TerrainScene() {
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [small, setSmall] = useState(false);
  const progressRef = useRef(0);

  useEffect(() => {
    setMounted(true);
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mob = window.matchMedia("(max-width: 640px)");
    const sync = () => {
      setReduced(rm.matches);
      setSmall(mob.matches);
    };
    sync();
    rm.addEventListener("change", sync);
    mob.addEventListener("change", sync);
    return () => {
      rm.removeEventListener("change", sync);
      mob.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    const read = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progressRef.current = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      raf = 0;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [mounted]);

  if (!mounted || reduced) {
    // Static cinematic backdrop for SSR, first paint, and reduced-motion users.
    return <div className="fixed inset-0 -z-10" style={{ background: VOID_COLOR }} aria-hidden />;
  }

  return (
    <div className="fixed inset-0 -z-10" style={{ background: VOID_COLOR }} aria-hidden>
      <Canvas
        dpr={[1, small ? 1.3 : 1.75]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        camera={{ fov: 55, position: [0, 2.6, 11], near: 0.1, far: 120 }}
      >
        <color attach="background" args={[VOID_COLOR]} />
        <fog attach="fog" args={[VOID_COLOR, 14, 44]} />
        <Rig progressRef={progressRef} />
        <Terrain segments={small ? 40 : 64} />
        <CandleField count={small ? 90 : 180} side="bull" />
        <CandleField count={small ? 60 : 130} side="bear" />
        <SignalNodes count={small ? 140 : 300} />
      </Canvas>
      {/* Readability scrim: keeps hero copy legible over the moving scene. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 18% 45%, rgba(5,7,10,0.92) 0%, rgba(5,7,10,0.62) 38%, rgba(5,7,10,0.18) 70%, rgba(5,7,10,0) 100%)",
        }}
      />
  );
}
