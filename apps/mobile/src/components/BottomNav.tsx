import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';

export type BottomNavTab = 'recipes' | 'profile';

type Props = {
  active: BottomNavTab;
  onRecipesPress: () => void;
  onAddPress: () => void;
  onProfilePress: () => void;
};

// Shared between RecipeListScreen and ProfileScreen: Recettes · + · Profil,
// icons only (2026-09-30 redesign — "Partager" removed until Phase 4). The
// current screen's icon is filled in ink, the other outlined in gray.
export default function BottomNav({ active, onRecipesPress, onAddPress, onProfilePress }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <Pressable style={styles.navItem} onPress={onRecipesPress} hitSlop={8} accessibilityLabel="Recettes">
        <Ionicons
          name={active === 'recipes' ? 'document-text' : 'document-text-outline'}
          size={24}
          color={active === 'recipes' ? colors.ink : colors.navInactive}
        />
      </Pressable>
      <Pressable style={styles.addButton} onPress={onAddPress} accessibilityLabel="Ajouter">
        <Feather name="plus" size={26} color={colors.white} />
      </Pressable>
      <Pressable style={styles.navItem} onPress={onProfilePress} hitSlop={8} accessibilityLabel="Profil">
        <Ionicons
          name={active === 'profile' ? 'person' : 'person-outline'}
          size={24}
          color={active === 'profile' ? colors.ink : colors.navInactive}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.white,
    paddingTop: 10,
  },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 44 },
  addButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
