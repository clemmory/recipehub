import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Image, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { listRecipes, resolveUrl, type RecipeSummary } from '../lib/api';
import { colors, radii, fonts, NO_PHOTO_EMOJI } from '../lib/theme';
import Wordmark from '../components/Wordmark';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RecipeList'>;

type Collection = { tag: string; recipes: RecipeSummary[] };

function buildCollections(recipes: RecipeSummary[]): Collection[] {
  const byTag = new Map<string, RecipeSummary[]>();
  for (const recipe of recipes) {
    for (const tag of recipe.tags) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(recipe);
    }
  }
  return Array.from(byTag.entries())
    .map(([tag, tagRecipes]) => ({ tag, recipes: tagRecipes }))
    .sort((a, b) => a.tag.localeCompare(b.tag, 'fr'));
}

function MosaicTile({
  recipe,
  token,
  style,
}: {
  recipe: RecipeSummary;
  token: string | null;
  style?: object;
}) {
  return (
    <View style={[styles.mosaicTile, style]}>
      {recipe.photoUrl ? (
        <Image
          source={{ uri: resolveUrl(recipe.photoUrl), headers: { Authorization: `Bearer ${token}` } }}
          style={styles.mosaicImage}
        />
      ) : (
        <Text style={styles.mosaicEmoji}>{NO_PHOTO_EMOJI}</Text>
      )}
    </View>
  );
}

function CollectionMosaic({ recipes, token }: { recipes: RecipeSummary[]; token: string | null }) {
  const items = recipes.slice(0, 4);

  if (items.length === 1) {
    return (
      <View style={styles.mosaic}>
        <MosaicTile recipe={items[0]} token={token} style={styles.flex1} />
      </View>
    );
  }
  if (items.length === 2) {
    return (
      <View style={[styles.mosaic, styles.mosaicRow]}>
        <MosaicTile recipe={items[0]} token={token} style={styles.flex1} />
        <MosaicTile recipe={items[1]} token={token} style={styles.flex1} />
      </View>
    );
  }
  if (items.length === 3) {
    return (
      <View style={[styles.mosaic, styles.mosaicRow]}>
        <MosaicTile recipe={items[0]} token={token} style={styles.mosaicMain} />
        <View style={[styles.mosaicCol, styles.flex1]}>
          <MosaicTile recipe={items[1]} token={token} style={styles.flex1} />
          <MosaicTile recipe={items[2]} token={token} style={styles.flex1} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.mosaic, styles.mosaicCol]}>
      <View style={[styles.mosaicRow, styles.flex1]}>
        <MosaicTile recipe={items[0]} token={token} style={styles.flex1} />
        <MosaicTile recipe={items[1]} token={token} style={styles.flex1} />
      </View>
      <View style={[styles.mosaicRow, styles.flex1]}>
        <MosaicTile recipe={items[2]} token={token} style={styles.flex1} />
        <MosaicTile recipe={items[3]} token={token} style={styles.flex1} />
      </View>
    </View>
  );
}

