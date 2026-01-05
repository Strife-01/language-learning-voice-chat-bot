import os
import base64
import subprocess
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from google.genai import types
from google.cloud import texttospeech, speech

app = Flask(__name__)
CORS(app)

load_dotenv()
API_KEY = os.getenv("GOOGLE_API_KEY")
SERVER_HOST = os.getenv("SERVER_HOST")
SERVER_PORT = os.getenv("SERVER_PORT")
client = genai.Client(api_key=API_KEY)

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "google-key.json"

tts_client = texttospeech.TextToSpeechClient()
stt_client = speech.SpeechClient()

def transcribe_audio(file_path):
    wav_path = "temp_input.wav"
    
    if not os.path.exists(file_path):
        print("❌ DEBUG: Input file does not exist!")
        return ""
    file_size = os.path.getsize(file_path)
    print(f"🎤 DEBUG: Received Audio File Size: {file_size} bytes")

    command = ['ffmpeg', '-i', file_path, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', wav_path]
    
    try:
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            print("❌ DEBUG: FFmpeg failed!")
            print(result.stderr)
            return ""
    except FileNotFoundError:
        print("❌ DEBUG: FFmpeg not found! strict Make sure you ran 'brew install ffmpeg'")
        return ""

    with open(wav_path, "rb") as audio_file:
        content = audio_file.read()

    audio_data = speech.RecognitionAudio(content=content)
    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=16000,
        language_code="nl-NL", 
        alternative_language_codes=["en-US"],
    )

    print("☁️ DEBUG: Sending to Google STT...")
    response = stt_client.recognize(config=config, audio=audio_data)
    
    if os.path.exists(wav_path):
        os.remove(wav_path)

    if response.results:
        text = response.results[0].alternatives[0].transcript
        print(f"✅ DEBUG: Transcription success: '{text}'")
        return text
    
    print("⚠️ DEBUG: Google returned no text (Silence?)")
    return ""

def get_audio_output(text):
    synthesis_input = texttospeech.SynthesisInput(text=text)
    voice = texttospeech.VoiceSelectionParams(
        language_code="nl-NL", 
        name="nl-NL-Wavenet-B", 
        ssml_gender=texttospeech.SsmlVoiceGender.MALE
    )
    audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
    response = tts_client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
    return base64.b64encode(response.audio_content).decode('utf-8')

@app.route('/chat-audio', methods=['POST'])
def chat_audio():
    print("\n--- NEW REQUEST ---")
    
    if 'audio' not in request.files:
        print("❌ DEBUG: No 'audio' file in request.files")
        return jsonify({"error": "No audio file provided"}), 400
    
    audio_file = request.files['audio']
    if audio_file.filename == '':
        print("❌ DEBUG: Filename is empty")
        return jsonify({"error": "No selected file"}), 400

    temp_filename = "temp_user_recording.m4a"
    audio_file.save(temp_filename)

    user_text = transcribe_audio(temp_filename)
    
    if os.path.exists(temp_filename):
        os.remove(temp_filename)

    if not user_text:
        return jsonify({"error": "No speech detected. Try speaking louder."}), 400

    try:
        context = request.form.get('context', 'waiter')
        live_feedback = request.form.get('liveFeedback') == 'true'

        base_role = "You are a friendly Dutch tutor."
        if context == "waiter": base_role = "You are a Dutch waiter."
        elif context == "doctor": base_role = "You are a Dutch doctor."
        elif context == "grocery": base_role = "You are a cashier."

        if live_feedback:
             prompt = (f"{base_role} The user is learning Dutch. They said: '{user_text}'. "
                       f"1. In ENGLISH, briefly correct grammar errors. "
                       f"2. Then reply in DUTCH. Format: [Feedback] [Reply]")
        else:
             prompt = f"{base_role} Reply naturally in Dutch to: '{user_text}'"

        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_level="minimal")
            ),
            contents=prompt
        )

        ai_reply = response.text

        ai_audio = get_audio_output(ai_reply)

        return jsonify({
            "user_text": user_text,
            "reply": ai_reply,
            "audio": ai_audio,
            "status": "success"
        })

    except Exception as e:
        print("❌ ERROR:", e)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=True)
