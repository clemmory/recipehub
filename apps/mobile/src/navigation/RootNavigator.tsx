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
import { colors, fonts } from '../lib/theme';
import type { StructuredRecipeDraft } from '../lib/api';

export type RootStackParamList = {
  Auth: undefined;
  RecipeList: undefined;
  RecipeDetail: { recipeId: string };
  RecipeEdit: { recipeId?: string; draft?: StructuredRecipeDraft; source?: string };
  Import: undefined;
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
