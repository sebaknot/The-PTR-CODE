import { Feather } from "@expo/vector-icons";
import * as AppleAuthentication from "expo-apple-authentication";
import * as AuthSession from "expo-auth-session";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import React, { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/context/ThemeContext";
import { useUser } from "@/context/UserContext";
import type { UserRole, UserProfile } from "@/context/UserContext";


const porterLogo = require("@/assets/images/porter-logo.png");

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? "";
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";

type Step = "role" | "auth" | "email" | "otp" | "welcome" | "name";

type AuthTarget = { value: string; type: "phone" | "email" };

async function requestPostAuthPermissions(): Promise<void> {
  try {
    const locStatus = await Location.getForegroundPermissionsAsync();
    if (locStatus.status === "undetermined") {
      await Location.requestForegroundPermissionsAsync();
    }
  } catch {}
  try {
    if (Platform.OS !== "web") {
      const notifStatus = await Notifications.getPermissionsAsync();
      if (notifStatus.status === "undetermined") {
        await Notifications.requestPermissionsAsync();
      }
    }
  } catch {}
}

async function registerPushToken(authToken: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;
    const { data: pushToken } = await Notifications.getExpoPushTokenAsync();
    if (!pushToken) return;
    await fetch(`https://${DOMAIN}/api/users/me/push-token`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ pushToken }),
    });
  } catch {}
}

