import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Image,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import BottomNav from '../components/BottomNav';
import RecipeCover from '../components/RecipeCover';
import {
  createTag,
  deleteTag,
  getRecipe,
  listRecipes,
  listTags,
  recipeInputFrom,
  resolveUrl,
  updateRecipe,
  updateTag,
  type RecipeSummary,
  type Tag,
} from '../lib/api';
import { openAddChoice } from '../lib/addMenu';
import AddRecipeSheet, { type AddChoice } from '../components/AddRecipeSheet';
import { DashedTile, InlineNameField } from '../components/ui';
import { colors, radii, fonts, labelText } from '../lib/theme';
import Wordmark from '../components/Wordmark';
import { matchesSearch } from '../lib/text';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RecipeList'>;

type Collection = { id: string; tag: string; recipes: RecipeSummary[] };
// Last item of the Collections grid: the « + Nouvelle collection » tile.
const NEW_COLLECTION_TILE = { id: '__new-collection' } as const;

type View_ = 'recipes' | 'collections' | 'favorites';

const SIDE = 20;
const GUTTER = 12;

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

function totalMinutes(recipe: RecipeSummary) {
  const total = (recipe.prepTimeMin ?? 0) + (recipe.cookTimeMin ?? 0);
  return total > 0 ? total : null;
}

// "Desserts · 50 min" — first tag only (no "main" tag, the detail screen
// shows them all) + total time when known.
function metaLine(recipe: RecipeSummary) {
  const minutes = totalMinutes(recipe);
  return [recipe.tags[0], minutes ? `${minutes} min` : null].filter(Boolean).join(' · ');
}

