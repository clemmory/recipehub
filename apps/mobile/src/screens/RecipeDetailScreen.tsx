import { useCallback, useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { deleteRecipe, getRecipe, resolveUrl, type RecipeDetail } from '../lib/api';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RecipeDetail'>;
type Route = RouteProp<RootStackParamList, 'RecipeDetail'>;

export default function RecipeDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { token } = useAuth();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      let cancelled = false;
      setLoading(true);
      getRecipe(token, route.params.recipeId)
        .then((data) => {
          if (!cancelled) setRecipe(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load recipe');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [token, route.params.recipeId]),
  );

  function handleDelete() {
    if (!token || !recipe) return;
    Alert.alert('Delete recipe', `Delete "${recipe.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteRecipe(token, recipe.id);
          navigation.goBack();
        },
      },
    ]);
  }

  if (loading && !recipe) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !recipe) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Recipe not found'}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {recipe.photoUrl ? (
        <Image
          source={{ uri: resolveUrl(recipe.photoUrl), headers: { Authorization: `Bearer ${token}` } }}
          style={styles.photo}
        />
      ) : null}

      <Text style={styles.title}>{recipe.title}</Text>

      <Text style={styles.meta}>
        {[
          recipe.servings ? `${recipe.servings} servings` : null,
          recipe.prepTimeMin ? `${recipe.prepTimeMin} min prep` : null,
          recipe.cookTimeMin ? `${recipe.cookTimeMin} min cook` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>

      {recipe.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {recipe.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Ingredients</Text>
      {recipe.ingredients.map((ing, i) => (
        <Text key={i} style={styles.listItem}>
          • {ing.quantity ? `${ing.quantity} ` : ''}
          {ing.name}
        </Text>
      ))}

      <Text style={styles.sectionTitle}>Steps</Text>
      {recipe.steps.map((step, i) => (
        <Text key={i} style={styles.listItem}>
          {i + 1}. {step}
        </Text>
      ))}

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.editButton]}
          onPress={() => navigation.navigate('RecipeEdit', { recipeId: recipe.id })}
        >
          <Text style={styles.editButtonText}>Edit</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.deleteButton]} onPress={handleDelete}>
          <Text style={styles.deleteButtonText}>Delete</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 16, gap: 8 },
  photo: { width: '100%', height: 220, borderRadius: 10, backgroundColor: '#eee', marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '700' },
  meta: { fontSize: 14, color: '#666' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { backgroundColor: '#e8f3ea', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: '#2f6f3e', fontSize: 12, fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 4 },
  listItem: { fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  button: { flex: 1, borderRadius: 8, padding: 14, alignItems: 'center' },
  editButton: { backgroundColor: '#2f6f3e' },
  editButtonText: { color: '#fff', fontWeight: '600' },
  deleteButton: { backgroundColor: '#fbeaea' },
  deleteButtonText: { color: '#c0392b', fontWeight: '600' },
  error: { color: '#c0392b' },
});