function navigateHome(role: UserRole) {
  if (role === "sender") {
    router.replace("/(sender)");
  } else {
    router.replace("/(porter)");
  }
}

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { user, token, setUser, setToken } = useUser();
  const C = useColors();

  const [step, setStep] = useState<Step>("role");
  const [role, setRole] = useState<UserRole>("sender");
  const [authTarget, setAuthTarget] = useState<AuthTarget>({ value: "", type: "phone" });
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCountdown, setResendCountdown] = useState(0);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<UserProfile | null>(null);
  const [welcomeName, setWelcomeName] = useState("");

  const welcomeOpacity = useRef(new Animated.Value(0)).current;
  const otpRefs = useRef<Array<TextInput | null>>([null, null, null, null]);
  const phoneInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (token && user && !user.firstName && !user.lastName && step === "role") {
      setPendingToken(token);
      setPendingUser(user);
      setStep("name");
    }
  }, []);

  useEffect(() => {
    if (step === "welcome") {
      Animated.sequence([
        Animated.timing(welcomeOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.delay(1200),
        Animated.timing(welcomeOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => {
        const navUser = pendingUser ?? user;
        if (navUser) navigateHome(navUser.role);
      });
    }
  }, [step]);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  const selectRole = (r: UserRole) => {
    Haptics.selectionAsync();
    setRole(r);
    setStep("auth");
  };

  const goBack = () => {
    setError("");
    if (step === "auth") setStep("role");
    else if (step === "email") setStep("auth");
    else if (step === "otp") setStep(authTarget.type === "email" ? "email" : "auth");
    else if (step === "name") {
      setPendingToken(null);
      setPendingUser(null);
      setStep("auth");
    }
  };

  const sendOtp = async (target: AuthTarget) => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`https://${DOMAIN}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.value.trim(), type: target.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send code");
      setAuthTarget(target);
      setResendCountdown(30);
      if (data.devCode) {
        const digits = String(data.devCode).split("").slice(0, 4);
        setOtp(digits);
        setError(`Dev mode: code is ${data.devCode}`);
      } else {
        setOtp(["", "", "", ""]);
        setError("");
      }
      setStep("otp");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneContinue = async () => {
    const val = authTarget.type === "phone" ? authTarget.value : authTarget.value;
    if (!authTarget.value.trim()) {
      setError("Please enter your phone number");
      return;
    }
    await sendOtp({ value: authTarget.value.trim(), type: "phone" });
  };

  const handleEmailContinue = async () => {
    if (!authTarget.value.trim() || !authTarget.value.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    await sendOtp({ value: authTarget.value.trim(), type: "email" });
  };

  const handleOtpChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);
    if (digit && index < 3) {
      otpRefs.current[index + 1]?.focus();
    }
    if (newOtp.every((d) => d !== "")) {
      verifyOtp(newOtp.join(""));
    }
  };

  const handleOtpKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !otp[index] && index > 0) {
      const newOtp = [...otp];
      newOtp[index - 1] = "";
      setOtp(newOtp);
      otpRefs.current[index - 1]?.focus();
    }
  };

  const verifyOtp = async (code: string) => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`https://${DOMAIN}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: authTarget.value.trim(),
          code,
          role,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Invalid code");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setPendingToken(data.token);
      setPendingUser(data.user as UserProfile);

      if (data.isNewUser) {
        setToken(data.token);
        setUser(data.user as UserProfile);
        requestPostAuthPermissions().then(() => registerPushToken(data.token));
        setStep("name");
      } else {
        const displayName = data.user.firstName ?? data.user.name?.split(" ")[0] ?? "back";
        setWelcomeName(displayName);
        setToken(data.token);
        setUser(data.user as UserProfile);
        requestPostAuthPermissions().then(() => registerPushToken(data.token));
        setStep("welcome");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid code");
      setOtp(["", "", "", ""]);
      otpRefs.current[0]?.focus();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleNameSubmit = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`https://${DOMAIN}/api/auth/complete-profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pendingToken}`,
        },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save profile");
      setUser(data.user as UserProfile);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (data.user) navigateHome((data.user as UserProfile).role);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!GOOGLE_CLIENT_ID) {
      setError("Google Sign-In is not configured. Use phone or email to continue.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const redirectUri = AuthSession.makeRedirectUri({ scheme: "porter" });
      const request = new AuthSession.AuthRequest({
        clientId: GOOGLE_CLIENT_ID,
        scopes: ["openid", "profile", "email"],
        redirectUri,
        responseType: AuthSession.ResponseType.Token,
        usePKCE: false,
      });
      const result = await request.promptAsync({
        authorizationEndpoint: "https://accounts.google.com/o/oauth2/auth",
      });
      if (result.type === "success" && result.authentication?.accessToken) {
        const res = await fetch(`https://${DOMAIN}/api/auth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: result.authentication.accessToken, role }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Google sign-in failed");
        setToken(data.token);
        setUser(data.user as UserProfile);
        requestPostAuthPermissions().then(() => registerPushToken(data.token));
        if (data.isNewUser) {
          setPendingToken(data.token);
          setPendingUser(data.user as UserProfile);
          setStep("name");
        } else {
          const displayName = data.user.firstName ?? data.user.name?.split(" ")[0] ?? "back";
          setWelcomeName(displayName);
          setStep("welcome");
        }
      } else if (result.type === "error") {
        setError("Google sign-in failed. Try again.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const res = await fetch(`https://${DOMAIN}/api/auth/apple`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identityToken: credential.identityToken,
          role,
          email: credential.email,
          fullName: credential.fullName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Apple sign-in failed");
      setToken(data.token);
      setUser(data.user as UserProfile);
      requestPostAuthPermissions().then(() => registerPushToken(data.token));
      if (data.isNewUser) {
        setPendingToken(data.token);
        setPendingUser(data.user as UserProfile);
        setStep("name");
      } else {
        const displayName = data.user.firstName ?? data.user.name?.split(" ")[0] ?? "back";
        setWelcomeName(displayName);
        setStep("welcome");
      }
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== "ERR_CANCELED") {
        setError(e instanceof Error ? e.message : "Apple sign-in failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const btnColor = role === "sender" ? C.primary : C.accent;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: C.dark }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {step === "welcome" ? (
        <Animated.View
          style={[styles.welcomeOverlay, { opacity: welcomeOpacity, backgroundColor: C.dark }]}
        >
          <Text style={styles.welcomeEmoji}>👋</Text>
          <Text style={styles.welcomeText}>Welcome back,</Text>
          <Text style={[styles.welcomeName, { color: btnColor }]}>{welcomeName}!</Text>
        </Animated.View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step !== "role" && (
            <Pressable style={styles.backBtn} onPress={goBack}>
              <Feather name="arrow-left" size={22} color="#fff" />
            </Pressable>
          )}

          {step === "role" && <RoleStep onSelect={selectRole} C={C} />}

          {step === "auth" && (
            <AuthStep
              role={role}
              phone={authTarget.type === "phone" ? authTarget.value : ""}
              onPhoneChange={(v) => {
                setAuthTarget({ value: v, type: "phone" });
                setError("");
              }}
              onPhoneContinue={handlePhoneContinue}
              onEmailPress={() => {
                setAuthTarget({ value: "", type: "email" });
                setStep("email");
              }}
              onGooglePress={handleGoogleSignIn}
              onApplePress={handleAppleSignIn}
              loading={loading}
              error={error}
              btnColor={btnColor}
              C={C}
            />
          )}

          {step === "email" && (
            <EmailStep
              email={authTarget.value}
              onEmailChange={(v) => {
                setAuthTarget({ value: v, type: "email" });
                setError("");
              }}
              onContinue={handleEmailContinue}
              loading={loading}
              error={error}
              btnColor={btnColor}
              C={C}
              inputRef={emailInputRef}
            />
          )}

          {step === "otp" && (
            <OtpStep
              target={authTarget.value}
              otp={otp}
              onChange={handleOtpChange}
              onKeyPress={handleOtpKeyPress}
              onResend={() => sendOtp(authTarget)}
              resendCountdown={resendCountdown}
              loading={loading}
              error={error}
              btnColor={btnColor}
              C={C}
              refs={otpRefs}
            />
          )}

          {step === "name" && (
            <NameStep
              firstName={firstName}
              lastName={lastName}
              onFirstNameChange={setFirstName}
              onLastNameChange={setLastName}
              onSubmit={handleNameSubmit}
              loading={loading}
              error={error}
              btnColor={btnColor}
              C={C}
            />
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

function RoleStep({ onSelect, C }: { onSelect: (r: UserRole) => void; C: ReturnType<typeof useColors> }) {
  const porterLogo = require("@/assets/images/porter-logo.png");
  return (
    <View style={styles.content}>
      <View style={styles.logoArea}>
        <Image source={porterLogo} style={styles.logoImage} resizeMode="contain" />
        <Text style={styles.logoText}>Porter</Text>
        <Text style={styles.tagline}>Packages, delivered your way</Text>
      </View>
      <Text style={styles.sectionTitle}>I want to…</Text>
      <Pressable
        style={({ pressed }) => [styles.roleCard, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => onSelect("sender")}
      >
        <View style={[styles.roleIcon, { backgroundColor: C.primaryLight }]}>
          <Feather name="send" size={28} color={C.primary} />
        </View>
        <View style={styles.roleInfo}>
          <Text style={styles.roleCardTitle}>Send Packages</Text>
          <Text style={styles.roleCardSub}>Get your items picked up and delivered fast</Text>
        </View>
        <Feather name="chevron-right" size={20} color={C.textSecondary} />
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.roleCard, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => onSelect("courier")}
      >
        <View style={[styles.roleIcon, { backgroundColor: C.accentLight }]}>
          <Feather name="truck" size={28} color={C.accent} />
        </View>
        <View style={styles.roleInfo}>
          <Text style={styles.roleCardTitle}>Become a Porter</Text>
          <Text style={styles.roleCardSub}>Earn money delivering packages nearby</Text>
        </View>
        <Feather name="chevron-right" size={20} color={C.textSecondary} />
      </Pressable>
    </View>
  );
}

function AuthStep({
  role, phone, onPhoneChange, onPhoneContinue, onEmailPress, onGooglePress, onApplePress,
  loading, error, btnColor, C,
}: {
  role: UserRole; phone: string;
  onPhoneChange: (v: string) => void;
  onPhoneContinue: () => void;
  onEmailPress: () => void;
  onGooglePress: () => void;
  onApplePress: () => void;
  loading: boolean; error: string; btnColor: string;
  C: ReturnType<typeof useColors>;
}) {
  const porterLogo = require("@/assets/images/porter-logo.png");
  return (
    <View style={styles.content}>
      <View style={styles.logoArea}>
        <Image source={porterLogo} style={styles.logoImage} resizeMode="contain" />
        <Text style={styles.logoText}>Welcome to Porter</Text>
        <Text style={styles.tagline}>
          {role === "sender" ? "Send packages fast" : "Earn delivering packages"}
        </Text>
      </View>
      <View style={styles.form}>
        <Text style={styles.label}>Phone number</Text>
        <View style={styles.inputWrap}>
          <Text style={styles.flagEmoji}>🇺🇸</Text>
          <TextInput
            style={styles.input}
            placeholder="+1 (555) 000-0000"
            placeholderTextColor="#6B7280"
            value={phone}
            onChangeText={onPhoneChange}
            keyboardType="phone-pad"
            returnKeyType="done"
            onSubmitEditing={onPhoneContinue}
            autoFocus
          />
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: btnColor, opacity: pressed ? 0.9 : 1 },
          ]}
          onPress={onPhoneContinue}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Continue with Phone number</Text>
          )}
        </Pressable>
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>
        {Platform.OS === "ios" && (
          <Pressable style={styles.secondaryBtn} onPress={onApplePress} disabled={loading}>
            <Feather name="smartphone" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.secondaryBtnText}>Continue with Apple</Text>
          </Pressable>
        )}
        <Pressable style={styles.secondaryBtn} onPress={onGooglePress} disabled={loading}>
          <Text style={[styles.secondaryBtnText, { marginRight: 8 }]}>G</Text>
          <Text style={styles.secondaryBtnText}>Continue with Google</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={onEmailPress} disabled={loading}>
          <Feather name="mail" size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.secondaryBtnText}>Continue with Email</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EmailStep({
  email, onEmailChange, onContinue, loading, error, btnColor, C, inputRef,
}: {
  email: string; onEmailChange: (v: string) => void; onContinue: () => void;
  loading: boolean; error: string; btnColor: string;
  C: ReturnType<typeof useColors>;
  inputRef: React.RefObject<TextInput | null>;
}) {
  return (
    <View style={styles.content}>
      <View style={[styles.logoArea, { marginBottom: 32 }]}>
        <Text style={styles.logoText}>Enter your email</Text>
        <Text style={styles.tagline}>We'll send you a verification code</Text>
      </View>
      <View style={styles.form}>
        <Text style={styles.label}>Email address</Text>
        <View style={styles.inputWrap}>
          <Feather name="mail" size={18} color={C.textSecondary} style={{ marginRight: 10 }} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor="#6B7280"
            value={email}
            onChangeText={onEmailChange}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={onContinue}
            autoFocus
          />
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: btnColor, opacity: pressed ? 0.9 : 1 },
          ]}
          onPress={onContinue}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Continue</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function OtpStep({
  target, otp, onChange, onKeyPress, onResend, resendCountdown, loading, error, btnColor, C, refs,
}: {
  target: string; otp: string[];
  onChange: (i: number, v: string) => void;
  onKeyPress: (i: number, k: string) => void;
  onResend: () => void;
  resendCountdown: number; loading: boolean; error: string; btnColor: string;
  C: ReturnType<typeof useColors>;
  refs: React.RefObject<Array<TextInput | null>>;
}) {
  return (
    <View style={styles.content}>
      <View style={[styles.logoArea, { marginBottom: 32 }]}>
        <Text style={styles.logoText}>Enter the code</Text>
        <Text style={styles.tagline}>Sent to {target}</Text>
      </View>
      <View style={styles.form}>
        <View style={styles.otpRow}>
          {otp.map((digit, i) => (
            <TextInput
              key={i}
              ref={(el) => {
                if (refs.current) refs.current[i] = el;
              }}
              style={[
                styles.otpBox,
                {
                  borderColor: digit ? btnColor : "rgba(255,255,255,0.2)",
                  color: "#fff",
                },
              ]}
              value={digit}
              onChangeText={(v) => onChange(i, v)}
              onKeyPress={({ nativeEvent }) => onKeyPress(i, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              autoFocus={i === 0}
            />
          ))}
        </View>
        {loading && (
          <ActivityIndicator color={btnColor} style={{ marginTop: 16 }} />
        )}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <View style={styles.resendRow}>
          {resendCountdown > 0 ? (
            <Text style={styles.resendTimer}>Resend code in {resendCountdown}s</Text>
          ) : (
            <Pressable onPress={onResend}>
              <Text style={[styles.resendLink, { color: btnColor }]}>Resend code</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function NameStep({
  firstName, lastName, onFirstNameChange, onLastNameChange, onSubmit, loading, error, btnColor, C,
}: {
  firstName: string; lastName: string;
  onFirstNameChange: (v: string) => void;
  onLastNameChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean; error: string; btnColor: string;
  C: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.content}>
      <View style={[styles.logoArea, { marginBottom: 32 }]}>
        <Text style={styles.logoText}>What's your name?</Text>
        <Text style={styles.tagline}>So porters and senders know who you are</Text>
      </View>
      <View style={styles.form}>
        <Text style={styles.label}>First name</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder="First name"
            placeholderTextColor="#6B7280"
            value={firstName}
            onChangeText={onFirstNameChange}
            autoCapitalize="words"
            returnKeyType="next"
            autoFocus
          />
        </View>
        <Text style={[styles.label, { marginTop: 8 }]}>Last name</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder="Last name"
            placeholderTextColor="#6B7280"
            value={lastName}
            onChangeText={onLastNameChange}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={onSubmit}
          />
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: btnColor, opacity: pressed ? 0.9 : 1, marginTop: 8 },
          ]}
          onPress={onSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Get started</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  content: { flex: 1 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  logoArea: {
    alignItems: "center",
    marginBottom: 48,
    gap: 10,
  },
  logoImage: {
    width: 90,
    height: 90,
    marginBottom: 4,
  },
  logoText: {
    fontSize: 30,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  tagline: {
    fontSize: 15,
    color: "rgba(255,255,255,0.55)",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    marginBottom: 20,
    textAlign: "center",
  },
  roleCard: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  roleIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  roleInfo: { flex: 1 },
  roleCardTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
    marginBottom: 4,
  },
  roleCardSub: {
    fontSize: 14,
    color: "rgba(255,255,255,0.55)",
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  form: { gap: 12 },
  label: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 0.2,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 16,
    height: 56,
  },
  flagEmoji: {
    fontSize: 22,
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: "#fff",
    fontFamily: "Inter_400Regular",
    fontSize: 16,
  },
  errorText: {
    color: "#EF4444",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    textAlign: "center",
  },
  primaryBtn: {
    borderRadius: 16,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  dividerText: {
    color: "rgba(255,255,255,0.4)",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    height: 52,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  secondaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_500Medium",
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
    marginVertical: 8,
  },
  otpBox: {
    width: 64,
    height: 72,
    borderRadius: 16,
    borderWidth: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
    textAlign: "center",
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  resendRow: {
    alignItems: "center",
    marginTop: 8,
  },
  resendTimer: {
    color: "rgba(255,255,255,0.4)",
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  resendLink: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  welcomeOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  welcomeEmoji: {
    fontSize: 64,
    marginBottom: 8,
  },
  welcomeText: {
    fontSize: 26,
    color: "rgba(255,255,255,0.7)",
    fontFamily: "Inter_400Regular",
  },
  welcomeName: {
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
});
