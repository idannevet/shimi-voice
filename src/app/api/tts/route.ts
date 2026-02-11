import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json()
    if (!text?.trim()) {
      return NextResponse.json({ error: 'No text' }, { status: 400 })
    }

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: 'onyx', // Deep male voice, fits Shimi
        response_format: 'mp3',
        speed: 1.1, // Slightly faster for conversational feel
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('TTS error:', err)
      return NextResponse.json({ error: 'TTS error' }, { status: 500 })
    }

    const audioBuffer = await res.arrayBuffer()
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (e: any) {
    console.error('TTS error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
