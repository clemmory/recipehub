import { View, Text, StyleSheet } from 'react-native';

export default function RecipeListScreen() {
  return (
    <View style={styles.container}>
      <Text>Recipe List — Phase 1</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
