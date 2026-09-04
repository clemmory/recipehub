import { useCallback, useLayoutEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { listRecipes, resolveUrl, type RecipeSummary } from '../lib/api';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RecipeList'>;

export default function RecipeListScreen() {
  const navigation = useNavigation<Nav>();
  const { token, logout } = useAuth();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      let cancelled = false;
      setLoading(true);
      listRecipes(token)
        .then((data) => {
          if (!cancelled) setRecipes(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load recipes');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [token]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('RecipeEdit', {})} hitSlop={8}>
          <Text style={[styles.headerAction, styles.headerActionRight]}>+ New</Text>
        </Pressable>
      ),
      headerLeft: () => (
        <Pressable onPress={logout} hitSlop={8}>
          <Text style={[styles.headerAction, styles.headerActionLeft]}>Log out</Text>
        </Pressable>
      ),
    });
  }, [navigation, logout]);

  if (loading && recipes.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (recipes.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No recipes yet — tap "+ New" to add one.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={recipes}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id })}>
          {item.photoUrl ? (
            <Image
              source={{ uri: resolveUrl(item.photoUrl), headers: { Authorization: `Bearer ${token}` } }}
              style={styles.thumbnail}
            />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailPlaceholder]} />
          )}
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>
              {[
                item.servings ? `${item.servings} servings` : null,
                item.prepTimeMin ? `${item.prepTimeMin} min prep` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  list: { padding: 16, gap: 12 },
  card: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 10, padding: 10, elevation: 1 },
  thumbnail: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#eee' },
  thumbnailPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, justifyContent: 'center', gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardMeta: { fontSize: 13, color: '#666' },
  headerAction: { color: '#2f6f3e', fontSize: 15, fontWeight: '600' },
  headerActionRight: { marginRight: 12 },
  headerActionLeft: { marginLeft: 12 },
  error: { color: '#c0392b' },
  emptyText: { color: '#666', textAlign: 'center' },
});
