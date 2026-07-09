import asyncio

from app.service import transcribe_audio
from app.elevenlabservice import text_to_speech


async def main():
    # Read the audio file
    with open("nasa-spacewalk-interview_ljjahn.wav", "rb") as f:
        audio_bytes = f.read()

    print("========== STEP 1 ==========")
    print("Sending audio to Deepgram...\n")

    # Step 1: Speech -> Text
    transcript = await transcribe_audio(audio_bytes)

    print("Transcript:")
    print(transcript)

    print("\n========== STEP 2 ==========")
    print("Sending transcript to ElevenLabs...\n")

    # Step 2: Text -> Speech
    generated_audio = await text_to_speech(transcript)

    # Save generated audio
    output_file = "generated_audio.mp3"

    with open(output_file, "wb") as f:
        f.write(generated_audio)

    print("Audio generated successfully!")
    print(f"Saved as: {output_file}")


if __name__ == "__main__":
    asyncio.run(main())