#!/usr/bin/env python3
"""
MOSS TTS client — calls the Gradio-based MOSS TTS service for GPU-accelerated speech synthesis.

Usage:
  python3 moss-tts.py <text> <output_filepath> [reference_audio_path_or_url]

Environment:
  MOSS_TTS_URL  — URL of the Gradio app (e.g. http://127.0.0.1:7860)
"""

import sys
import os
import shutil


def main():
    if len(sys.argv) < 3:
        print("ERROR: Usage: moss-tts.py <text> <output_path> [reference_audio]", file=sys.stderr)
        sys.exit(1)

    text = sys.argv[1]
    output_path = sys.argv[2]
    reference_audio = sys.argv[3] if len(sys.argv) > 3 else None

    moss_url = os.environ.get('MOSS_TTS_URL', '').strip()
    if not moss_url:
        print("ERROR: MOSS_TTS_URL not set", file=sys.stderr)
        sys.exit(1)

    try:
        from gradio_client import Client, handle_file
    except ImportError:
        print("ERROR: gradio_client not installed. Run: pip3 install gradio_client", file=sys.stderr)
        sys.exit(1)

    try:
        client = Client(moss_url, verbose=False)

        # Resolve reference audio
        ref_audio = None
        if reference_audio:
            if reference_audio.startswith('http://') or reference_audio.startswith('https://'):
                ref_audio = handle_file(reference_audio)
            elif os.path.exists(reference_audio):
                ref_audio = handle_file(reference_audio)
            else:
                print(f"WARN: reference audio not found: {reference_audio}, proceeding without it", file=sys.stderr)

        result = client.predict(
            text=text,
            reference_audio=ref_audio,
            mode_with_reference="Clone",
            duration_control_enabled=False,
            duration_tokens=1,
            temperature=1.7,
            top_p=0.8,
            top_k=25,
            repetition_penalty=1,
            max_new_tokens=4096,
            api_name="/lambda"
        )

        audio_path = result[0]
        status = result[1] if len(result) > 1 else ""

        if not audio_path or not os.path.exists(audio_path):
            print(f"ERROR: MOSS TTS produced no audio. Status: {status}", file=sys.stderr)
            sys.exit(1)

        shutil.copy(audio_path, output_path)
        print(f"OK:{output_path}")

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
