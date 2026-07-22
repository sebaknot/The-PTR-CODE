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
import { useUser } from "@/context/UserContext";

function getMemberLevel(count: number): { label: string; color: string; icon: string } {
  if (count >= 50) return { label: "Platinum", color: "#A78BFA", icon: "award" };
  if (count >= 20) return { label: "Gold", color: "#F59E0B", icon: "star" };
  if (count >= 5) return { label: "Silver", color: "#94A3B8", icon: "shield" };
  return { label: "Bronze", color: "#D97706", icon: "user" };
}

export default function SenderProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useUser();
  const C = useColors();
  const { isDark, toggleTheme } = useTheme();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const { data } = useListDeliveries(
    { senderId: user?.id },
    { query: { enabled: !!user?.id } }
  );

  const deliveries = data?.deliveries ?? [];
  const completed = deliveries.filter((d) => d.status === "delivered");
  const totalSpent = completed.reduce((sum, d) => sum + d.estimatedPrice, 0);
  const level = getMemberLevel(completed.length);

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
      if (window.confirm("Switch to Porter mode? You'll choose your role again.")) doLogout();
      return;
    }
    Alert.alert(
      "Switch to Porter Mode",
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

      <View style={[styles.profileCard, { backgroundColor: C.primary }]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.name?.charAt(0).toUpperCase() ?? "?"}
          </Text>
        </View>
        <Text style={styles.profileName}>{user?.name}</Text>
        <Text style={styles.profilePhone}>{user?.phone}</Text>
        <View style={styles.badgeRow}>
          <View style={styles.roleBadge}>
            <Feather name="send" size={12} color={C.primary} />
            <Text style={[styles.roleText, { color: C.primary }]}>Sender</Text>
          </View>
          <View style={[styles.levelBadge, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
            <Feather name={level.icon as any} size={12} color={level.color} />
            <Text style={[styles.levelText, { color: level.color }]}>{level.label}</Text>
          </View>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: C.surface }]}>
          <Feather name="package" size={18} color={C.primary} />
          <Text style={[styles.statNum, { color: C.text }]}>{completed.length}</Text>
          <Text style={[styles.statLabel, { color: C.textSecondary }]}>Delivered</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: C.surface }]}>
          <Feather name="dollar-sign" size={18} color={C.success} />
          <Text style={[styles.statNum, { color: C.text }]}>
            {totalSpent > 0 ? `$${totalSpent.toFixed(0)}` : "—"}
          </Text>
          <Text style={[styles.statLabel, { color: C.textSecondary }]}>Spent</Text>
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
        <MenuItem icon="truck" label="Switch to Porter" onPress={handleSwitchRole} color={C.accent} C={C} />
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
