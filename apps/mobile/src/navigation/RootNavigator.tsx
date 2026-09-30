import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from '../context/AuthContext';
import AuthScreen from '../screens/AuthScreen';
import RecipeListScreen from '../screens/RecipeListScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import RecipeEditScreen from '../screens/RecipeEditScreen';
import ImportScreen from '../screens/ImportScreen';
import PhotoImportScreen from '../screens/PhotoImportScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { colors, fonts } from '../lib/theme';
import type { StructuredRecipeDraft, ScrapedPhotoCandidate } from '../lib/api';

export type RootStackParamList = {
  Auth: undefined;
  RecipeList: undefined;
  RecipeDetail: { recipeId: string };
  RecipeEdit: {
    recipeId?: string;
    draft?: StructuredRecipeDraft;
    source?: string;
    photo?: { uri: string; name: string; type: string };
    // A carousel's images to choose from, with `photo` preselected to the
    // first — the picker opens from "Changer Photo".
    photoCandidates?: ScrapedPhotoCandidate[];
  };
  // Set when the user starts an import from an empty collection's "Ajouter
  // une recette" menu — forces this collection onto the imported recipe.
  Import: { presetTag?: string } | undefined;
  // Photo import (Phase 3) — same presetTag as Import.
  PhotoImport: { presetTag?: string } | undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function Navigator() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.cream },
          headerShadowVisible: false,
          headerTitleStyle: { color: colors.charcoal, fontFamily: fonts.serifBold, fontSize: 20 },
          headerTintColor: colors.terracotta,
          contentStyle: { backgroundColor: colors.cream },
        }}
      >
        {token ? (
          <>
            <Stack.Screen name="RecipeList" component={RecipeListScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="RecipeDetail"
              component={RecipeDetailScreen}
              options={{ title: '', headerBackButtonDisplayMode: 'minimal' }}
            />
            <Stack.Screen
              name="RecipeEdit"
              component={RecipeEditScreen}
              options={({ route }) => ({
                title: route.params?.recipeId ? 'Modifier la recette' : 'Nouvelle recette',
                headerBackButtonDisplayMode: 'minimal',
              })}
            />
            <Stack.Screen
              name="Import"
              component={ImportScreen}
              options={{ title: 'Importer depuis Instagram', headerBackButtonDisplayMode: 'minimal' }}
            />
            <Stack.Screen
              name="PhotoImport"
              component={PhotoImportScreen}
              options={{ title: 'Importer depuis des photos', headerBackButtonDisplayMode: 'minimal' }}
            />
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              // Reached from the bottom nav, not pushed like a detail screen:
              // no back button or swipe-back, the bar is the way out.
              options={{ title: 'Profil', headerBackVisible: false, gestureEnabled: false, animation: 'none' }}
            />
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function RootNavigator() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Navigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
