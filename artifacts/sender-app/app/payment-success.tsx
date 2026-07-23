import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/context/ThemeContext";
import { useUser, authedFetch } from "@/context/UserContext";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;

export default function PaymentSuccessScreen() {
  const insets = useSafeAreaInsets();
  const C = useColors();
  const { token, isLoading: authLoading } = useUser();
  const { session_id, cancelled } = useLocalSearchParams<{ session_id?: string; cancelled?: string }>();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMsg, setErrorMsg] = useState("");
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (authLoading) return;
    if (cancelled === "true") {
      setErrorMsg("Payment was cancelled. Returning to send form…");
      setStatus("error");
      const timer = setTimeout(() =>
        router.replace({ pathname: "/(sender)/send", params: { cancelMsg: "Payment was cancelled. You can try again when ready." } }),
        2500,
      );
      return () => clearTimeout(timer);
    }
    if (!session_id) {
      setStatus("error");
      setErrorMsg("No payment session found. Returning to send form…");
      const timer = setTimeout(() =>
        router.replace({ pathname: "/(sender)/send", params: { cancelMsg: "Payment session not found. Please try again." } }),
        2500,
      );
      return () => clearTimeout(timer);
    }
    completePayment(session_id);
  }, [session_id, cancelled, authLoading]);

  useEffect(() => {
    if (status === "success") {
      Animated.spring(scaleAnim, {
        toValue: 1,
        damping: 14,
        stiffness: 120,
        useNativeDriver: true,
      }).start();
    }
  }, [status]);

  async function completePayment(sid: string) {
    try {
      const res = await authedFetch(token, `https://${DOMAIN}/api/payments/complete`, {
        method: "POST",
        body: JSON.stringify({ sessionId: sid }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Payment verification failed");
      }
      setDeliveryId(data.delivery?.id ?? null);
      setStatus("success");
    } catch (e: any) {
      setErrorMsg(e.message ?? "Something went wrong");
      setStatus("error");
    }
  }

  const goToDelivery = () => {
    if (deliveryId) {
      router.replace({ pathname: "/delivery/[id]", params: { id: deliveryId } });
    } else {
      router.replace("/(sender)");
    }
  };

  const goBack = () => {
    router.replace("/(sender)/send");
  };

  return (
    <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      {status === "verifying" && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[styles.title, { color: C.text }]}>Confirming payment…</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>
            Please wait while we verify your payment.
          </Text>
        </View>
      )}

      {status === "success" && (
        <View style={styles.center}>
          <Animated.View style={[styles.checkCircle, { transform: [{ scale: scaleAnim }] }]}>
            <Feather name="check" size={42} color="#fff" />
          </Animated.View>
          <Text style={[styles.title, { color: C.text }]}>Payment confirmed!</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>
            Your pickup request has been placed. A Porter will be assigned shortly.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: C.primary, opacity: pressed ? 0.85 : 1 }]}
            onPress={goToDelivery}
          >
            <Text style={styles.primaryBtnText}>Track My Delivery</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </Pressable>
        </View>
      )}

      {status === "error" && (
        <View style={styles.center}>
          <View style={styles.errorCircle}>
            <Feather name="x" size={42} color="#fff" />
          </View>
          <Text style={[styles.title, { color: C.text }]}>Payment not confirmed</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>{errorMsg}</Text>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: C.primary, opacity: pressed ? 0.85 : 1 }]}
            onPress={goBack}
          >
            <Text style={styles.primaryBtnText}>Back to Send</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 20,
  },
  checkCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#22C55E",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  errorCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  primaryBtn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 32,
    width: "100%",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
});
