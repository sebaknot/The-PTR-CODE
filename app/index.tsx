import { router } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useColors } from "@/context/ThemeContext";
import { useUser } from "@/context/UserContext";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

export default function Index() {
  const { user, token, isLoading, setUser, setToken } = useUser();
  const C = useColors();

  useEffect(() => {
    if (isLoading) return;

    const go = async () => {
      if (token) {
        try {
          const res = await fetch(`https://${DOMAIN}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const fresh = await res.json();
            setUser(fresh);
            if (!fresh.firstName && !fresh.lastName) {
              router.replace("/onboarding");
              return;
            }
            if (fresh.role === "sender") {
              router.replace("/(sender)");
            } else {
              router.replace("/(porter)");
            }
            return;
          } else {
            setToken(null);
            setUser(null);
          }
        } catch {
          if (user) {
            if (user.role === "sender") {
              router.replace("/(sender)");
            } else {
              router.replace("/(porter)");
            }
            return;
          }
        }
      } else if (user) {
        if (user.role === "sender") {
          router.replace("/(sender)");
        } else {
          router.replace("/(porter)");
        }
        return;
      }
      router.replace("/onboarding");
    };

    const timer = setTimeout(go, 0);
    return () => clearTimeout(timer);
  }, [isLoading]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={C.primary} size="large" />
    </View>
  );
}

const styles = { container: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const } };
