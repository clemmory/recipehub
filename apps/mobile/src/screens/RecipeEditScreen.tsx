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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAuth } from '../context/AuthContext';
import { createRecipe, getRecipe, resolveUrl, updateRecipe, type RecipeIngredient } from '../lib/api';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RecipeEdit'>;
type Route = RouteProp<RootStackParamList, 'RecipeEdit'>;

type PickedPhoto = { uri: string; name: string; type: string };

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
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load recipe'))
      .finally(() => setLoading(false));
  }, [isEditing, token, recipeId]);

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to add a recipe photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setNewPhoto({
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    });
    setRemovePhoto(false);
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

    const trimmedTitle = title.trim();
    const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
    const cleanIngredients = ingredients
      .map((ing) => ({ name: ing.name.trim(), quantity: ing.quantity?.trim() || null }))
      .filter((ing) => ing.name.length > 0);
    const cleanTags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (!trimmedTitle) {
      setError('Title is required');
      return;
    }
    if (cleanSteps.length === 0) {
      setError('At least one step is required');
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
      setError(err instanceof Error ? err.message : 'Failed to save recipe');
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
    <ScrollView contentContainerStyle={styles.container}>
      {newPhoto ? (
        <Image source={{ uri: newPhoto.uri }} style={styles.photo} />
      ) : showExistingPhoto ? (
        <Image
          source={{ uri: resolveUrl(existingPhotoUrl!), headers: { Authorization: `Bearer ${token}` } }}
          style={styles.photo}
        />
      ) : null}

      <View style={styles.photoActions}>
        <Pressable style={styles.linkButton} onPress={handlePickPhoto}>
          <Text style={styles.linkButtonText}>{newPhoto || showExistingPhoto ? 'Change photo' : 'Add photo'}</Text>
        </Pressable>
        {(newPhoto || showExistingPhoto) && (
          <Pressable style={styles.linkButton} onPress={handleClearPhoto}>
            <Text style={[styles.linkButtonText, styles.removeText]}>Remove photo</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Recipe title" />

      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Servings</Text>
          <TextInput
            style={styles.input}
            value={servings}
            onChangeText={setServings}
            keyboardType="number-pad"
            placeholder="4"
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Prep (min)</Text>
          <TextInput
            style={styles.input}
            value={prepTimeMin}
            onChangeText={setPrepTimeMin}
            keyboardType="number-pad"
            placeholder="15"
          />
        </View>
        <View style={styles.rowItem}>
          <Text style={styles.label}>Cook (min)</Text>
          <TextInput
            style={styles.input}
            value={cookTimeMin}
            onChangeText={setCookTimeMin}
            keyboardType="number-pad"
            placeholder="30"
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>Ingredients</Text>
      {ingredients.map((ing, i) => (
        <View key={i} style={styles.listRow}>
          <TextInput
            style={[styles.input, styles.ingredientName]}
            placeholder="Ingredient"
            value={ing.name}
            onChangeText={(v) => updateIngredient(i, { name: v })}
          />
          <TextInput
            style={[styles.input, styles.ingredientQty]}
            placeholder="Qty"
            value={ing.quantity ?? ''}
            onChangeText={(v) => updateIngredient(i, { quantity: v })}
          />
          <Pressable onPress={() => removeIngredient(i)} style={styles.removeRowButton}>
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        </View>
      ))}
      <Pressable style={styles.linkButton} onPress={addIngredient}>
        <Text style={styles.linkButtonText}>+ Add ingredient</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Steps</Text>
      {steps.map((step, i) => (
        <View key={i} style={styles.listRow}>
          <TextInput
            style={[styles.input, styles.stepInput]}
            placeholder={`Step ${i + 1}`}
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
        <Text style={styles.linkButtonText}>+ Add step</Text>
      </Pressable>

      <Text style={styles.label}>Tags (comma-separated)</Text>
      <TextInput style={styles.input} value={tagsText} onChangeText={setTagsText} placeholder="dessert, easy" />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save recipe</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16, gap: 8, paddingBottom: 48 },
  photo: { width: '100%', height: 200, borderRadius: 10, backgroundColor: '#eee' },
  photoActions: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  label: { fontSize: 13, color: '#666', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 15, backgroundColor: '#fff' },
  row: { flexDirection: 'row', gap: 8 },
  rowItem: { flex: 1 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginTop: 16 },
  listRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 },
  ingredientName: { flex: 2 },
  ingredientQty: { flex: 1 },
  stepInput: { flex: 1 },
  removeRowButton: { padding: 8 },
  removeText: { color: '#c0392b', fontSize: 15 },
  linkButton: { marginTop: 10 },
  linkButtonText: { color: '#2f6f3e', fontWeight: '600' },
  saveButton: { backgroundColor: '#2f6f3e', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 24 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#c0392b', marginTop: 12 },
});
