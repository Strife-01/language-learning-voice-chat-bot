import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Switch, ScrollView,
  SafeAreaView, ActivityIndicator, Platform, Alert, Image, RefreshControl,
  Pressable
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:40811';

export default function HomeScreen() {
  const user_ai_roles: Record<string, string[]> = {
    waiter: ['international student ordering food/drinks', 'polite waiter at a Dutch café'],
    doctor: ['international student visiting as a patient', 'Dutch General Practitioner (\'huisarts\')'],
    grocery: ['customer checking out at the counter', 'cashier at a Dutch supermarket']
  }
  const [context, setContext] = useState('waiter');
  const [userAiPairDescription, setUserAiPairDescription] = useState(user_ai_roles.waiter);
  const [liveFeedback, setLiveFeedback] = useState(true);
  const [messages, setMessages] = useState<any[]>([]);
  const [displayRoles, setDisplayRoles] = useState(true);

  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);

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

  const resetHistory = async () => {
    setDisplayRoles(false);
    try {
      const reset = await fetch(`${BASE_URL}/reset_context`, {
        method: 'PUT',
      });
      if (reset.status != 204) {
        console.log("Could not reset history.");
      }
      setMessages([]);
      setDisplayRoles(true);
    } catch (e) {
      console.log(e)
    }
  }

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
      let newMessages = [];
      newMessages.push({
        sender: 'user',
        text: data.user_text,
        feedback: liveFeedback && data.feedback ? data.feedback : null,
        showFeedback: false
      });
      newMessages.push({ sender: 'ai', text: data.reply });
      setMessages(prev => [
        ...prev,
        ...newMessages
      ]);
      if (data.audio) playAudio(data.audio);
    } else {
      Alert.alert("AI Error", "Could not understand audio.");
    }
  };

  const toggleFeedback = (index: number) => {
    setMessages(prev => {
      const updated = [...prev];
      if (updated[index].sender === 'user') {
        updated[index] = { ...updated[index], showFeedback: !updated[index].showFeedback };
      }
      return updated;
    });
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

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await resetHistory();
    setRefreshing(false);
  }, []);

  return (
    <SafeAreaView style={styles.container}>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dutch Voice Companion</Text>

        <View style={styles.contextContainer}>

          <Text style={styles.sectionLabel}>Context:</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-start' }}
          >
            {['waiter', 'doctor', 'grocery'].map((c) => (
              <TouchableOpacity
                key={c}
                style={[
                  styles.pill,
                  { marginRight: 5 },
                  context === c && styles.pillActive
                ]}
                onPress={() => {
                  setUserAiPairDescription(user_ai_roles[c]);
                  setMessages([]);
                  setContext(c);
                  setDisplayRoles(true);
                }}
              >
                <Text style={[styles.pillText, context === c && styles.pillTextActive]}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={{ flex: 1, flexDirection: 'row-reverse', alignItems: 'center' }}>
            <Pressable
              key="reset_history"
              onPress={() => resetHistory()}
              style={({ pressed }) => [
                styles.pill,
                { marginLeft: 10 },
                pressed && styles.pillActive
              ]}
            >
              {({ pressed }) => (
                <Text style={[styles.pillText, pressed && styles.pillTextActive]}>
                  Reset Context
                </Text>
              )}
            </Pressable>

          </View>
        </View>

        {displayRoles && <View style={styles.rolesContainer}>
          <Text style={styles.sectionLabel}>User Role: {userAiPairDescription[0]}</Text>
          <Text style={styles.sectionLabel}>AI Role: {userAiPairDescription[1]}</Text>
        </View>}

        <View style={styles.toggleRow}>
          <Text style={styles.sectionLabel}>Live Corrections</Text>
          <Switch
            value={liveFeedback}
            onValueChange={setLiveFeedback}
            trackColor={{ false: "#767577", true: "#34C759" }}
          />
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.chatContainer}
        contentContainerStyle={{ paddingBottom: 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>👋 Select a context and tap the mic to start speaking Dutch!</Text>
          </View>
        )}
        {messages.map((msg, index) => (
          <View key={index} style={{ marginBottom: 12 }}>
            <View style={[styles.bubble, msg.sender === 'user' ? styles.userBubble : styles.aiBubble]}>
              <Text style={msg.sender === 'user' ? styles.userText : styles.aiText}>
                {msg.text}
              </Text>
            </View>

            {msg.sender === 'user' && msg.feedback && (
              <TouchableOpacity
                onPress={() => toggleFeedback(index)}
                style={{ alignSelf: 'flex-end', marginTop: 4, marginRight: 4, marginBottom: 4 }}
              >
                <Text style={{ color: '#8E8E93', fontSize: 13, fontWeight: '500' }}>
                  {msg.showFeedback ? "Hide Correction" : "Show Correction"}
                </Text>
              </TouchableOpacity>
            )}

            {msg.sender === 'user' && msg.showFeedback && msg.feedback && (
              <View style={[styles.bubble, styles.feedbackBubble]}>
                <Text style={styles.feedbackText}>
                  {msg.feedback}
                </Text>
              </View>
            )}
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
  rolesContainer: { marginTop: 5, marginBottom: 20, marginLeft: 15, backgroundColor: '#fff', borderRadius: 8 },
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
  feedbackBubble: { alignSelf: 'flex-end', backgroundColor: '#535353', borderTopRightRadius: 4, marginTop: 12 },
  userText: { color: 'white', fontSize: 16, lineHeight: 22 },
  aiText: { color: '#000', fontSize: 16, lineHeight: 22 },
  feedbackText: { color: '#ffffff', fontSize: 16, lineHeight: 22 },

  footer: { alignItems: 'center', paddingVertical: 20, backgroundColor: 'white', borderTopWidth: 1, borderColor: '#E5E5EA' },
  micButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center', shadowColor: "#007AFF", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  micActive: { backgroundColor: '#FF3B30', shadowColor: "#FF3B30" },
  micLoading: { backgroundColor: '#D1D1D6', shadowOpacity: 0 },
  micIcon: { fontSize: 32, color: 'white' },
  micLabel: { marginTop: 12, fontSize: 14, color: '#8E8E93', fontWeight: '500' }
});