function plural(n: number, word: string) {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

function RecipePhoto({
  recipe,
  token,
  height,
  iconSize,
  children,
}: {
  recipe: RecipeSummary;
  token: string | null;
  height: number;
  iconSize: number;
  children?: React.ReactNode;
}) {
  if (!recipe.photoUrl) {
    return (
      <RecipeCover tags={recipe.tags} iconSize={iconSize} style={[styles.photo, { height }]}>
        {children}
      </RecipeCover>
    );
  }
  return (
    <Image
      source={{ uri: resolveUrl(recipe.photoUrl), headers: { Authorization: `Bearer ${token}` } }}
      style={[styles.photo, { height }]}
    />
  );
}

function MosaicTile({ recipe, token, style }: { recipe: RecipeSummary; token: string | null; style?: object }) {
  if (!recipe.photoUrl) {
    return <RecipeCover tags={recipe.tags} iconSize={24} style={[styles.mosaicCover, style]} />;
  }
  return (
    <Image
      source={{ uri: resolveUrl(recipe.photoUrl), headers: { Authorization: `Bearer ${token}` } }}
      style={[styles.mosaicImage, style]}
    />
  );
}

function CollectionMosaic({ recipes, token }: { recipes: RecipeSummary[]; token: string | null }) {
  const items = recipes.slice(0, 4);

  if (items.length === 0) {
    return (
      <View style={[styles.mosaic, styles.mosaicEmpty]}>
        <Feather name="folder" size={28} color={colors.navInactive} />
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
  const { width } = useWindowDimensions();
  const cardWidth = (width - SIDE * 2 - GUTTER) / 2;
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useState<View_>('recipes');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showNewCollectionInput, setShowNewCollectionInput] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  // Shown under the name field: a name already taken, or the API's error.
  const [collectionNameError, setCollectionNameError] = useState<string | null>(null);
  const [renamingCollection, setRenamingCollection] = useState<Collection | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingInFlight, setRenamingInFlight] = useState(false);
  const [pickingExistingForTag, setPickingExistingForTag] = useState(false);
  const [selectedForAdd, setSelectedForAdd] = useState<Set<string>>(new Set());
  const [confirmingPicker, setConfirmingPicker] = useState(false);
  const [editingCollection, setEditingCollection] = useState(false);
  const [removingRecipeId, setRemovingRecipeId] = useState<string | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  // The « + Nouvelle collection » tile sits at the end of the grid, but
  // the name field opens above it: scroll back up so it's in view.
  const collectionsListRef = useRef<FlatList<Collection | typeof NEW_COLLECTION_TILE>>(null);

  function startNewCollection() {
    setCollectionNameError(null);
    setShowNewCollectionInput(true);
    collectionsListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }

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

  // "Ajoutée récemment": the newest recipe, shown large above the grid on the
  // plain Recettes tab only (not inside a collection or while searching).
  const featured = useMemo(() => {
    if (view !== 'recipes' || activeTag || search.trim() || recipes.length === 0) return null;
    return recipes.reduce((newest, r) => (r.createdAt > newest.createdAt ? r : newest));
  }, [recipes, view, activeTag, search]);

  const visibleRecipes = useMemo(() => {
    const q = search.trim();
    let list = recipes;
    if (view === 'favorites') list = list.filter((r) => r.favorite);
    if (q) list = list.filter((r) => matchesSearch(r.title, q));
    if (activeTag) list = list.filter((r) => r.tags.includes(activeTag));
    if (featured) list = list.filter((r) => r.id !== featured.id);
    return [...list].sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  }, [recipes, search, activeTag, view, featured]);

  const allCollections = useMemo(() => buildCollections(tags, recipes), [tags, recipes]);

  // Independent of `search`, so typing in the search bar while inside a
  // collection doesn't get mistaken for the collection itself being empty.
  const activeCollectionIsEmpty = activeTag ? !recipes.some((r) => r.tags.includes(activeTag)) : false;
  const activeCollectionCount = activeTag ? recipes.filter((r) => r.tags.includes(activeTag)).length : 0;

  const pickableRecipes = useMemo(() => {
    if (!activeTag) return { eligible: [], filtered: [] };
    const eligible = recipes.filter((r) => !r.tags.includes(activeTag));
    const q = search.trim();
    const filtered = q ? eligible.filter((r) => matchesSearch(r.title, q)) : eligible;
    return { eligible, filtered: [...filtered].sort((a, b) => a.title.localeCompare(b.title, 'fr')) };
  }, [recipes, activeTag, search]);

  const visibleCollections = useMemo(() => {
    const q = search.trim();
    if (!q) return allCollections;
    return allCollections.filter((c) => matchesSearch(c.tag, q));
  }, [allCollections, search]);

  function selectView(next: View_) {
    setView(next);
    setActiveTag(null);
    setSearch('');
    setShowNewCollectionInput(false);
    setRenamingCollection(null);
    setPickingExistingForTag(false);
    setSelectedForAdd(new Set());
    setEditingCollection(false);
  }

  function closeSearch() {
    setSearch('');
    setSearchOpen(false);
  }

  // Same rule as the API's normalizeWord (case-insensitive, trimmed).
  function normalizeName(name: string) {
    return name.trim().toLowerCase();
  }

  function findCollectionByName(name: string, exceptId?: string) {
    return tags.find((t) => t.id !== exceptId && normalizeName(t.name) === normalizeName(name));
  }

  async function handleRenameCollection() {
    if (!renamingCollection || !token) return;
    const name = renameValue.trim();
    if (!name) return;
    if (normalizeName(name) === normalizeName(renamingCollection.tag)) {
      setRenamingCollection(null);
      return;
    }
    if (findCollectionByName(name, renamingCollection.id)) {
      setCollectionNameError(`Une collection « ${name} » existe déjà.`);
      return;
    }
    setRenamingInFlight(true);
    try {
      await updateTag(token, renamingCollection.id, name);
      setActiveTag(name);
      setRenamingCollection(null);
      await refresh();
    } catch (err) {
      setCollectionNameError(err instanceof Error ? err.message : 'Impossible de renommer la collection');
    } finally {
      setRenamingInFlight(false);
    }
  }

  function openCollection(tag: string) {
    setActiveTag(tag);
    setSearch('');
    setPickingExistingForTag(false);
    setSelectedForAdd(new Set());
    setEditingCollection(false);
  }

  function closeCollection() {
    setActiveTag(null);
    setRenamingCollection(null);
    setPickingExistingForTag(false);
    setSelectedForAdd(new Set());
    setEditingCollection(false);
  }

  async function handleRemoveFromCollection(recipe: RecipeSummary) {
    if (!token || !activeTag) return;
    setRemovingRecipeId(recipe.id);
    try {
      const detail = await getRecipe(token, recipe.id);
      await updateRecipe(token, recipe.id, {
        ...recipeInputFrom(detail),
        tags: detail.tags.filter((t) => t !== activeTag),
      });
      await refresh();
    } catch (err) {
      Alert.alert('Erreur', err instanceof Error ? err.message : "Impossible de retirer la recette de la collection");
    } finally {
      setRemovingRecipeId(null);
    }
  }

  function toggleSelectForAdd(recipeId: string) {
    setSelectedForAdd((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  }

  function handleCancelPicker() {
    setSelectedForAdd(new Set());
    setPickingExistingForTag(false);
  }

  async function handleConfirmPicker() {
    if (!activeTag || !token) return;
    const tag = activeTag;
    const ids = Array.from(selectedForAdd);
    if (ids.length === 0) {
      setPickingExistingForTag(false);
      return;
    }
    setConfirmingPicker(true);
    const failedTitles: string[] = [];
    for (const id of ids) {
      const recipe = recipes.find((r) => r.id === id);
      if (!recipe) continue;
      try {
        const detail = await getRecipe(token, id);
        await updateRecipe(token, id, { ...recipeInputFrom(detail), tags: [...detail.tags, tag] });
      } catch {
        failedTitles.push(recipe.title);
      }
    }
    await refresh();
    setSelectedForAdd(new Set());
    setConfirmingPicker(false);
    setPickingExistingForTag(false);
    if (failedTitles.length > 0) {
      Alert.alert('Erreur', `Impossible d'ajouter : ${failedTitles.join(', ')}`);
    }
  }

  // The "+" (and an empty collection's CTA) opens the "Ajouter une recette"
  // sheet — inside a collection, with "Recettes existantes" on top and the
  // collection preselected on whatever recipe comes out.
  function handleChooseAdd(choice: AddChoice) {
    if (choice === 'existing') {
      setPickingExistingForTag(true);
      return;
    }
    openAddChoice(navigation, choice, activeTag ?? undefined);
  }

  async function handleCreateCollection() {
    const name = newCollectionName.trim();
    if (!token || !name) return;
    // POST /tags is a find-or-create (recipes rely on it when saving), so
    // a duplicate name would silently "succeed": checked here instead.
    if (findCollectionByName(name)) {
      setCollectionNameError(`Une collection « ${name} » existe déjà.`);
      return;
    }
    setCreatingCollection(true);
    try {
      await createTag(token, name);
      setNewCollectionName('');
      setShowNewCollectionInput(false);
      await refresh();
    } catch (err) {
      setCollectionNameError(err instanceof Error ? err.message : 'Impossible de créer la collection');
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


  const activeCollection = activeTag ? allCollections.find((c) => c.tag === activeTag) : undefined;

  function renderRecipeCard({ item }: { item: RecipeSummary }) {
    const meta = metaLine(item);
    return (
      <Pressable
        style={[styles.card, { width: cardWidth }]}
        onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id })}
      >
        <RecipePhoto recipe={item} token={token} height={128} iconSize={48} />
        {meta ? (
          <Text style={styles.cardLabel} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {activeTag && editingCollection && (
          <Pressable
            style={styles.cardRemoveBadge}
            onPress={() => handleRemoveFromCollection(item)}
            disabled={removingRecipeId === item.id}
            hitSlop={8}
          >
            {removingRecipeId === item.id ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Feather name="x" size={14} color={colors.white} />
            )}
          </Pressable>
        )}
      </Pressable>
    );
  }

  function renderFeatured() {
    if (!featured) return null;
    const meta = metaLine(featured);
    // No photo and no source link: almost always a photo import (cookbook
    // page, handwritten card) — an approximation until the source photos
    // themselves are kept.
    const fromPhoto = !featured.photoUrl && !featured.source;
    return (
      <Pressable
        style={styles.featured}
        onPress={() => navigation.navigate('RecipeDetail', { recipeId: featured.id })}
      >
        <Text style={[labelText, styles.featuredKicker]}>Ajoutée récemment</Text>
        <RecipePhoto recipe={featured} token={token} height={196} iconSize={60}>
          {fromPhoto && <Text style={[labelText, styles.coverLabel]}>Importée d'une photo</Text>}
        </RecipePhoto>
        <Text style={styles.featuredTitle} numberOfLines={2}>
          {featured.title}
        </Text>
        {meta ? <Text style={styles.featuredMeta}>{meta}</Text> : null}
      </Pressable>
    );
  }

  function renderRecipesBody(emptyMessage: string) {
    if (activeTag && pickingExistingForTag) {
      return (
        <>
          <View style={styles.pickerHeader}>
            <Pressable onPress={handleCancelPicker} disabled={confirmingPicker} hitSlop={8}>
              <Feather name="x" size={20} color={colors.text2} />
            </Pressable>
            <Pressable style={styles.pickerDoneButton} onPress={handleConfirmPicker} disabled={confirmingPicker}>
              {confirmingPicker ? (
                <ActivityIndicator size="small" color={colors.terracotta} />
              ) : (
                <Text style={styles.pickerDoneText}>Terminé</Text>
              )}
            </Pressable>
          </View>
          {pickableRecipes.eligible.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptySubtitle}>Toutes tes recettes sont déjà dans cette collection.</Text>
            </View>
          ) : pickableRecipes.filtered.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptySubtitle}>Aucune recette ne correspond.</Text>
            </View>
          ) : (
            <FlatList
              key="existing-picker"
              data={pickableRecipes.filtered}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.pickerList}
              renderItem={({ item }) => {
                const selected = selectedForAdd.has(item.id);
                return (
                  <Pressable
                    style={styles.pickerRow}
                    onPress={() => toggleSelectForAdd(item.id)}
                    disabled={confirmingPicker}
                  >
                    {item.photoUrl ? (
                      <Image
                        source={{ uri: resolveUrl(item.photoUrl), headers: { Authorization: `Bearer ${token}` } }}
                        style={styles.pickerRowPhoto}
                      />
                    ) : (
                      <RecipeCover tags={item.tags} iconSize={18} style={[styles.pickerRowPhoto, styles.pickerRowCover]} />
                    )}
                    <Text style={styles.pickerRowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Feather
                      name={selected ? 'check-circle' : 'circle'}
                      size={20}
                      color={selected ? colors.terracotta : colors.hairline}
                    />
                  </Pressable>
                );
              }}
            />
          )}
        </>
      );
    }

    if (visibleRecipes.length === 0 && !featured) {
      return (
        <View style={styles.center}>
          {activeTag && activeCollectionIsEmpty ? (
            <>
              <Text style={styles.emptySubtitle}>Cette collection est vide pour l'instant.</Text>
              <Pressable style={styles.primaryButton} onPress={() => setAddSheetOpen(true)}>
                <Feather name="plus" size={16} color={colors.white} />
                <Text style={styles.primaryButtonText}>Ajouter une recette</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.emptySubtitle}>{emptyMessage}</Text>
          )}
        </View>
      );
    }

    return (
      <FlatList
        key="recipes-grid"
        data={visibleRecipes}
        keyExtractor={(item) => item.id}
        numColumns={2}
        ListHeaderComponent={renderFeatured()}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.gridRow}
        renderItem={renderRecipeCard}
      />
    );
  }

  function renderCollectionsBody() {
    const searching = Boolean(search.trim());
    if (searching && visibleCollections.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.emptySubtitle}>Aucune collection ne correspond.</Text>
        </View>
      );
    }
    // Collections are created from a dashed tile at the end of the grid
    // (2026-10-01 — "Nouvelle collection" left the "+" menu, which is now
    // only about adding recipes). Hidden while searching.
    const data: (Collection | typeof NEW_COLLECTION_TILE)[] = searching
      ? visibleCollections
      : [...visibleCollections, NEW_COLLECTION_TILE];
    return (
      <FlatList
        key="collections-grid"
        ref={collectionsListRef}
        data={data}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) =>
          !('tag' in item) ? (
            <DashedTile
              vertical
              icon="plus"
              label="Nouvelle collection"
              onPress={startNewCollection}
              style={[styles.newCollectionTile, { width: cardWidth }]}
            />
          ) : (
          <Pressable style={[styles.card, { width: cardWidth }]} onPress={() => openCollection(item.tag)}>
            <CollectionMosaic recipes={item.recipes} token={token} />
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.tag}
            </Text>
            <Text style={styles.collectionCount}>{plural(item.recipes.length, 'recette')}</Text>
          </Pressable>
          )
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <Wordmark align="left" size={22} />
        {!showEmptyState && (
          <Pressable
            style={styles.roundButton}
            onPress={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            accessibilityLabel={searchOpen ? 'Fermer la recherche' : 'Rechercher'}
          >
            <Feather name={searchOpen ? 'x' : 'search'} size={19} color={colors.ink} />
          </Pressable>
        )}
      </View>

      {activeTag ? (
        <View style={styles.titleBlock}>
          <Pressable style={styles.backRow} onPress={closeCollection} hitSlop={8}>
            <Feather name="chevron-left" size={16} color={colors.text2} />
            <Text style={styles.backText}>Collections</Text>
          </Pressable>
          {renamingCollection ? (
            <View style={styles.renameBlock}>
              <InlineNameField
                label="Renommer la collection"
                value={renameValue}
                onChangeText={(text) => {
                  setRenameValue(text);
                  setCollectionNameError(null);
                }}
                placeholder="Nom de la collection"
                confirmLabel="Enregistrer"
                onConfirm={handleRenameCollection}
                onCancel={() => {
                  setRenamingCollection(null);
                  setCollectionNameError(null);
                }}
                busy={renamingInFlight}
                error={collectionNameError}
              />
            </View>
          ) : (
            <Text style={styles.screenTitle} numberOfLines={2}>
              {activeTag}
            </Text>
          )}
          <View style={styles.collectionActions}>
            <Text style={styles.counter}>{plural(activeCollectionCount, 'recette')}</Text>
            <View style={styles.collectionIcons}>
              {!activeCollectionIsEmpty && !pickingExistingForTag && (
                <Pressable
                  onPress={() => setEditingCollection((prev) => !prev)}
                  hitSlop={8}
                  accessibilityLabel={editingCollection ? 'Terminer' : 'Retirer des recettes'}
                >
                  <Feather name={editingCollection ? 'check' : 'list'} size={18} color={colors.ink} />
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  if (activeCollection) {
                    setCollectionNameError(null);
                    setRenamingCollection(activeCollection);
                    setRenameValue(activeCollection.tag);
                  }
                }}
                hitSlop={8}
                accessibilityLabel="Renommer la collection"
              >
                <Feather name="edit-2" size={17} color={colors.ink} />
              </Pressable>
              <Pressable
                onPress={() => activeCollection && handleDeleteCollection(activeCollection)}
                hitSlop={8}
                accessibilityLabel="Supprimer la collection"
              >
                <Feather name="trash-2" size={17} color={colors.danger} />
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.titleBlock}>
          <Text style={styles.screenTitle}>Mes recettes</Text>
          {!showEmptyState && (
            <Text style={styles.counter}>
              {plural(recipes.length, 'recette')} · {plural(tags.length, 'collection')}
            </Text>
          )}
        </View>
      )}

      {searchOpen && (
        <View style={styles.searchBar}>
          <Feather name="search" size={16} color={colors.text2} />
          <TextInput
            style={styles.searchInput}
            placeholder={
              view === 'collections' && !activeTag ? 'Rechercher une collection…' : 'Rechercher une recette…'
            }
            placeholderTextColor={colors.text2}
            value={search}
            onChangeText={setSearch}
            autoFocus
          />
        </View>
      )}

      {!activeTag && !showEmptyState && (
        <View style={styles.tabs}>
          {(
            [
              ['recipes', 'Recettes'],
              ['collections', 'Collections'],
              ['favorites', 'Favoris'],
            ] as const
          ).map(([key, label]) => (
            <Pressable key={key} style={[styles.tab, view === key && styles.tabActive]} onPress={() => selectView(key)}>
              <Text style={[styles.tabText, view === key && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {view === 'collections' && !activeTag && showNewCollectionInput && (
        <View style={styles.newCollectionRow}>
          <InlineNameField
            label="Nouvelle collection"
            value={newCollectionName}
            onChangeText={(text) => {
              setNewCollectionName(text);
              setCollectionNameError(null);
            }}
            placeholder="Ex. Desserts du dimanche"
            confirmLabel="Créer"
            onConfirm={handleCreateCollection}
            onCancel={() => {
              setShowNewCollectionInput(false);
              setNewCollectionName('');
              setCollectionNameError(null);
            }}
            busy={creatingCollection}
            error={collectionNameError}
          />
        </View>
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
            <MaterialCommunityIcons name="book-open-page-variant-outline" size={48} color={colors.navInactive} />
            <Text style={styles.emptyTitle}>Prête à enregistrer ta première recette ?</Text>
            <Text style={styles.emptySubtitle}>Appuie sur « + » pour commencer.</Text>
          </View>
        ) : view === 'collections' && !activeTag ? (
          renderCollectionsBody()
        ) : view === 'favorites' && !activeTag ? (
          renderRecipesBody(
            search.trim() ? 'Aucune recette ne correspond.' : 'Aucun favori pour l\'instant — touche le cœur sur une recette.',
          )
        ) : (
          renderRecipesBody('Aucune recette ne correspond.')
        )}
      </View>

      <AddRecipeSheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onChoose={handleChooseAdd}
        includeExisting={Boolean(activeTag)}
      />

      <BottomNav
        active="recipes"
        onRecipesPress={() => selectView('recipes')}
        onAddPress={() => setAddSheetOpen(true)}
        onProfilePress={() => navigation.navigate('Profile')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SIDE,
    paddingTop: 8,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { paddingHorizontal: SIDE, marginTop: 14 },
  screenTitle: { fontFamily: fonts.serifSemiBold, fontSize: 40, lineHeight: 44, letterSpacing: -1.2, color: colors.ink },
  counter: { fontFamily: fonts.sans, fontSize: 14, color: colors.text2, marginTop: 6 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6, alignSelf: 'flex-start' },
  backText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.text2 },
  collectionActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collectionIcons: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 6 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    marginHorizontal: SIDE,
    marginTop: 14,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontFamily: fonts.sans, fontSize: 15, color: colors.ink },
  tabs: {
    flexDirection: 'row',
    gap: 24,
    marginHorizontal: SIDE,
    marginTop: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  tab: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabActive: { borderBottomColor: colors.terracotta },
  tabText: { fontFamily: fonts.sansMedium, fontSize: 15, color: colors.text2 },
  tabTextActive: { fontFamily: fonts.sansSemiBold, color: colors.ink },
  newCollectionRow: { marginHorizontal: SIDE, marginTop: 22, marginBottom: 4 },
  renameBlock: { marginTop: 4, marginBottom: 8 },
  newCollectionTile: { height: 128 },
  list: { paddingHorizontal: SIDE, paddingTop: 20, paddingBottom: 24 },
  gridRow: { gap: GUTTER, marginBottom: 20 },
  photo: { width: '100%', borderRadius: radii.photo },
  card: {},
  cardLabel: { ...labelText, fontSize: 10.5, marginTop: 10 },
  cardTitle: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: -0.17,
    color: colors.ink,
    marginTop: 4,
  },
  cardRemoveBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featured: { marginBottom: 28 },
  featuredKicker: { marginBottom: 10 },
  coverLabel: { position: 'absolute', top: 16, left: 16, color: 'rgba(255,255,255,0.85)' },
  featuredTitle: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 23,
    lineHeight: 28,
    letterSpacing: -0.35,
    color: colors.ink,
    marginTop: 12,
  },
  featuredMeta: { fontFamily: fonts.sans, fontSize: 14, color: colors.text2, marginTop: 4 },
  collectionCount: { fontFamily: fonts.sans, fontSize: 13, color: colors.text2, marginTop: 2 },
  mosaic: { height: 128, borderRadius: radii.photo, overflow: 'hidden' },
  mosaicRow: { flexDirection: 'row', gap: 2 },
  mosaicCol: { flexDirection: 'column', gap: 2 },
  mosaicMain: { flex: 1.4 },
  mosaicCover: { padding: 8 },
  mosaicImage: { height: '100%' },
  mosaicEmpty: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  error: { fontFamily: fonts.sansMedium, color: colors.danger },
  emptyTitle: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 6,
  },
  emptySubtitle: { fontFamily: fonts.sans, fontSize: 15, color: colors.text2, textAlign: 'center' },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 16,
  },
  primaryButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.white },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SIDE,
    paddingTop: 14,
    paddingBottom: 10,
  },
  pickerDoneButton: { minWidth: 20, alignItems: 'flex-end' },
  pickerDoneText: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.terracottaText },
  pickerList: { paddingBottom: 24 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: SIDE,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  pickerRowPhoto: { width: 44, height: 44, borderRadius: radii.sm },
  pickerRowCover: { padding: 6 },
  pickerRowTitle: { flex: 1, fontFamily: fonts.sansMedium, fontSize: 15, color: colors.ink },
});
