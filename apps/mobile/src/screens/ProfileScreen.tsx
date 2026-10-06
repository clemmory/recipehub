import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import BottomNav from '../components/BottomNav';
import AddRecipeSheet from '../components/AddRecipeSheet';
import { openAddChoice } from '../lib/addMenu';
import { colors, radii, fonts } from '../lib/theme';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  return (
    <View style={styles.screen}>
      <View style={styles.container}>
        {user?.email && <Text style={styles.email}>{user.email}</Text>}

        <Pressable style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>Déconnexion</Text>
        </Pressable>
      </View>

      <AddRecipeSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onChoose={(choice) => {
          if (choice !== 'existing') openAddChoice(navigation, choice);
        }}
      />

      {/* Profile is a bottom-nav destination, not a pushed detail screen:
          going back to the recipe list goes through the bar, not a back
          button (hidden in RootNavigator). */}
      <BottomNav
        active="profile"
        onRecipesPress={() => navigation.popTo('RecipeList')}
        onAddPress={() => setAddSheetOpen(true)}
        onProfilePress={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  container: { flex: 1, padding: 24 },
  email: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.text2, marginBottom: 24 },
  logoutButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.md,
    padding: 14,
    alignItems: 'center',
  },
  logoutText: { fontFamily: fonts.sansSemiBold, color: colors.danger, fontSize: 16 },
});
