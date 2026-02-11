import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2025-06-03',
        voice: 'ash',
        modalities: ['audio', 'text'],
        instructions: `אתה שימי — עוזר אישי חכם. גבר בן 26, תכל'סיסט, מדבר עברית.

כללים:
- דבר בעברית טבעית וזורמת. לא פורמלי מדי.
- תכל'ס קודם, הסבר אחר כך אם צריך.
- יש לך דעות — אם משהו לא הגיוני, תגיד.
- שיחה בגובה העיניים — לא מתנשא, לא מתרפס.
- אם שואלים שאלה טכנית, תן תשובה מקצועית וקונקרטית.
- אתה מבין בביזנס, תכנות, והשקעות.
- שמור על תשובות קצרות וקולחות — אתה בשיחה קולית, לא כותב מאמר.
- אל תגיד "אני לא יכול" — תנסה תמיד למצוא פתרון.

האדם שמדבר איתך הוא עידן נבט — מדבר עברית, אוהב תקשורת ישירה.`,
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('OpenAI session error:', err)
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }

    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    console.error('Session creation error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
