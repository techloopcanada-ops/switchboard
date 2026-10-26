import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api, normalizeUrl, parsePairing, type Connection } from '../connection';
import { C, s } from '../theme';

export function PairScreen({ onPaired }: { onPaired: (connection: Connection) => Promise<void> }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  async function connect(candidate: { url: string; token: string }) {
    setBusy(true); setError(null);
    try {
      const connection: Connection = { url: normalizeUrl(candidate.url), token: candidate.token.trim(), deviceId: Math.random().toString(36).slice(2, 10) };
      const status = await api<{ version: string }>(connection, '/api/status');
      if (!status.version) throw new Error('That server did not answer like Switchboard.');
      await onPaired(connection);
    } catch (e) {
      setError(`Could not connect: ${(e as Error).message}. Check that the computer runs Switchboard with server host 0.0.0.0 and that both devices share a network or Tailscale.`);
      handled.current = false;
    } finally {
      setBusy(false);
    }
  }

  function onScanned(data: string) {
    if (handled.current) return;
    const parsed = parsePairing(data);
    if (!parsed) { setError('That QR code is not a Switchboard pairing code.'); return; }
    handled.current = true;
    setScanning(false);
    void connect(parsed);
  }

  function onPaste() {
    const parsed = parsePairing(pasted);
    if (!parsed) { setError('Paste the full text from the Pair tab (starts with switchboard:// or {).'); return; }
    void connect(parsed);
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior="padding">
      <ScrollView contentContainerStyle={[s.pad, { gap: 16 }]} keyboardShouldPersistTaps="handled">
        <Text style={s.caption}>Pair with your computer</Text>
        <Text style={s.h1}>Scan the code in the Pair tab</Text>
        <Text style={s.muted}>Open Switchboard on your computer, go to Pair, and point the camera at the QR code. Nothing leaves your network: the phone talks straight to your computer.</Text>

        {scanning ? (
          <View style={{ height: 320, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.line }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={result => onScanned(result.data)} />
            <Pressable style={[s.button, s.buttonQuiet, { position: 'absolute', bottom: 12, alignSelf: 'center' }]} onPress={() => setScanning(false)}><Text style={s.buttonQuietText}>Stop scanning</Text></Pressable>
          </View>
        ) : (
          <Pressable style={s.button} disabled={busy} onPress={async () => {
            if (!permission?.granted) {
              const result = await requestPermission();
              if (!result.granted) { setError('Camera permission is needed to scan. You can paste the code instead.'); return; }
            }
            handled.current = false; setError(null); setScanning(true);
          }}>
            <Text style={s.buttonText}>{busy ? 'Connecting…' : 'Scan QR code'}</Text>
          </Pressable>
        )}

        <View style={s.card}>
          <Text style={s.h2}>Or paste the pairing text</Text>
          <TextInput style={[s.input, { minHeight: 70 }]} multiline value={pasted} onChangeText={setPasted} placeholder="switchboard://pair?url=…&token=…" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} />
          <Pressable style={[s.button, s.buttonQuiet]} disabled={busy || !pasted.trim()} onPress={onPaste}><Text style={s.buttonQuietText}>Connect</Text></Pressable>
        </View>

        <View style={s.card}>
          <Text style={s.h2}>Or type it in</Text>
          <TextInput style={s.input} value={url} onChangeText={setUrl} placeholder="http://192.168.1.20:7787" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <TextInput style={s.input} value={token} onChangeText={setToken} placeholder="token" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Pressable style={[s.button, s.buttonQuiet]} disabled={busy || !url.trim() || !token.trim()} onPress={() => connect({ url, token })}><Text style={s.buttonQuietText}>Connect</Text></Pressable>
        </View>

        {error && <Text style={[s.body, { color: C.danger }]}>{error}</Text>}
        <Text style={s.muted}>Tip: on the computer, Settings → General → Server host must be 0.0.0.0 for pairing over Wi-Fi. The token in the QR code is the only key to your bots; treat it like a password.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
