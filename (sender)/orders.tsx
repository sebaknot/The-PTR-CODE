import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
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

type FilterStatus = "all" | "active" | "delivered" | "cancelled";

const FILTERS: { id: FilterStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "delivered", label: "Delivered" },
  { id: "cancelled", label: "Cancelled" },
];

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const C = useColors();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [filter, setFilter] = useState<FilterStatus>("all");

  const { data, isLoading, refetch, isRefetching } = useListDeliveries(
    { senderId: user?.id },
    { query: { enabled: !!user?.id, refetchInterval: 10000 } }
  );

  const allDeliveries = data?.deliveries ?? [];
  const filtered = allDeliveries.filter((d) => {
    if (filter === "all") return true;
    if (filter === "active")
      return ["pending", "in_box", "accepted", "picked_up"].includes(d.status);
    return d.status === filter;
  });

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.title, { color: C.text }]}>My Orders</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {FILTERS.map((f) => (
            <Pressable
              key={f.id}
              style={[
                styles.filterBtn,
                {
                  backgroundColor: filter === f.id ? C.primary : C.surface,
                  borderColor: filter === f.id ? C.primary : C.border,
                },
              ]}
              onPress={() => setFilter(f.id)}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filter === f.id ? "#fff" : C.textSecondary },
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 100 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={C.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 60 }} />
        ) : filtered.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: C.surface }]}>
            <Feather name="inbox" size={48} color={C.textTertiary} />
            <Text style={[styles.emptyTitle, { color: C.text }]}>No orders yet</Text>
            <Text style={[styles.emptySub, { color: C.textSecondary }]}>
              Your delivery history will appear here
            </Text>
          </View>
        ) : (
          filtered.map((d) => (
            <DeliveryCard key={d.id} delivery={d} role="sender" />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, gap: 16, paddingBottom: 8 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  filters: { flexDirection: "row", gap: 8, paddingBottom: 4 },
  filterBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  filterText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  list: { paddingHorizontal: 20, paddingTop: 16, gap: 14 },
  emptyCard: {
    borderRadius: 20,
    padding: 48,
    alignItems: "center",
    gap: 12,
    marginTop: 40,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  emptySub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
});
