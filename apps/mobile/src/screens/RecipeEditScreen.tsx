import { View, Text, StyleSheet } from 'react-native';

export default function RecipeEditScreen() {
  return (
    <View style={styles.container}>
      <Text>Recipe Edit — Phase 1</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
