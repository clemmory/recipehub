import { useCallback, useMemo, useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { deleteRecipe, getRecipe, resolveUrl, type RecipeDetail } from '../lib/api';
import { colors, radii, fonts, NO_PHOTO_EMOJI } from '../lib/theme';

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
          if (!cancelled) setError(err instanceof Error ? err.message : 'Impossible de charger la recette');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [token, route.params.recipeId]),
  );

  // Groups consecutive ingredients sharing the same section (e.g. "Pour la
  // pâte") so the same ingredient can appear more than once in the list
  // (different section, different quantity) without looking like a
  // duplicate — see NOTES.md, 2026-09-11.
  const ingredientGroups = useMemo(() => {
    const groups: { section: string | null; items: RecipeDetail['ingredients'] }[] = [];
    for (const ing of recipe?.ingredients ?? []) {
      const last = groups[groups.length - 1];
      if (last && last.section === ing.section) {
        last.items.push(ing);
      } else {
        groups.push({ section: ing.section, items: [ing] });
      }
    }
    return groups;
  }, [recipe]);

  function handleDelete() {
    if (!token || !recipe) return;
    Alert.alert('Supprimer la recette', `Supprimer « ${recipe.title} » ? Cette action est irréversible.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
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
        <Text style={styles.error}>{error ?? 'Recette introuvable'}</Text>
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
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]}>
          <Text style={styles.photoPlaceholderEmoji}>{NO_PHOTO_EMOJI}</Text>
        </View>
      )}

      <Text style={styles.title}>{recipe.title}</Text>

      <Text style={styles.meta}>
        {[
          recipe.servings ? `${recipe.servings} portions` : null,
          recipe.prepTimeMin ? `${recipe.prepTimeMin} min préparation` : null,
          recipe.cookTimeMin ? `${recipe.cookTimeMin} min cuisson` : null,
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

      {recipe.source ? (
        /^https?:\/\//i.test(recipe.source) ? (
          <Pressable onPress={() => Linking.openURL(recipe.source!)}>
            <Text style={styles.sourceLink} numberOfLines={1}>
              {recipe.source}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.source}>{recipe.source}</Text>
        )
      ) : null}

      <Text style={styles.sectionTitle}>Ingrédients</Text>
      {ingredientGroups.map((group, gi) => (
        <View key={gi}>
          {group.section ? <Text style={styles.ingredientSection}>{group.section}</Text> : null}
          {group.items.map((ing, i) => (
            <Text key={i} style={styles.listItem}>
              • {ing.quantity ? `${ing.quantity} ` : ''}
              {ing.name}
            </Text>
          ))}
        </View>
      ))}

      <Text style={styles.sectionTitle}>Étapes</Text>
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
          <Text style={styles.editButtonText}>Modifier</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.deleteButton]} onPress={handleDelete}>
          <Text style={styles.deleteButtonText}>Supprimer</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.cream },
  container: { padding: 16, gap: 8, backgroundColor: colors.cream, flexGrow: 1 },
  photo: { width: '100%', height: 220, borderRadius: radii.lg, backgroundColor: colors.border, marginBottom: 8 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  photoPlaceholderEmoji: { fontSize: 48 },
  title: { fontFamily: fonts.serifBold, fontSize: 26, color: colors.charcoal },
  meta: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.gray },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.green, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { fontFamily: fonts.sansSemiBold, color: colors.greenDark, fontSize: 12 },
  source: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.gray, marginTop: 6 },
  sourceLink: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.terracottaDark, marginTop: 6 },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.charcoal, marginTop: 16, marginBottom: 4 },
  ingredientSection: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    color: colors.terracottaDark,
    marginTop: 10,
    marginBottom: 2,
  },
  listItem: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 22, color: colors.charcoal },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  button: { flex: 1, borderRadius: radii.md, padding: 14, alignItems: 'center' },
  editButton: { backgroundColor: colors.terracotta },
  editButtonText: { fontFamily: fonts.sansSemiBold, color: colors.white },
  deleteButton: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.danger },
  deleteButtonText: { fontFamily: fonts.sansSemiBold, color: colors.danger },
  error: { fontFamily: fonts.sansMedium, color: colors.danger },
});
