import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useListDeliveries } from "@workspace/api-client-react";
import { useColors } from "@/context/ThemeContext";
import { useUser } from "@/context/UserContext";
import { DeliveryCard } from "@/components/DeliveryCard";

function getStartOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getStartOfWeek() {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function PorterHistoryScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const C = useColors();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const { data, isLoading, refetch, isRefetching } = useListDeliveries(
    { courierId: user?.id },
    {
      query: {
        enabled: !!user?.id,
        select: (d) => ({
          deliveries: d.deliveries.filter((del) =>
            ["delivered", "cancelled"].includes(del.status)
          ),
        }),
      },
    }
  );

  const history = data?.deliveries ?? [];
  const completed = history.filter((d) => d.status === "delivered");
  const totalEarned = completed.reduce((sum, d) => sum + d.estimatedPrice, 0);

  const startOfDay = getStartOfDay();
  const startOfWeek = getStartOfWeek();
  const todayEarned = completed
    .filter((d) => d.createdAt && new Date(d.createdAt).getTime() >= startOfDay)
    .reduce((sum, d) => sum + d.estimatedPrice, 0);
  const weekEarned = completed
    .filter((d) => d.createdAt && new Date(d.createdAt).getTime() >= startOfWeek)
    .reduce((sum, d) => sum + d.estimatedPrice, 0);

  const avgPerDelivery = completed.length > 0 ? totalEarned / completed.length : 0;

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={C.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: C.text }]}>Earnings</Text>

        <View style={[styles.bigCard, { backgroundColor: C.accent }]}>
          <View style={styles.bigCardTop}>
            <View>
              <Text style={styles.bigLabel}>Total Earned</Text>
              <Text style={styles.bigValue}>${totalEarned.toFixed(2)}</Text>
            </View>
            <View style={[styles.bigIcon, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
              <Feather name="trending-up" size={24} color="#fff" />
            </View>
          </View>
          <View style={styles.bigDivider} />
          <View style={styles.bigCardStats}>
            <View style={styles.bigStatCol}>
              <Text style={styles.bigStatValue}>{completed.length}</Text>
              <Text style={styles.bigStatLabel}>Deliveries</Text>
            </View>
            <View style={styles.bigStatDivider} />
            <View style={styles.bigStatCol}>
              <Text style={styles.bigStatValue}>
                {avgPerDelivery > 0 ? `$${avgPerDelivery.toFixed(2)}` : "—"}
              </Text>
              <Text style={styles.bigStatLabel}>Avg / Trip</Text>
            </View>
            <View style={styles.bigStatDivider} />
            <View style={styles.bigStatCol}>
              <Text style={styles.bigStatValue}>
                {user?.rating != null ? user.rating.toFixed(1) : "—"}
              </Text>
              <Text style={styles.bigStatLabel}>Rating</Text>
            </View>
          </View>
        </View>

        <View style={styles.periodRow}>
          <View style={[styles.periodCard, { backgroundColor: C.surface }]}>
            <Feather name="sun" size={16} color={C.warning} />
            <Text style={[styles.periodLabel, { color: C.textSecondary }]}>Today</Text>
            <Text style={[styles.periodValue, { color: C.text }]}>
              ${todayEarned.toFixed(2)}
            </Text>
          </View>
          <View style={[styles.periodCard, { backgroundColor: C.surface }]}>
            <Feather name="calendar" size={16} color={C.primary} />
            <Text style={[styles.periodLabel, { color: C.textSecondary }]}>This Week</Text>
            <Text style={[styles.periodValue, { color: C.text }]}>
              ${weekEarned.toFixed(2)}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: C.text }]}>Recent Deliveries</Text>

        {isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
        ) : completed.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: C.surface }]}>
            <Feather name="clock" size={48} color={C.textTertiary} />
            <Text style={[styles.emptyTitle, { color: C.text }]}>No History Yet</Text>
            <Text style={[styles.emptySub, { color: C.textSecondary }]}>
              Your completed deliveries will appear here
            </Text>
          </View>
        ) : (
          completed.map((d) => (
            <DeliveryCard key={d.id} delivery={d} role="courier" />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  bigCard: {
    borderRadius: 24,
    padding: 22,
    gap: 16,
  },
  bigCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bigLabel: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  bigValue: { color: "#fff", fontSize: 36, fontFamily: "Inter_700Bold" },
  bigIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  bigDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.2)" },
  bigCardStats: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  bigStatCol: { alignItems: "center", gap: 4, flex: 1 },
  bigStatValue: { color: "#fff", fontSize: 20, fontFamily: "Inter_700Bold" },
  bigStatLabel: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  bigStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  periodRow: { flexDirection: "row", gap: 12 },
  periodCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  periodLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  periodValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyCard: {
    borderRadius: 20,
    padding: 48,
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  emptySub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
});
