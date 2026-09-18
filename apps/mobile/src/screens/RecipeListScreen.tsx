import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Image, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { createTag, deleteTag, listRecipes, listTags, resolveUrl, updateTag, type RecipeSummary, type Tag } from '../lib/api';
import { colors, radii, fonts } from '../lib/theme';
import Wordmark from '../components/Wordmark';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RecipeList'>;

type Collection = { id: string; tag: string; recipes: RecipeSummary[] };

// Every one of the user's collections shows up here, even one with zero
// recipes in it yet — a collection is a deliberately user-named grouping
// (like a photo album), not just a derived side effect of tagging recipes
// (decided 2026-09-14, see NOTES.md), so it must be creatable/manageable
// on its own.
function buildCollections(tags: Tag[], recipes: RecipeSummary[]): Collection[] {
  const recipesByTagName = new Map<string, RecipeSummary[]>();
  for (const recipe of recipes) {
    for (const tagName of recipe.tags) {
      if (!recipesByTagName.has(tagName)) recipesByTagName.set(tagName, []);
      recipesByTagName.get(tagName)!.push(recipe);
    }
  }
  return tags
    .map((t) => ({ id: t.id, tag: t.name, recipes: recipesByTagName.get(t.name) ?? [] }))
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
        <MaterialCommunityIcons name="food-variant" size={22} color={colors.cream} />
      )}
    </View>
  );
}

