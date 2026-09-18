import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, radii, fonts } from '../lib/theme';

export default function ProfileScreen() {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      {user?.email && <Text style={styles.email}>{user.email}</Text>}

      <Pressable style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Déconnexion</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.cream, padding: 24 },
  email: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.gray, marginBottom: 24 },
  logoutButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.md,
    padding: 14,
    alignItems: 'center',
  },
  logoutText: { fontFamily: fonts.sansSemiBold, color: colors.danger, fontSize: 16 },
});
