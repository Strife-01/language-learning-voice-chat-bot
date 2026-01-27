import os
import base64
import re
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

g_history = []
g_context = "tutor"

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

@app.route('/reset_context', methods=['PUT'])
def reset_context():
    print('Resetting context')
    global g_context
    global g_history
    g_context = "tutor"
    g_history = []
    print('Finished resetting context')
    return "", 204

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
        context = request.form.get('context', 'tutor')
        live_feedback = request.form.get('liveFeedback') == 'true'

        global g_context
        global g_history
        if g_context != context:
            g_context = context
            g_history = []

        roles = {
            "waiter": {
                "desc": (
                    "You are a polite waiter at a Dutch café. The user is an international student ordering food/drinks. "
                    "Keep your responses concise, helpful, and natural for a restaurant setting. "
                    "Drive the conversation forward (e.g., asking about allergies, drinks, or the bill)."
                ),
                "fallback": [
                    "Sorry, dat begreep ik niet helemaal. Wilt u misschien de menukaart zien?",
                    "Het is erg druk in het café. Kan ik u alvast iets te drinken brengen?",
                    "Sorry, ik ben aan het werk. Wilt u nog iets bestellen?",
                    "Pardon? Ik hoorde u niet goed. Wilt u pinnen of contant betalen?"
                ]
            },
            "doctor": {
                "desc": (
                    "You are a Dutch General Practitioner ('huisarts'). The user is an international student visiting as a patient. "
                    "Be professional, empathetic, and clear. Ask relevant medical questions based on their complaints."
                ),
                "fallback": [
                    "Laten we ons op uw gezondheid richten. Waar heeft u precies last van?",
                    "Ik begrijp het, maar als huisarts wil ik graag weten hoe lang u deze klachten al heeft.",
                    "Dat is niet mijn expertise. Laten we kijken naar uw medische situatie.",
                    "Kunt u omschrijven waar de pijn precies zit?"
                ]
            },
            "grocery": {
                "desc": (
                    "You are a cashier at a Dutch supermarket. The user is a customer checking out at the counter. "
                    "Be efficient and friendly. Ask standard questions (e.g., 'Do you have a bonus card?', 'Receipt?')."
                ),
                "fallback": [
                    "Sorry, er staat een rij. Heeft u een bonuskaart?",
                    "Dat weet ik niet, ik zit achter de kassa. Wilt u het bonnetje mee?",
                    "Anders gaat u even naar de servicebalie. Wilt u pinnen?",
                    "Gaat het verder goed? Heeft u alles kunnen vinden?"
                ]
            },
            "tutor": {
                "desc": (
                    "You are a friendly Dutch native speaker having a casual conversation with an international student. "
                    "Your goal is to help them practice daily conversation."
                ),
                "fallback": [
                    "Dat begreep ik niet helemaal. Kun je dat in het Nederlands proberen?",
                    "Interessant! Maar laten we proberen een simpel gesprek te voeren. Hoe was je dag?",
                    "Wat bedoel je precies? Kun je het anders zeggen?",
                    "Zullen we oefenen met jezelf voorstellen?"
                ]
            }
        }

        current_role = roles.get(context, roles["tutor"])
        current_role_fallback = "\n".join([f'"{phrase}"' for phrase in current_role["fallback"]])

        history_str = "\n".join(g_history) if g_history else "No previous conversation."

        system_behavior = (
            f"{current_role['desc']}\n"
            "CONTEXT: The user is a beginner level Dutch learner. Match their tone naturally.\n"
            "CRITICAL FORMATTING RULES (Optimized for Text-to-Speech):\n"
            "1. Do NOT use markdown (bold, italics, headers).\n"
            "2. Do NOT use lists or complex symbols.\n"
            "3. Use only plain text and newlines.\n"
            "4. IF THE USER IS OFF-TOPIC: You must steer them back on topic. For example, the following phrases may be used:\n"
            f"{current_role_fallback}"
        )

        if live_feedback:
            prompt = (
                f"{system_behavior}\n\n"
                f"CONVERSATION HISTORY\n{history_str}\n\n"
                f"NEW USER INPUT: '{user_text}'\n\n"
                "TASK:\n"
                "1. Analyze input for grammatical errors. If the errors can be caused by microphone noise or input errors, interpret it as likely intended based on the context (e.g. \"acht\" instead of \"nacht\"). If the user input is in English, provide the Dutch translation.\n"
                "2. [Feedback]: In English, briefly and concisely correct errors without fluffing. If perfect, keep this empty.\n"
                "3. [Reply]: In Dutch, respond naturally to the content.\n"
                "4. FORMAT: You must strictly follow this format:\n"
                "[Feedback]\n(English correction here)\n\n[Reply]\n(Dutch response here)"
            )
        else:
            prompt = (
                f"{system_behavior}\n\n"
                f"CONVERSATION HISTORY\n{history_str}\n\n"
                f"NEW USER INPUT: '{user_text}'\n\n"
                "TASK:\n"
                "1. Ignore grammatical errors to prioritize flow.\n"
                "2. Respond naturally in Dutch.\n"
                "3. Do not output any English."
            )

        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_level="minimal")
            ),
            contents=prompt
        )

        raw_text = response.text.strip()
        feedback_text = None
        reply_text = raw_text

        if live_feedback:
            # Regex to split on the [Reply] tag
            parts = re.split(r'\[Reply\]', raw_text, flags=re.IGNORECASE)
            
            if len(parts) >= 2:
                # Part 0 is Feedback
                feedback_text = parts[0].replace('[Feedback]', '').strip()
                # Part 1 is the Dutch Reply
                reply_text = parts[1].strip()

                # Append to history
                g_history.append(f"User: {user_text}")
                g_history.append(f"{context}: {reply_text}")
            else:
                # Fallback if model missed the tag: treat whole thing as reply
                reply_text = raw_text
                # Append to history
                g_history.append(f"User: {user_text}")
                g_history.append(f"{context}: {raw_text}")
        else:
            # Append to history
            g_history.append(f"User: {user_text}")
            g_history.append(f"{context}: {raw_text}")

        # Limit history to prevent token overflow (last 25 interactions)
        if len(g_history) > 50:
            g_history = g_history[-50:]

        ai_audio = get_audio_output(reply_text if reply_text else "Sorry, I am silent.")

        return jsonify({
            "status": "success",
            "user_text": user_text,
            "raw_text": raw_text,
            "feedback": feedback_text,
            "reply": reply_text,
            "audio": ai_audio
        })

    except Exception as e:
        print("❌ ERROR:", e)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=True)
