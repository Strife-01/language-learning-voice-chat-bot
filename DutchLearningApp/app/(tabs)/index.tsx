import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, Text, View, TouchableOpacity, Switch, ScrollView, 
  SafeAreaView, ActivityIndicator, Platform, Alert, Image
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:40811';

export default function HomeScreen() {
  const [context, setContext] = useState('waiter');
  const [liveFeedback, setLiveFeedback] = useState(true); 
  const [messages, setMessages] = useState<any[]>([]); 
  
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'web') {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') Alert.alert("Permission Required", "Please allow microphone access.");
      }
    })();
  }, []);

  const toggleRecording = async () => {
    if (isLoading) return;
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  const startRecording = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      
      recordingRef.current = recording;
      setIsRecording(true);
      
    } catch (err) {
      console.error("Start Error:", err);
      Alert.alert("Error", "Could not start microphone.");
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    setIsLoading(true);

    const recording = recordingRef.current;
    if (!recording) {
      setIsLoading(false);
      return;
    }

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI(); 
      recordingRef.current = null;

      if (uri) {
        await uploadAudio(uri);
      } else {
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Stop Error:", error);
      setIsLoading(false);
    }
  };

  const uploadAudio = async (uri: string) => {
    try {
      const formData = new FormData();
      
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const audioBlob = await response.blob();
        formData.append('audio', audioBlob, 'upload.m4a');
        formData.append('context', context);
        formData.append('liveFeedback', liveFeedback.toString());

        const upload = await fetch(`${BASE_URL}/chat-audio`, {
          method: 'POST',
          body: formData,
        });
        const data = await upload.json();
        handleSuccess(data);
      } 
      else {
        const result = await FileSystem.uploadAsync(`${BASE_URL}/chat-audio`, uri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'audio',
          mimeType: 'audio/m4a',
          parameters: {
            context: context,
            liveFeedback: liveFeedback.toString(),
          },
        });

        if (result.status !== 200) throw new Error("Server Error");
        const data = JSON.parse(result.body);
        handleSuccess(data);
      }
    } catch (error) {
      console.error("Upload Failed", error);
      Alert.alert("Connection Error", "Could not reach the AI server.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuccess = (data: any) => {
    if (data.status === 'success') {
      setMessages(prev => [
        ...prev, 
        { sender: 'user', text: data.user_text },
        { sender: 'ai', text: data.reply }
      ]);
      if (data.audio) playAudio(data.audio);
    } else {
      Alert.alert("AI Error", "Could not understand audio.");
    }
  };

  const playAudio = async (base64Audio: string) => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: `data:audio/mp3;base64,${base64Audio}` },
        { shouldPlay: true }
      );
      await sound.playAsync();
    } catch (e) { console.log("Play error", e); }
  };

  return (
    <SafeAreaView style={styles.container}>
      
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dutch Voice Companion</Text>
        
        <View style={styles.contextContainer}>
          <Text style={styles.sectionLabel}>Context:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroll}>
            {['waiter', 'doctor', 'grocery'].map((c) => (
              <TouchableOpacity 
                key={c} 
                style={[styles.pill, context === c && styles.pillActive]} 
                onPress={() => setContext(c)}
              >
                <Text style={[styles.pillText, context === c && styles.pillTextActive]}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.sectionLabel}>Live Corrections</Text>
          <Switch 
            value={liveFeedback} 
            onValueChange={setLiveFeedback} 
            trackColor={{ false: "#767577", true: "#34C759" }}
          />
        </View>
      </View>

      <ScrollView style={styles.chatContainer} contentContainerStyle={{ paddingBottom: 20 }}>
        {messages.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>👋 Select a context and tap the mic to start speaking Dutch!</Text>
          </View>
        )}
        {messages.map((msg, index) => (
          <View key={index} style={[styles.bubble, msg.sender === 'user' ? styles.userBubble : styles.aiBubble]}>
            <Text style={msg.sender === 'user' ? styles.userText : styles.aiText}>
              {msg.text}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.micButton, 
            isRecording && styles.micActive,
            isLoading && styles.micLoading
          ]}
          onPress={toggleRecording}
          disabled={isLoading}
        >
          {isLoading ? (
             <ActivityIndicator size="large" color="#FFF" />
          ) : (
             <Text style={styles.micIcon}>{isRecording ? "⏹" : "🎤"}</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.micLabel}>
          {isLoading ? "Thinking..." : isRecording ? "Tap to Stop" : "Tap to Speak"}
        </Text>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7', paddingTop: Platform.OS === 'android' ? 30 : 0 },
  
  header: { backgroundColor: 'white', padding: 20, paddingBottom: 15, borderBottomWidth: 1, borderColor: '#E5E5EA' },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#000', textAlign: 'center', marginBottom: 20 },
  
  contextContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  sectionLabel: { fontSize: 16, fontWeight: '600', color: '#333', marginRight: 10 },
  pillScroll: { flexGrow: 0 },
  pill: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#F2F2F7', marginRight: 10 },
  pillActive: { backgroundColor: '#007AFF' },
  pillText: { fontSize: 14, color: '#333', fontWeight: '500' },
  pillTextActive: { color: 'white', fontWeight: '700' },
  
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  chatContainer: { flex: 1, padding: 15 },
  emptyContainer: { marginTop: 60, alignItems: 'center', paddingHorizontal: 40 },
  emptyText: { textAlign: 'center', color: '#8E8E93', fontSize: 16, lineHeight: 24 },
  
  bubble: { maxWidth: '80%', padding: 14, borderRadius: 18, marginBottom: 12 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#007AFF', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: '#E5E5EA', borderBottomLeftRadius: 4 },
  userText: { color: 'white', fontSize: 16, lineHeight: 22 },
  aiText: { color: '#000', fontSize: 16, lineHeight: 22 },

  footer: { alignItems: 'center', paddingVertical: 20, backgroundColor: 'white', borderTopWidth: 1, borderColor: '#E5E5EA' },
  micButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center', shadowColor: "#007AFF", shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  micActive: { backgroundColor: '#FF3B30', shadowColor: "#FF3B30" },
  micLoading: { backgroundColor: '#D1D1D6', shadowOpacity: 0 },
  micIcon: { fontSize: 32, color: 'white' },
  micLabel: { marginTop: 12, fontSize: 14, color: '#8E8E93', fontWeight: '500' }
});
