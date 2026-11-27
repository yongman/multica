import { View } from "react-native";
import { Header } from "@/components/ui/header";
import PinsList from "@/components/pins/pins-list";
import { useT } from "@/lib/i18n";

export default function PinsPage() {
  const { t } = useT("navigation");

  return (
    <View className="flex-1 bg-background">
      <Header title={t("routes.pinned")} />
      <PinsList />
    </View>
  );
}
