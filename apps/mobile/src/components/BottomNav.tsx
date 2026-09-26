import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';

export type BottomNavTab = 'collections' | 'profile';

type Props = {
  active: BottomNavTab;
  onCollectionsPress: () => void;
  onProfilePress: () => void;
};

// Shared between RecipeListScreen and ProfileScreen. Convention: the icon of
// the current screen is filled, the others are outlined — all from the same
// icon set (Ionicons) so each filled/outline pair is the same glyph.
export default function BottomNav({ active, onCollectionsPress, onProfilePress }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <Pressable style={styles.navItem} onPress={onCollectionsPress} hitSlop={8}>
        <Ionicons name={active === 'collections' ? 'book' : 'book-outline'} size={22} color={colors.terracotta} />
      </Pressable>
      <Pressable style={styles.navItem} onPress={onProfilePress} hitSlop={8}>
        <Ionicons name={active === 'profile' ? 'person' : 'person-outline'} size={22} color={colors.terracotta} />
      </Pressable>
      {/* No screen behind "Partager" yet. */}
      <Pressable style={styles.navItem} hitSlop={8}>
        <Ionicons name="share-social-outline" size={22} color={colors.terracotta} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomNav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.cream,
    paddingTop: 12,
    marginTop: 10,
  },
  navItem: { flex: 1, alignItems: 'center' },
});
