import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useListDeliveries } from "@workspace/api-client-react";
import { useColors, useTheme } from "@/context/ThemeContext";
import { useUser, authedFetch } from "@/context/UserContext";

function getPorterLevel(count: number): { label: string; color: string; icon: string } {
  if (count >= 100) return { label: "Expert", color: "#A78BFA", icon: "award" };
  if (count >= 50) return { label: "Pro", color: "#F59E0B", icon: "star" };
  if (count >= 10) return { label: "Rising", color: "#6FA3C8", icon: "trending-up" };
  return { label: "Newcomer", color: "#94A3B8", icon: "user" };
}

export default function PorterProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, token, logout, updateUser } = useUser();
  const C = useColors();
  const { isDark, toggleTheme } = useTheme();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const { data } = useListDeliveries(
    { courierId: user?.id },
    { query: { enabled: !!user?.id } }
  );

  const deliveries = data?.deliveries ?? [];
  const completed = deliveries.filter((d) => d.status === "delivered");
  const totalEarned = completed.reduce((sum, d) => sum + d.estimatedPrice, 0);
  const level = getPorterLevel(completed.length);

  const handleToggleOnline = async (value: boolean) => {
    if (!user?.id) return;
    Haptics.selectionAsync();
    try {
      await authedFetch(
        token,
        `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/porters/${user.id}/availability`,
        { method: "PATCH", body: JSON.stringify({ isOnline: value }) }
      );
      updateUser({ isOnline: value });
    } catch {}
  };

  const doLogout = async () => {
    await logout();
    router.replace("/onboarding");
  };

  const handleLogout = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (Platform.OS === "web") {
      if (window.confirm("Are you sure you want to sign out?")) doLogout();
      return;
    }
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: doLogout },
    ]);
  };

  const handleSwitchRole = () => {
    Haptics.selectionAsync();
    if (Platform.OS === "web") {
      if (window.confirm("Switch to Sender mode? You'll choose your role again.")) doLogout();
      return;
    }
    Alert.alert(
      "Switch to Sender Mode",
      "You'll be taken back to choose your role.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Continue", onPress: doLogout },
      ]
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: C.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: C.text }]}>Profile</Text>

      <View style={[styles.profileCard, { backgroundColor: C.accent }]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.name?.charAt(0).toUpperCase() ?? "?"}
          </Text>
        </View>
        <Text style={styles.profileName}>{user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Porter"}</Text>
        <Text style={styles.profilePhone}>{user?.phone ?? user?.email ?? ""}</Text>
        <View style={styles.badgeRow}>
          <View style={styles.roleBadge}>
            <Feather name="truck" size={12} color={C.accent} />
            <Text style={[styles.roleText, { color: C.accent }]}>Porter</Text>
          </View>
          <View style={[styles.levelBadge, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
            <Feather name={level.icon as any} size={12} color={level.color} />
            <Text style={[styles.levelText, { color: level.color }]}>{level.label}</Text>
          </View>
        </View>
      </View>

      <View style={[styles.onlineCard, { backgroundColor: C.surface }]}>
        <View style={styles.onlineLeft}>
          <View
            style={[
              styles.onlineDot,
              { backgroundColor: user?.isOnline ? C.success : C.textTertiary },
            ]}
          />
          <View>
            <Text style={[styles.onlineTitle, { color: C.text }]}>
              {user?.isOnline ? "You're Online" : "You're Offline"}
            </Text>
            <Text style={[styles.onlineSub, { color: C.textSecondary }]}>
              {user?.isOnline
                ? "Visible to senders nearby"
                : "Toggle on to receive jobs"}
            </Text>
          </View>
        </View>
        <Switch
          value={!!user?.isOnline}
          onValueChange={handleToggleOnline}
          trackColor={{ false: C.border, true: C.success }}
          thumbColor="#fff"
        />
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: C.surface }]}>
          <Feather name="check-circle" size={18} color={C.success} />
          <Text style={[styles.statNum, { color: C.text }]}>{completed.length}</Text>
          <Text style={[styles.statLabel, { color: C.textSecondary }]}>Completed</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: C.surface }]}>
          <Feather name="dollar-sign" size={18} color={C.primary} />
          <Text style={[styles.statNum, { color: C.text }]}>
            {totalEarned > 0 ? `$${totalEarned.toFixed(0)}` : "—"}
          </Text>
          <Text style={[styles.statLabel, { color: C.textSecondary }]}>Earned</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: C.surface }]}>
          <Feather name="star" size={18} color={C.warning} />
          <Text style={[styles.statNum, { color: C.text }]}>
            {user?.rating?.toFixed(1) ?? "—"}
          </Text>
          <Text style={[styles.statLabel, { color: C.textSecondary }]}>Rating</Text>
        </View>
      </View>

      <View style={[styles.menuCard, { backgroundColor: C.surface }]}>
        <View style={[styles.menuItem, styles.menuItemRow]}>
          <Feather name="moon" size={20} color={C.accent} />
          <Text style={[styles.menuLabel, { color: C.text }]}>Dark Mode</Text>
          <Switch
            value={isDark}
            onValueChange={() => { Haptics.selectionAsync(); toggleTheme(); }}
            trackColor={{ false: C.border, true: C.primary }}
            thumbColor="#fff"
          />
        </View>
        <View style={[styles.divider, { backgroundColor: C.border }]} />
        <MenuItem icon="send" label="Switch to Sender" onPress={handleSwitchRole} color={C.primary} C={C} />
        <View style={[styles.divider, { backgroundColor: C.border }]} />
        <MenuItem icon="help-circle" label="Help & Support" onPress={() => {}} color={C.textSecondary} C={C} />
        <View style={[styles.divider, { backgroundColor: C.border }]} />
        <MenuItem icon="log-out" label="Sign Out" onPress={handleLogout} color={C.error} C={C} />
      </View>
    </ScrollView>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
  color,
  C,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  color: string;
  C: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.menuItem, { opacity: pressed ? 0.7 : 1 }]}
      onPress={onPress}
    >
      <Feather name={icon as any} size={20} color={color} />
      <Text style={[styles.menuLabel, { color: C.text }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={C.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 24 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  profileCard: {
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  avatarText: { color: "#fff", fontSize: 32, fontFamily: "Inter_700Bold" },
  profileName: { color: "#fff", fontSize: 22, fontFamily: "Inter_700Bold" },
  profilePhone: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  badgeRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  levelBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  levelText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  onlineCard: {
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  onlineLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  onlineDot: { width: 12, height: 12, borderRadius: 6 },
  onlineTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  onlineSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  statNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  menuCard: {
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 18,
  },
  menuItemRow: {
    justifyContent: "space-between",
  },
  menuLabel: { flex: 1, fontSize: 16, fontFamily: "Inter_500Medium" },
  divider: { height: 1, marginLeft: 54 },
});
