import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { createRecipe, getRecipe, resolveUrl, updateRecipe, type RecipeIngredient } from '../lib/api';
import { colors, radii, fonts } from '../lib/theme';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RecipeEdit'>;
type Route = RouteProp<RootStackParamList, 'RecipeEdit'>;

type PickedPhoto = { uri: string; name: string; type: string };

function capitalizeFirst(text: string) {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

export default function RecipeEditScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { token } = useAuth();
  const recipeId = route.params?.recipeId;
  const isEditing = Boolean(recipeId);

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [servings, setServings] = useState('');
  const [prepTimeMin, setPrepTimeMin] = useState('');
  const [cookTimeMin, setCookTimeMin] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([{ name: '', quantity: '' }]);
  const [tagsText, setTagsText] = useState('');

  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [newPhoto, setNewPhoto] = useState<PickedPhoto | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  useEffect(() => {
    if (!isEditing || !token || !recipeId) return;
    getRecipe(token, recipeId)
      .then((recipe) => {
        setTitle(recipe.title);
        setServings(recipe.servings ? String(recipe.servings) : '');
        setPrepTimeMin(recipe.prepTimeMin ? String(recipe.prepTimeMin) : '');
        setCookTimeMin(recipe.cookTimeMin ? String(recipe.cookTimeMin) : '');
        setSteps(recipe.steps.length > 0 ? recipe.steps : ['']);
        setIngredients(recipe.ingredients.length > 0 ? recipe.ingredients : [{ name: '', quantity: '' }]);
        setTagsText(recipe.tags.join(', '));
        setExistingPhotoUrl(recipe.photoUrl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Impossible de charger la recette'))
      .finally(() => setLoading(false));
  }, [isEditing, token, recipeId]);

  function applyPickedAsset(asset: ImagePicker.ImagePickerAsset) {
    setNewPhoto({
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    });
    setRemovePhoto(false);
  }

  async function handlePickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Autorisation nécessaire', "Autorise l'accès à la photothèque pour ajouter une photo de recette.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;
    applyPickedAsset(result.assets[0]);
  }

  async function handleTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Autorisation nécessaire', "Autorise l'accès à la caméra pour prendre une photo de recette.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;
    applyPickedAsset(result.assets[0]);
  }

  function handleAddPhoto() {
    Alert.alert('Ajouter une photo', undefined, [
      { text: 'Prendre une photo', onPress: handleTakePhoto },
      { text: 'Choisir dans la photothèque', onPress: handlePickFromLibrary },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }

  function handleClearPhoto() {
    setNewPhoto(null);
    setRemovePhoto(true);
  }

  function updateStep(index: number, value: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? value : s)));
  }
  function addStep() {
    setSteps((prev) => [...prev, '']);
  }
  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function updateIngredient(index: number, patch: Partial<RecipeIngredient>) {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)));
  }
  function addIngredient() {
    setIngredients((prev) => [...prev, { name: '', quantity: '' }]);
  }
  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!token) return;
    setError(null);

    const trimmedTitle = capitalizeFirst(title.trim());
    const cleanSteps = steps.map((s) => capitalizeFirst(s.trim())).filter(Boolean);
    const cleanIngredients = ingredients
      .map((ing) => ({ name: capitalizeFirst(ing.name.trim()), quantity: ing.quantity?.trim() || null }))
      .filter((ing) => ing.name.length > 0);
    const cleanTags = tagsText
      .split(',')
      .map((t) => capitalizeFirst(t.trim()))
      .filter(Boolean);

    if (!trimmedTitle) {
      setError('Le titre est obligatoire');
      return;
    }
    if (cleanIngredients.length === 0) {
      setError('Au moins un ingrédient est requis');
      return;
    }
    if (cleanSteps.length === 0) {
      setError('Au moins une étape est requise');
      return;
    }

    setSaving(true);
    try {
      const input = {
        title: trimmedTitle,
        prepTimeMin: prepTimeMin ? Number(prepTimeMin) : undefined,
        cookTimeMin: cookTimeMin ? Number(cookTimeMin) : undefined,
        servings: servings ? Number(servings) : undefined,
        steps: cleanSteps,
        ingredients: cleanIngredients,
        tags: cleanTags,
        photo: newPhoto ?? undefined,
        removePhoto,
      };

      if (isEditing && recipeId) {
        await updateRecipe(token, recipeId, input);
      } else {
        await createRecipe(token, input);
      }
      navigation.goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'enregistrer la recette");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const showExistingPhoto = existingPhotoUrl && !removePhoto && !newPhoto;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Titre</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Titre de la recette" />

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Portions</Text>
            <TextInput
              style={styles.input}
              value={servings}
              onChangeText={setServings}
              keyboardType="number-pad"
              placeholder="4"
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Préparation (min)</Text>
            <TextInput
              style={styles.input}
              value={prepTimeMin}
              onChangeText={setPrepTimeMin}
              keyboardType="number-pad"
              placeholder="15"
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.label}>Cuisson (min)</Text>
            <TextInput
              style={styles.input}
              value={cookTimeMin}
              onChangeText={setCookTimeMin}
              keyboardType="number-pad"
              placeholder="30"
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Ingrédients</Text>
        {ingredients.map((ing, i) => (
          <View key={i} style={styles.listRow}>
            <TextInput
              style={[styles.input, styles.ingredientName]}
              placeholder="Ingrédient"
              value={ing.name}
              onChangeText={(v) => updateIngredient(i, { name: v })}
            />
            <TextInput
              style={[styles.input, styles.ingredientQty]}
              placeholder="Qté"
              value={ing.quantity ?? ''}
              onChangeText={(v) => updateIngredient(i, { quantity: v })}
            />
            <Pressable onPress={() => removeIngredient(i)} style={styles.removeRowButton}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.linkButton} onPress={addIngredient}>
          <Text style={styles.linkButtonText}>+ Ajouter un ingrédient</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Étapes</Text>
        {steps.map((step, i) => (
          <View key={i} style={styles.listRow}>
            <TextInput
              style={[styles.input, styles.stepInput]}
              placeholder={`Étape ${i + 1}`}
              value={step}
              onChangeText={(v) => updateStep(i, v)}
              multiline
            />
            <Pressable onPress={() => removeStep(i)} style={styles.removeRowButton}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.linkButton} onPress={addStep}>
          <Text style={styles.linkButtonText}>+ Ajouter une étape</Text>
        </Pressable>

        <Text style={styles.label}>Tags (séparés par des virgules)</Text>
        <TextInput style={styles.input} value={tagsText} onChangeText={setTagsText} placeholder="dessert, facile" />

        <Text style={styles.sectionTitle}>Photo</Text>
        {newPhoto ? (
          <Image source={{ uri: newPhoto.uri }} style={styles.photo} />
        ) : showExistingPhoto ? (
          <Image
            source={{ uri: resolveUrl(existingPhotoUrl!), headers: { Authorization: `Bearer ${token}` } }}
            style={styles.photo}
          />
        ) : null}

        <View style={styles.photoActions}>
          <Pressable style={styles.linkButton} onPress={handleAddPhoto}>
            <Text style={styles.linkButtonText}>
              {newPhoto || showExistingPhoto ? 'Changer la photo' : 'Ajouter une photo'}
            </Text>
          </Pressable>
          {(newPhoto || showExistingPhoto) && (
            <Pressable style={styles.linkButton} onPress={handleClearPhoto}>
              <Text style={[styles.linkButtonText, styles.removeText]}>Retirer la photo</Text>
            </Pressable>
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveButtonText}>Enregistrer la recette</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
  container: { padding: 16, gap: 8, paddingBottom: 48, backgroundColor: colors.cream, flexGrow: 1 },
  photo: { width: '100%', height: 200, borderRadius: radii.lg, backgroundColor: colors.border },
  photoActions: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  label: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.gray, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 10,
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    backgroundColor: colors.white,
    color: colors.charcoal,
  },
  row: { flexDirection: 'row', gap: 8 },
  rowItem: { flex: 1 },
  sectionTitle: { fontFamily: fonts.serifBold, fontSize: 18, color: colors.charcoal, marginTop: 16 },
  listRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 },
  ingredientName: { flex: 2 },
  ingredientQty: { flex: 1 },
  stepInput: { flex: 1 },
  removeRowButton: { padding: 8 },
  removeText: { fontFamily: fonts.sansSemiBold, color: colors.danger, fontSize: 15 },
  linkButton: { marginTop: 10 },
  linkButtonText: { fontFamily: fonts.sansSemiBold, color: colors.greenDark },
  saveButton: { backgroundColor: colors.terracotta, borderRadius: radii.md, padding: 14, alignItems: 'center', marginTop: 24 },
  saveButtonText: { fontFamily: fonts.sansSemiBold, color: colors.white, fontSize: 16 },
  error: { fontFamily: fonts.sansMedium, color: colors.danger, marginTop: 12 },
});