export default function RecipeListScreen() {
  const navigation = useNavigation<Nav>();
  const { token, logout } = useAuth();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'recipes' | 'collections'>('recipes');
  const [activeTag, setActiveTag] = useState<string | null>(null);

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
          if (!cancelled) setError(err instanceof Error ? err.message : 'Impossible de charger les recettes');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [token]),
  );

  const visibleRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = recipes;
    if (q) list = list.filter((r) => r.title.toLowerCase().includes(q));
    if (activeTag) list = list.filter((r) => r.tags.includes(activeTag));
    return list;
  }, [recipes, search, activeTag]);

  const allCollections = useMemo(() => buildCollections(recipes), [recipes]);

  const visibleCollections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCollections;
    return allCollections.filter((c) => c.tag.toLowerCase().includes(q));
  }, [allCollections, search]);

  function selectView(next: 'recipes' | 'collections') {
    setView(next);
    setActiveTag(null);
    setSearch('');
  }

  function openCollection(tag: string) {
    setActiveTag(tag);
    setView('recipes');
    setSearch('');
  }

  const showEmptyState = !loading && !error && recipes.length === 0;
  const insets = useSafeAreaInsets();

  function goToAdd() {
    navigation.navigate('RecipeEdit', {});
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Wordmark align="left" tagline="Toutes vos recettes en un seul endroit" />
        <Pressable onPress={logout} hitSlop={8}>
          <Text style={styles.logoutText}>Déconnexion</Text>
        </Pressable>
      </View>

      {!showEmptyState && (
        <>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              placeholder={view === 'collections' ? 'Rechercher une collection...' : 'Rechercher une recette...'}
              placeholderTextColor={colors.gray}
              value={search}
              onChangeText={setSearch}
            />
          </View>

          <View style={styles.viewToggle}>
            <Pressable
              style={[styles.toggleBtn, view === 'recipes' && styles.toggleBtnActive]}
              onPress={() => selectView('recipes')}
            >
              <Text style={[styles.toggleText, view === 'recipes' && styles.toggleTextActive]}>Recettes</Text>
            </Pressable>
            <Pressable
              style={[styles.toggleBtn, view === 'collections' && styles.toggleBtnActive]}
              onPress={() => selectView('collections')}
            >
              <Text style={[styles.toggleText, view === 'collections' && styles.toggleTextActive]}>Collections</Text>
            </Pressable>
          </View>

          {activeTag && (
            <Pressable style={styles.activeTagChip} onPress={() => setActiveTag(null)}>
              <Text style={styles.activeTagText}>Collection : {activeTag} ✕</Text>
            </Pressable>
          )}
        </>
      )}

      <View style={styles.flex1}>
        {loading && recipes.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : showEmptyState ? (
          <View style={styles.center}>
            <Text style={styles.emptyEmoji}>📖</Text>
            <Text style={styles.emptyTitle}>Prêt à enregistrer votre première recette ?</Text>
            <Text style={styles.emptySubtitle}>Appuyez sur "+" pour commencer votre collection.</Text>
          </View>
        ) : view === 'recipes' ? (
          visibleRecipes.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptySubtitle}>Aucune recette ne correspond.</Text>
            </View>
          ) : (
            <FlatList
              key="recipes-grid"
              data={visibleRecipes}
              keyExtractor={(item) => item.id}
              numColumns={2}
              contentContainerStyle={styles.list}
              columnWrapperStyle={styles.gridRow}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.card}
                  onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id })}
                >
                  <View style={styles.cardPhoto}>
                    {item.photoUrl ? (
                      <Image
                        source={{ uri: resolveUrl(item.photoUrl), headers: { Authorization: `Bearer ${token}` } }}
                        style={styles.cardPhotoImage}
                      />
                    ) : (
                      <Text style={styles.cardPhotoEmoji}>{NO_PHOTO_EMOJI}</Text>
                    )}
                  </View>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {item.tags.length > 0 && (
                      <View style={styles.tagChipRow}>
                        {item.tags.map((tag) => (
                          <View key={tag} style={styles.tagChip}>
                            <Text style={styles.tagChipText}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </Pressable>
              )}
            />
          )
        ) : visibleCollections.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptySubtitle}>
              {allCollections.length === 0
                ? "Aucun tag pour l'instant — ajoute des tags à tes recettes."
                : 'Aucune collection ne correspond.'}
            </Text>
          </View>
        ) : (
          <FlatList
            key="collections-grid"
            data={visibleCollections}
            keyExtractor={(item) => item.tag}
            numColumns={2}
            contentContainerStyle={styles.list}
            columnWrapperStyle={styles.gridRow}
            renderItem={({ item, index }) => (
              <Pressable style={styles.boardCard} onPress={() => openCollection(item.tag)}>
                <CollectionMosaic recipes={item.recipes} token={token} />
                <View style={styles.boardMeta}>
                  <Text style={styles.boardChapter}>{String(index + 1).padStart(2, '0')}</Text>
                  <View>
                    <Text style={styles.boardName}>{item.tag}</Text>
                    <Text style={styles.boardCount}>
                      {item.recipes.length} recette{item.recipes.length > 1 ? 's' : ''}
                    </Text>
                  </View>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>

      <Pressable style={styles.addButton} onPress={goToAdd} hitSlop={8}>
        <Feather name="plus" size={26} color={colors.white} />
      </Pressable>

      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable style={styles.navItem} onPress={() => selectView('collections')} hitSlop={8}>
          <Feather name="grid" size={22} color={view === 'collections' ? colors.terracottaDark : colors.charcoal} />
        </Pressable>
        <Pressable style={styles.navItem} hitSlop={8}>
          <Feather name="user" size={22} color={colors.charcoal} />
        </Pressable>
        <Pressable style={styles.navItem} hitSlop={8}>
          <Feather name="share-2" size={22} color={colors.charcoal} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  logoutText: { fontFamily: fonts.sansSemiBold, color: colors.greenDark, fontSize: 13, marginTop: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    marginTop: 14,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontFamily: fonts.sansMedium, fontSize: 14, color: colors.charcoal },
  viewToggle: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderRadius: radii.sm,
    padding: 3,
    marginHorizontal: 16,
    marginTop: 12,
  },
  toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radii.sm - 2 },
  toggleBtnActive: { backgroundColor: colors.white },
  toggleText: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.gray },
  toggleTextActive: { color: colors.terracottaDark },
  activeTagChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.terracotta,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 16,
    marginTop: 12,
  },
  activeTagText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: colors.terracottaDark },
  list: { padding: 16, gap: 14 },
  gridRow: { justifyContent: 'space-between' },
  card: { width: '48%', backgroundColor: colors.white, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cardPhoto: { height: 90, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  cardPhotoImage: { width: '100%', height: '100%' },
  cardPhotoEmoji: { fontSize: 30 },
  cardInfo: { padding: 10 },
  cardTitle: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.charcoal, marginBottom: 6 },
  tagChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tagChip: { backgroundColor: colors.cream, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 3 },
  tagChipText: { fontFamily: fonts.sansSemiBold, fontSize: 9, color: colors.greenDark },
  boardCard: { width: '48%', gap: 8 },
  mosaic: { height: 100, borderRadius: radii.md, overflow: 'hidden' },
  mosaicRow: { flexDirection: 'row', gap: 3 },
  mosaicCol: { flexDirection: 'column', gap: 3 },
  mosaicMain: { flex: 1.4 },
  mosaicTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  mosaicImage: { width: '100%', height: '100%' },
  mosaicEmoji: { fontSize: 22 },
  boardMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingLeft: 2 },
  boardChapter: { fontFamily: fonts.serifMediumItalic, fontSize: 13, color: colors.terracottaDark, minWidth: 18 },
  boardName: { fontFamily: fonts.serifBold, fontSize: 15, color: colors.charcoal, lineHeight: 18 },
  boardCount: { fontFamily: fonts.sansMedium, fontSize: 10.5, color: colors.gray, marginTop: 1 },
  error: { fontFamily: fonts.sansMedium, color: colors.danger },
  emptyEmoji: { fontSize: 56, marginBottom: 12 },
  emptyTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 18,
    color: colors.charcoal,
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySubtitle: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.gray, textAlign: 'center' },
  addButton: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  bottomNav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingTop: 12,
    marginTop: 10,
  },
  navItem: { flex: 1, alignItems: 'center' },
});
