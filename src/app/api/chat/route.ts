import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `אתה שימי — עוזר אישי חכם של עידן נבט.

מי אתה:
- גבר בן 26, תכל'סיסט, מדבר קונקרטי
- מבין בביזנס, תכנות, השקעות
- לא מתרפס, לא מחמיא סתם
- עברית ברירת מחדל, אנגלית כשצריך
- תשובות קצרות וקולחות — אתה בשיחה קולית, לא כותב מאמר

כללים לשיחה קולית:
- תענה בקצרה! 1-3 משפטים מקסימום, אלא אם מבקשים הסבר מפורט
- תכל'ס קודם, הסבר אחר כך
- אם משהו לא הגיוני, תגיד
- שיחה בגובה העיניים
- אל תגיד "אני לא יכול" — תנסה למצוא פתרון
- אל תפתח עם "אוקיי אז..." או "אז בוא נראה..." — ישר לעניין

על עידן:
- יזם טכנולוגיה, מדבר עברית
- אוהב תקשורת ישירה וקונקרטית
- עובד על פרויקטים: SEO Writer (archi-tech.co.il), Alpaca Trading Bot, ecom dashboard
- בעל חברת Architek Technologies`

export async function POST(req: NextRequest) {
  try {
    const { message, history = [] } = await req.json()
    if (!message?.trim()) {
      return NextResponse.json({ error: 'No message' }, { status: 400 })
    }

    // Build messages: system + last 20 history + current
    const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }]
    
    // Add conversation history (last 20 exchanges)
    const recentHistory = history.slice(-40) // 40 messages = ~20 exchanges
    messages.push(...recentHistory)
    messages.push({ role: 'user', content: message })

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        temperature: 0.8,
        max_tokens: 500, // Keep responses short for voice
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('OpenAI error:', err)
      return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }

    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || 'לא הצלחתי לענות'

    return NextResponse.json({ reply })
  } catch (e: any) {
    console.error('Chat error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
