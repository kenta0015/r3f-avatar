import "react-native-gesture-handler";
import "@expo/metro-runtime";

import React, { useRef, useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView } from "react-native";

import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { Canvas, useFrame } from "@react-three/fiber";

const Stack = createNativeStackNavigator();

function Box(props) {
  const mesh = useRef(null);

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

function LandingScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.landingSafe}>
      <View style={styles.landingContainer}>
        <Text style={styles.landingTitle}>R3F Avatar MVP</Text>
        <Text style={styles.landingSubtitle}>
          Step 2: Navigation is wired. Next we will load a Ready Player Me avatar and add Supabase + Polly.
        </Text>

        <View style={styles.previewBox}>
          <Text style={styles.previewText}>Avatar Preview (placeholder)</Text>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate("Experience")}>
          <Text style={styles.primaryButtonText}>Enter Experience</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function ExperienceScreen({ navigation }) {
  return (
    <View style={styles.experienceContainer}>
      <View style={styles.experienceHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.experienceTitle}>Experience</Text>
        <View style={styles.backButtonSpacer} />
      </View>

      <View style={styles.canvasWrap}>
        <Canvas>
          <ambientLight />
          <pointLight position={[10, 10, 10]} />
          <Box position={[-1.2, 0, 0]} />
          <Box position={[1.2, 0, 0]} />
        </Canvas>
      </View>

      <View style={styles.miniFooter}>
        <Text style={styles.miniFooterText}>3D rendering is working. Next step will add Name/Message inputs + Speak.</Text>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Landing" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Landing" component={LandingScreen} />
        <Stack.Screen name="Experience" component={ExperienceScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  landingSafe: {
    flex: 1,
    backgroundColor: "black",
  },
  landingContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 16,
  },
  landingTitle: {
    color: "white",
    fontSize: 28,
    fontWeight: "700",
  },
  landingSubtitle: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    lineHeight: 20,
  },
  previewBox: {
    height: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  previewText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
  },
  primaryButton: {
    marginTop: 8,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  primaryButtonText: {
    color: "black",
    fontSize: 16,
    fontWeight: "700",
  },

  experienceContainer: {
    flex: 1,
    backgroundColor: "black",
  },
  experienceHeader: {
    height: 56,
    paddingHorizontal: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  experienceTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  backButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  backButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "700",
  },
  backButtonSpacer: {
    width: 54,
  },
  canvasWrap: {
    flex: 1,
  },
  miniFooter: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  miniFooterText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    lineHeight: 16,
  },
});
