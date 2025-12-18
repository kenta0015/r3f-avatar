import React, { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

export function RotatingBox(props: any) {
  const mesh = useRef<any>(null);
  const [hovered, setHover] = useState(false);
  const [active, setActive] = useState(false);

  useFrame(() => {
    if (mesh?.current) {
      mesh.current.rotation.x += 0.01;
      mesh.current.rotation.y += 0.01;
    }
  });

  return (
    <mesh
      {...props}
      ref={mesh}
      scale={active ? [1.5, 1.5, 1.5] : [1, 1, 1]}
      onClick={() => setActive((v) => !v)}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={hovered ? "hotpink" : "orange"} />
    </mesh>
  );
}

export function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]} receiveShadow>
      <planeGeometry args={[20, 20]} />
      <meshStandardMaterial color="#1a1a1a" />
    </mesh>
  );
}

export function LoadingFallback() {
  return (
    <mesh position={[0, 0, 0]}>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="orange" />
    </mesh>
  );
}