function CollectionMosaic({ recipes, token }: { recipes: RecipeSummary[]; token: string | null }) {
  const items = recipes.slice(0, 4);

  if (items.length === 0) {
    return (
      <View style={[styles.mosaic, styles.mosaicTile]}>
        <MaterialCommunityIcons name="food-variant" size={32} color={colors.cream} />
      </View>
    );
  }
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
  const { token } = useAuth();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'recipes' | 'collections'>('recipes');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showNewCollectionInput, setShowNewCollectionInput] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [renamingCollection, setRenamingCollection] = useState<Collection | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingInFlight, setRenamingInFlight] = useState(false);

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return Promise.all([listRecipes(token), listTags(token)])
      .then(([recipesData, tagsData]) => {
        setRecipes(recipesData);
        setTags(tagsData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Impossible de charger les recettes'))
      .finally(() => setLoading(false));
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const visibleRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = recipes;
    if (q) list = list.filter((r) => r.title.toLowerCase().includes(q));
    if (activeTag) list = list.filter((r) => r.tags.includes(activeTag));
    return [...list].sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  }, [recipes, search, activeTag]);

  const allCollections = useMemo(() => buildCollections(tags, recipes), [tags, recipes]);

  // Independent of `search`, so typing in the search bar while inside a
  // collection doesn't get mistaken for the collection itself being empty.
  const activeCollectionIsEmpty = activeTag ? !recipes.some((r) => r.tags.includes(activeTag)) : false;

  const visibleCollections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCollections;
    return allCollections.filter((c) => c.tag.toLowerCase().includes(q));
  }, [allCollections, search]);

  function selectView(next: 'recipes' | 'collections') {
    setView(next);
    setActiveTag(null);
    setSearch('');
    setShowNewCollectionInput(false);
    setRenamingCollection(null);
  }

  async function handleRenameCollection() {
    if (!renamingCollection || !token) return;
    const name = renameValue.trim();
    if (!name) return;
    setRenamingInFlight(true);
    try {
      await updateTag(token, renamingCollection.id, name);
      setActiveTag(name);
      setRenamingCollection(null);
      await refresh();
    } catch (err) {
      Alert.alert('Erreur', err instanceof Error ? err.message : 'Impossible de renommer la collection');
    } finally {
      setRenamingInFlight(false);
    }
  }

  function openCollection(tag: string) {
    setActiveTag(tag);
    setView('recipes');
    setSearch('');
  }

  async function handleCreateCollection() {
    const name = newCollectionName.trim();
    if (!token || !name) return;
    setCreatingCollection(true);
    try {
      await createTag(token, name);
      setNewCollectionName('');
      setShowNewCollectionInput(false);
      await refresh();
    } catch (err) {
      Alert.alert('Erreur', err instanceof Error ? err.message : 'Impossible de créer la collection');
    } finally {
      setCreatingCollection(false);
    }
  }

  function handleDeleteCollection(collection: Collection) {
    Alert.alert(
      'Supprimer la collection',
      `La collection "${collection.tag}" sera supprimée. Les recettes elles-mêmes ne seront pas supprimées.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            if (!token) return;
            try {
              await deleteTag(token, collection.id);
              setActiveTag(null);
              setView('collections');
              await refresh();
            } catch (err) {
              Alert.alert('Erreur', err instanceof Error ? err.message : 'Impossible de supprimer la collection');
            }
          },
        },
      ],
    );
  }

  const showEmptyState = !loading && !error && recipes.length === 0;
  const insets = useSafeAreaInsets();

  function handleAdd() {
    Alert.alert('', undefined, [
      { text: 'Nouvelle recette', onPress: () => navigation.navigate('RecipeEdit', {}) },
      { text: 'Importer depuis Instagram', onPress: () => navigation.navigate('Import') },
      {
        text: 'Nouvelle collection',
        onPress: () => {
          setView('collections');
          setShowNewCollectionInput(true);
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Wordmark align="left" size={34} tagline="Toutes vos recettes en un seul endroit" />
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

          {view === 'collections' && showNewCollectionInput && (
            <View style={styles.newCollectionRow}>
              <TextInput
                style={[styles.input, styles.newCollectionInput]}
                value={newCollectionName}
                onChangeText={setNewCollectionName}
                placeholder="Nom de la nouvelle collection"
                autoFocus
                onSubmitEditing={handleCreateCollection}
              />
              <Pressable
                style={styles.newCollectionButton}
                onPress={handleCreateCollection}
                disabled={creatingCollection || !newCollectionName.trim()}
              >
                {creatingCollection ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Feather name="check" size={18} color={colors.white} />
                )}
              </Pressable>
              <Pressable
                style={styles.newCollectionCancelButton}
                onPress={() => {
                  setShowNewCollectionInput(false);
                  setNewCollectionName('');
                }}
                hitSlop={8}
              >
                <Feather name="x" size={18} color={colors.gray} />
              </Pressable>
            </View>
          )}

          {activeTag && renamingCollection && (
            <View style={styles.newCollectionRow}>
              <TextInput
                style={[styles.input, styles.newCollectionInput]}
                value={renameValue}
                onChangeText={setRenameValue}
                placeholder="Nom de la collection"
                autoFocus
                onSubmitEditing={handleRenameCollection}
              />
              <Pressable
                style={styles.newCollectionButton}
                onPress={handleRenameCollection}
                disabled={renamingInFlight || !renameValue.trim()}
              >
                {renamingInFlight ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Feather name="check" size={18} color={colors.white} />
                )}
              </Pressable>
              <Pressable
                style={styles.newCollectionCancelButton}
                onPress={() => setRenamingCollection(null)}
                hitSlop={8}
              >
                <Feather name="x" size={18} color={colors.gray} />
              </Pressable>
            </View>
          )}

          {activeTag && !renamingCollection && (
            <View style={styles.activeTagRow}>
              <Pressable style={styles.activeTagChip} onPress={() => setActiveTag(null)}>
                <Text style={styles.activeTagText}>Collection : {activeTag} ✕</Text>
              </Pressable>
              <Pressable
                style={styles.activeTagIconButton}
                onPress={() => {
                  const collection = allCollections.find((c) => c.tag === activeTag);
                  if (collection) {
                    setRenamingCollection(collection);
                    setRenameValue(collection.tag);
                  }
                }}
                hitSlop={8}
              >
                <Feather name="edit-2" size={16} color={colors.greenDark} />
              </Pressable>
              <Pressable
                style={styles.activeTagIconButton}
                onPress={() => {
                  const collection = allCollections.find((c) => c.tag === activeTag);
                  if (collection) handleDeleteCollection(collection);
                }}
                hitSlop={8}
              >
                <Feather name="trash-2" size={16} color={colors.danger} />
              </Pressable>
            </View>
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
              {activeTag && activeCollectionIsEmpty ? (
                <>
                  <Text style={styles.emptySubtitle}>Cette collection est vide pour l'instant.</Text>
                  <Pressable
                    style={styles.addToCollectionButton}
                    onPress={() =>
                      navigation.navigate('RecipeEdit', {
                        draft: {
                          title: '',
                          ingredients: [],
                          steps: [],
                          prepTimeMin: null,
                          cookTimeMin: null,
                          servings: null,
                          tags: [activeTag],
                        },
                      })
                    }
                  >
                    <Feather name="plus" size={16} color={colors.white} />
                    <Text style={styles.addToCollectionButtonText}>Ajouter une recette</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.emptySubtitle}>Aucune recette ne correspond.</Text>
              )}
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
                      <MaterialCommunityIcons name="food-variant" size={48} color={colors.cream} />
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
                    {item.prepTimeMin ? (
                      <View style={styles.cardTimeRow}>
                        <Feather name="clock" size={11} color={colors.gray} />
                        <Text style={styles.cardTimeText}>{item.prepTimeMin} min</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              )}
            />
          )
        ) : visibleCollections.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptySubtitle}>
              {allCollections.length === 0
                ? 'Aucune collection pour l\'instant — crée-en une avec le bouton "+".'
                : 'Aucune collection ne correspond.'}
            </Text>
          </View>
        ) : (
          <FlatList
            key="collections-grid"
            data={visibleCollections}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={styles.list}
            columnWrapperStyle={styles.gridRow}
            renderItem={({ item, index }) => (
              <Pressable style={styles.boardCard} onPress={() => openCollection(item.tag)}>
                <CollectionMosaic recipes={item.recipes} token={token} />
                <View style={styles.boardMeta}>
                  <Text style={styles.boardChapter}>{String(index + 1).padStart(2, '0')}</Text>
                  <Text style={styles.boardName}>{item.tag}</Text>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>

      <View style={styles.addButtonWrap} pointerEvents="box-none">
        <Pressable style={styles.addButton} onPress={handleAdd} hitSlop={8}>
          <Feather name="plus" size={26} color={colors.white} />
        </Pressable>
      </View>

      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable style={styles.navItem} onPress={() => selectView('collections')} hitSlop={8}>
          <Feather name="book-open" size={22} color={view === 'collections' ? colors.terracottaDark : colors.charcoal} />
        </Pressable>
        <Pressable style={styles.navItem} onPress={() => navigation.navigate('Profile')} hitSlop={8}>
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
    gap: 20,
    marginHorizontal: 16,
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toggleBtn: { paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  toggleBtnActive: { borderBottomColor: colors.terracotta },
  toggleText: { fontFamily: fonts.sansBold, fontSize: 16, color: colors.gray },
  toggleTextActive: { color: colors.terracottaDark },
  activeTagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 12 },
  activeTagChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.terracotta,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  activeTagText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: colors.terracottaDark },
  activeTagIconButton: { padding: 4 },
  newCollectionRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginHorizontal: 16, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 10,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    backgroundColor: colors.white,
    color: colors.charcoal,
  },
  newCollectionInput: { flex: 1 },
  newCollectionButton: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newCollectionCancelButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 14 },
  gridRow: { justifyContent: 'space-between' },
  card: {
    width: '48%',
    backgroundColor: colors.white,
    borderRadius: 16,
    shadowColor: colors.charcoal,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardPhoto: {
    height: 160,
    backgroundColor: colors.ochre,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  cardPhotoImage: { width: '100%', height: '100%' },
  cardInfo: { padding: 10 },
  cardTitle: { fontFamily: fonts.serifBold, fontSize: 13, color: colors.charcoal, marginBottom: 6 },
  tagChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  tagChip: { backgroundColor: colors.cream, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 3 },
  tagChipText: { fontFamily: fonts.sansSemiBold, fontSize: 9, color: colors.greenDark },
  cardTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardTimeText: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.gray },
  boardCard: { width: '48%', gap: 8 },
  mosaic: { height: 160, borderRadius: radii.md, overflow: 'hidden' },
  mosaicRow: { flexDirection: 'row', gap: 3 },
  mosaicCol: { flexDirection: 'column', gap: 3 },
  mosaicMain: { flex: 1.4 },
  mosaicTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ochre },
  mosaicImage: { width: '100%', height: '100%' },
  boardMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingLeft: 2 },
  boardChapter: { fontFamily: fonts.serifMediumItalic, fontSize: 13, color: colors.terracottaDark, minWidth: 18 },
  boardName: { fontFamily: fonts.serifBold, fontSize: 15, color: colors.charcoal, lineHeight: 18 },
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
  addToCollectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.terracotta,
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 14,
  },
  addToCollectionButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.white },
  addButtonWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 92,
    alignItems: 'center',
  },
  addButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
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
