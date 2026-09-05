import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * 3D landing backdrop: a field of glowing candlesticks laid out like a market
 * skyline, drifting slowly toward the camera. Rows wrap around seamlessly and
 * every bar eases toward its target height, so motion is always smooth.
 */

const BG = "#05070a";
const BULL = new THREE.Color("#2fbf85");
const BEAR = new THREE.Color("#c94a34");
const GOLD = new THREE.Color("#e0b64f");

const COLS = 46;
const ROWS = 30;
const SPACING_X = 1.15;
const SPACING_Z = 2.1;
const SCROLL_SPEED = 1.15; // rows per second

type RowState = {
  height: number[]; // current animated heights
  target: number[]; // where each bar is easing toward
  price: number[]; // random-walk close price per column (for coloring)
  z: number; // current depth position of the row
};

function makeRow(cols: number, prevPrice: number[]): RowState {
  const height: number[] = [];
  const target: number[] = [];
  const price: number[] = [];
  for (let c = 0; c < cols; c++) {
    const p = prevPrice[c] + (Math.random() - 0.5) * 0.9;
    price.push(p);
    const t = 0.4 + Math.abs(p % 3) * 0.6 + Math.random() * 1.4;
    target.push(t);
    height.push(t);
  }
  return { height, target, price, z: 0 };
}

function CandleField() {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const wickRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const rowsRef = useRef<RowState[] | null>(null);
  const colorBuf = useMemo(() => new THREE.Color(), []);

  if (!rowsRef.current) {
    const rows: RowState[] = [];
    let price = new Array(COLS).fill(0);
    for (let r = 0; r < ROWS; r++) {
      const row = makeRow(COLS, price);
      row.z = -r * SPACING_Z;
      price = row.price;
      rows.push(row);
    }
    rowsRef.current = rows;
  }

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const bodies = bodyRef.current;
    const wicks = wickRef.current;
    if (!bodies || !wicks) return;
    const rows = rowsRef.current!;
    const k = 1 - Math.exp(-2.2 * dt); // frame-rate-independent easing

    for (let r = 0; r < ROWS; r++) {
      const row = rows[r];
      row.z += SCROLL_SPEED * dt;
      if (row.z > SPACING_Z) {
        // Recycle this row to the back of the field with fresh targets.
        row.z -= ROWS * SPACING_Z;
        const backRow = rows[(r + 1) % ROWS];
        const next = makeRow(COLS, backRow.price);
        row.price = next.price;
        row.target = next.target;
      }
      for (let c = 0; c < COLS; c++) {
        row.height[c] += (row.target[c] - row.height[c]) * k;
        const h = Math.max(0.05, row.height[c]);
        const x = (c - (COLS - 1) / 2) * SPACING_X;
        const idx = r * COLS + c;

        dummy.position.set(x, h / 2, row.z);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix();
        bodies.setMatrixAt(idx, dummy.matrix);

        const wickH = h * 1.55;
        dummy.position.set(x, wickH / 2, row.z);
        dummy.scale.set(1, wickH, 1);
        dummy.updateMatrix();
        wicks.setMatrixAt(idx, dummy.matrix);

        const up = row.target[c] >= row.height[c];
        colorBuf.copy(up ? BULL : BEAR);
        // Nearest rows get a touch of gold on the tallest bars.
        if (h > 1.9 && row.z > -18) colorBuf.lerp(GOLD, 0.35);
        bodies.setColorAt(idx, colorBuf);
        wicks.setColorAt(idx, colorBuf.multiplyScalar(0.55));
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    wicks.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (wicks.instanceColor) wicks.instanceColor.needsUpdate = true;

    // Gentle camera sway — slow sine drift, never abrupt.
    const t = state.clock.elapsedTime;
    const cam = state.camera;
    cam.position.x = Math.sin(t * 0.11) * 2.4;
    cam.position.y = 7.5 + Math.sin(t * 0.07) * 0.8;
    cam.position.z = 14;
    cam.lookAt(0, 1.4, -16);
  });

  const count = COLS * ROWS;
  return (
    <>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <boxGeometry args={[0.62, 1, 0.62]} />
        <meshStandardMaterial roughness={0.35} metalness={0.15} />
      </instancedMesh>
      <instancedMesh ref={wickRef} args={[undefined, undefined, count]} frustumCulled={false}>
        <boxGeometry args={[0.08, 1, 0.08]} />
        <meshStandardMaterial roughness={0.5} metalness={0.1} />
      </instancedMesh>
    </>
  );
}

export function MarketTapeCanvas() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 7.5, 14], fov: 55, near: 0.1, far: 90 }}
      gl={{ antialias: true, powerPreference: "low-power" }}
    >
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 16, 58]} />
      <ambientLight intensity={0.5} color="#2a3444" />
      <directionalLight position={[8, 14, 6]} intensity={1.1} />
      <pointLight position={[0, 5, 8]} intensity={30} color={GOLD} distance={40} decay={2} />
      <CandleField />
    </Canvas>
  );
}
