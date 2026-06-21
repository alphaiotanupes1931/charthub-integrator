import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Float } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

type CandleSpec = { x: number; height: number; bodyH: number; bullish: boolean; wickTop: number; wickBot: number };

function generateCandles(count: number): CandleSpec[] {
  const rng = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  };
  const r = rng(7);
  let last = 0.5;
  const arr: CandleSpec[] = [];
  for (let i = 0; i < count; i++) {
    const drift = (r() - 0.45) * 0.6;
    const next = Math.max(0.1, Math.min(0.95, last + drift));
    const bullish = next >= last;
    const bodyH = Math.max(0.25, Math.abs(next - last) * 4 + r() * 0.6);
    const wickTop = r() * 0.5 + 0.15;
    const wickBot = r() * 0.5 + 0.15;
    arr.push({
      x: (i - count / 2) * 0.55,
      height: 1.2 + last * 1.2,
      bodyH,
      bullish,
      wickTop,
      wickBot,
    });
    last = next;
  }
  return arr;
}

function Candle({ spec, index, total }: { spec: CandleSpec; index: number; total: number }) {
  const group = useRef<THREE.Group>(null);
  const color = spec.bullish ? "#c9a84c" : "#6b4a18";
  const emissive = spec.bullish ? "#ffe9a8" : "#3a2a10";

  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    const phase = (index / total) * Math.PI * 2;
    group.current.position.y = spec.height + Math.sin(t * 0.8 + phase) * 0.12;
  });

  return (
    <group ref={group} position={[spec.x, spec.height, 0]}>
      {/* Upper wick */}
      <mesh position={[0, spec.bodyH / 2 + spec.wickTop / 2, 0]}>
        <cylinderGeometry args={[0.025, 0.025, spec.wickTop, 8]} />
        <meshStandardMaterial color={color} metalness={1} roughness={0.25} />
      </mesh>
      {/* Body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.32, spec.bodyH, 0.32]} />
        <meshPhysicalMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={0.12}
          metalness={1}
          roughness={0.18}
          clearcoat={1}
          clearcoatRoughness={0.15}
          envMapIntensity={1.2}
        />
      </mesh>
      {/* Lower wick */}
      <mesh position={[0, -spec.bodyH / 2 - spec.wickBot / 2, 0]}>
        <cylinderGeometry args={[0.025, 0.025, spec.wickBot, 8]} />
        <meshStandardMaterial color={color} metalness={1} roughness={0.25} />
      </mesh>
    </group>
  );
}

function Scene() {
  const candles = useMemo(() => generateCandles(14), []);
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    groupRef.current.rotation.y = Math.sin(t * 0.18) * 0.35;
    groupRef.current.rotation.x = Math.sin(t * 0.12) * 0.08 - 0.05;
  });

  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[5, 8, 5]} intensity={1.4} color="#ffe9a8" />
      <directionalLight position={[-6, 3, -4]} intensity={0.8} color="#c9a84c" />
      <pointLight position={[0, -3, 4]} intensity={1.2} color="#3a2a10" />
      <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.4}>
        <group ref={groupRef}>
          {candles.map((c, i) => (
            <Candle key={i} spec={c} index={i} total={candles.length} />
          ))}
        </group>
      </Float>
      {/* Reflective floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <circleGeometry args={[8, 64]} />
        <meshStandardMaterial color="#0d0d0d" metalness={0.9} roughness={0.5} />
      </mesh>
      <Environment preset="sunset" />
    </>
  );
}

export function CandlestickScene({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 1.5, 7], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
    </div>
  );
}
