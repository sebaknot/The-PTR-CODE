import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UserProvider, useUser } from "@/context/UserContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { StripeWrapper } from "@/components/StripeWrapper";

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);

function ApiTokenSync() {
  const { token } = useUser();
  React.useEffect(() => {
    setAuthTokenGetter(token ? () => token : null);
  }, [token]);
  return null;
}

function PushTokenSync() {
  const { token } = useUser();
  useEffect(() => {
    if (!token || Platform.OS === "web") return;
    let cancelled = false;
    async function register() {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const { data: pushToken } = await Notifications.getExpoPushTokenAsync();
        if (!pushToken || cancelled) return;
        await fetch(`https://${DOMAIN}/api/users/me/push-token`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ pushToken }),
        });
      } catch {}
    }
    register();
    return () => { cancelled = true; };
  }, [token]);
  return null;
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(sender)" />
      <Stack.Screen name="(porter)" />
      <Stack.Screen name="delivery/[id]" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="tracking/[id]" options={{ animation: "slide_from_bottom", presentation: "fullScreenModal" }} />
      <Stack.Screen name="payment-success" options={{ animation: "fade" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <StripeWrapper>
                <UserProvider>
                  <ApiTokenSync />
                  <PushTokenSync />
                  <RootLayoutNav />
                </UserProvider>
              </StripeWrapper>
            </GestureHandlerRootView>
          </ThemeProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
