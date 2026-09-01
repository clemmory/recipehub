import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { checkHealth } from '../lib/api';

export default function AuthScreen() {
  const [status, setStatus] = useState('checking...');

  useEffect(() => {
    checkHealth()
      .then((data) => setStatus(`API OK: ${data.status}`))
      .catch((err) => setStatus(`API unreachable: ${err.message}`));
  }, []);

  return (
    <View style={styles.container}>
      <Text>Auth — Phase 1</Text>
      <Text>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
});
