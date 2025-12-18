import React, { useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei/native";
import type { GLTF } from "three-stdlib";
import {
  AnimationClip,
  LoopRepeat,
  NumberKeyframeTrack,
  type Group,
  type AnimationAction,
} from "three";

export function AvatarModel({
  uri,
  mouthActive,
  mouthValue,
  onReady,
}: {
  uri: string;
  mouthActive: boolean;
  mouthValue?: number;
  onReady?: () => void;
}) {
  const gltf = useGLTF(uri) as unknown as GLTF;

  const groupRef = useRef<Group | null>(null);

  // Minimal, non-conflicting "breathing" clip (position.y only)
  const idleClip = useMemo(() => {
    const times = [0, 1, 2];
    const bobValues = [0, 0.03, 0];
    const bobTrack = new NumberKeyframeTrack(".position[y]", times, bobValues);
    return new AnimationClip("Idle", -1, [bobTrack]);
  }, []);

  // Keep the clips array stable across renders
  const clips = useMemo(() => [idleClip], [idleClip]);

  const { actions } = useAnimations(clips, groupRef);

  const idleActionRef = useRef<AnimationAction | null>(null);

  // Start Idle only once per action instance (no reset on state changes)
  useEffect(() => {
    const idle = actions?.Idle;
    if (!idle) return;

    if (idleActionRef.current === idle) return;

    if (idleActionRef.current) {
      try {
        idleActionRef.current.stop();
      } catch {
        // ignore
      }
    }

    idleActionRef.current = idle;
    idle.setLoop(LoopRepeat, Infinity);
    idle.play();
    idle.enabled = true;

    try {
      idle.setEffectiveWeight(1);
    } catch {
      // ignore
    }

    return () => {
      if (idleActionRef.current === idle) {
        try {
          idle.stop();
        } catch {
          // ignore
        }
        idleActionRef.current = null;
      }
    };
  }, [actions]);

  // Keep the animation alive; reduce weight during speaking to hide frame drops / jitter
  useEffect(() => {
    const idle = idleActionRef.current;
    if (!idle) return;

    try {
      idle.play();
      idle.enabled = true;

      if (mouthActive) {
        idle.setEffectiveWeight(0.15);
      } else {
        idle.setEffectiveWeight(1);
      }
    } catch {
      // ignore
    }
  }, [mouthActive]);

  const targetsRef = useRef<{ influences: number[]; index: number }[]>([]);
  const readyOnceRef = useRef(false);

  useEffect(() => {
    const targets: { influences: number[]; index: number }[] = [];

    gltf.scene.traverse((obj: any) => {
      const dict = obj?.morphTargetDictionary;
      const influences = obj?.morphTargetInfluences;

      if (!dict || !influences || !Array.isArray(influences)) return;

      const jawIndex =
        dict["jawOpen"] ?? dict["JawOpen"] ?? dict["mouthOpen"] ?? dict["MouthOpen"];

      if (typeof jawIndex === "number") {
        targets.push({ influences, index: jawIndex });
      }
    });

    targetsRef.current = targets;
  }, [gltf]);

  useEffect(() => {
    if (readyOnceRef.current) return;
    readyOnceRef.current = true;

    if (onReady) {
      const raf = requestAnimationFrame(() => {
        try {
          onReady();
        } catch {
          // ignore
        }
      });
      return () => cancelAnimationFrame(raf);
    }

    return;
  }, [onReady]);

  const mouthSmoothedRef = useRef<number>(0);

  useFrame((state, delta) => {
    const targets = targetsRef.current;
    if (!targets.length) return;

    const t = state.clock.getElapsedTime();

    let desired: number;

    const hasMouthValue =
      Platform.OS === "web" && typeof mouthValue === "number" && Number.isFinite(mouthValue);

    if (hasMouthValue) {
      desired = mouthValue as number;
    } else {
      desired = mouthActive ? 0.35 + 0.35 * Math.sin(t * 12) : 0;
    }

    if (desired < 0) desired = 0;
    if (desired > 1) desired = 1;

    // Smooth to reduce jitter from state updates / viseme steps (frame-rate independent)
    const k = 20;
    const alpha = 1 - Math.exp(-k * Math.max(0, delta || 0));
    const next = mouthSmoothedRef.current + (desired - mouthSmoothedRef.current) * alpha;
    mouthSmoothedRef.current = next;

    for (const trg of targets) {
      trg.influences[trg.index] = next;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} position={[0, -1.6, 0]} scale={[1, 1, 1]} />
    </group>
  );
}
