import { FlatList, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useState } from 'react';
import { useStore } from '../store';
import { BACKEND_HOST_EXPORT as BACKEND_HOST } from '../hooks/useBackend';

export default function WatchlistScreen() {
  const { watchlist, prices } = useStore();
  const [input, setInput] = useState('');
  const [market, setMarket] = useState<'crypto' | 'stock'>('crypto');

  const addSymbol = async () => {
    if (!input.trim()) return;
    await fetch(`${BACKEND_HOST}/watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: input.toUpperCase(), market }),
    });
    setInput('');
  };

  const removeSymbol = async (symbol: string) => {
    await fetch(`${BACKEND_HOST}/watchlist/${symbol}`, { method: 'DELETE' });
  };

  return (
    <View style={styles.container}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Symbol..."
          placeholderTextColor="#6b6b78"
          autoCapitalize="characters"
          onSubmitEditing={addSymbol}
        />
        <TouchableOpacity
          style={[styles.toggleBtn, market === 'crypto' && styles.toggleActive]}
          onPress={() => setMarket('crypto')}
        >
          <Text style={[styles.toggleText, market === 'crypto' && styles.toggleTextActive]}>Crypto</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, market === 'stock' && styles.toggleActive]}
          onPress={() => setMarket('stock')}
        >
          <Text style={[styles.toggleText, market === 'stock' && styles.toggleTextActive]}>Stock</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addBtn} onPress={addSymbol}>
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={watchlist}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => {
          const priceKey = item.market === 'crypto' ? item.symbol + 'USDT' : item.symbol;
          const price = prices[priceKey] ?? prices[item.symbol];
          return (
            <View style={styles.row}>
              <Text style={styles.symbol}>{item.symbol}</Text>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{item.market}</Text>
              </View>
              <Text style={styles.price}>
                {price ? `$${price.toLocaleString()}` : '—'}
              </Text>
              <TouchableOpacity onPress={() => removeSymbol(item.symbol)}>
                <Text style={styles.remove}>✕</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>Add symbols to watch</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0f' },
  addRow: {
    flexDirection: 'row',
    gap: 6,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a30',
    backgroundColor: '#141417',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#0d0d0f',
    borderWidth: 1,
    borderColor: '#2a2a30',
    borderRadius: 4,
    color: '#e8e8ea',
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
  },
  toggleBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a30',
  },
  toggleActive: { borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)' },
  toggleText: { fontSize: 11, color: '#6b6b78' },
  toggleTextActive: { color: '#3b82f6' },
  addBtn: {
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addBtnText: { color: '#3b82f6', fontSize: 12, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a30',
    backgroundColor: '#141417',
  },
  symbol: { flex: 1, fontWeight: '700', fontSize: 14, color: '#e8e8ea', fontVariant: ['tabular-nums'] },
  tag: { backgroundColor: '#1c1c21', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: { fontSize: 10, color: '#6b6b78' },
  price: { fontSize: 13, color: '#6b6b78', fontVariant: ['tabular-nums'] },
  remove: { fontSize: 12, color: '#6b6b78', padding: 4 },
  empty: { padding: 24, textAlign: 'center', color: '#6b6b78' },
});
