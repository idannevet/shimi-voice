'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

function loadHistory(): Message[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem('shimi-history') || '[]') } catch { return [] }
}
function saveHistory(msgs: Message[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem('shimi-history', JSON.stringify(msgs.slice(-200)))
}

export default function VoicePage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing' | 'speaking'>('idle')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [error, setError] = useState('')

  const recognitionRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)

  useEffect(() => { setMessages(loadHistory()) }, [])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, liveTranscript])

  const addMessage = useCallback((role: 'user' | 'assistant', text: string) => {
    const msg: Message = { id: Date.now().toString(), role, text, timestamp: Date.now() }
    setMessages(prev => {
      const updated = [...prev, msg]
      saveHistory(updated)
      return updated
    })
  }, [])

  // Send text to AI, get voice back
  const processMessage = useCallback(async (text: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setStatus('processing')
    addMessage('user', text)

    try {
      const history = loadHistory().slice(-40).map(m => ({ role: m.role, content: m.text }))

      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })
      if (!chatRes.ok) throw new Error('שגיאה')
      const { reply } = await chatRes.json()
      addMessage('assistant', reply)

      // TTS
      setStatus('speaking')
      const ttsRes = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply }),
      })

      if (ttsRes.ok) {
        const blob = await ttsRes.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio

        await new Promise<void>((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve() }
          audio.onerror = () => { URL.revokeObjectURL(url); resolve() }
          audio.play().catch(resolve)
        })
      }
    } catch (e: any) {
      setError(e.message || 'שגיאה')
    }

    busyRef.current = false
    setStatus('idle')
  }, [addMessage])

  // Push-to-talk: hold to record
  const startRecording = useCallback(() => {
    if (busyRef.current) return
    setError('')

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setError('צריך Chrome'); return }

    // Stop any playing audio
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }

    const recognition = new SR()
    recognition.lang = 'he-IL'
    recognition.continuous = true
    recognition.interimResults = true
    recognitionRef.current = recognition

    recognition.onresult = (e: any) => {
      let full = ''
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0].transcript
      }
      setLiveTranscript(full)
    }

    // Auto-restart if it stops unexpectedly (browser kills it after silence)
    recognition.onend = () => {
      if (recognitionRef.current === recognition && !busyRef.current) {
        try { recognition.start() } catch {}
      }
    }

    recognition.onerror = (e: any) => {
      if (e.error === 'no-speech') {
        // Browser stopped due to silence — restart
        if (recognitionRef.current === recognition && !busyRef.current) {
          try { recognition.start() } catch {}
        }
        return
      }
      if (e.error !== 'aborted') setError(`שגיאה: ${e.error}`)
    }

    recognition.start()
    setStatus('listening')
  }, [processMessage])

  const stopRecording = useCallback(() => {
    const rec = recognitionRef.current
    recognitionRef.current = null // prevent auto-restart
    try { rec?.stop() } catch {}
    const text = liveTranscript.trim()
    setLiveTranscript('')
    if (text) {
      processMessage(text)
    } else {
      setStatus('idle')
    }
  }, [liveTranscript, processMessage])

  const clearHistory = () => {
    if (confirm('למחוק היסטוריה?')) {
      setMessages([])
      localStorage.removeItem('shimi-history')
    }
  }

  const toggleRecording = () => {
    if (status === 'idle') startRecording()
    else if (status === 'listening') stopRecording()
  }

  return (
    <div style={{
      margin: 0, padding: 0, height: '100dvh',
      display: 'flex', flexDirection: 'column',
      background: '#0a0a0a', color: '#fff', fontFamily: "'Heebo', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #222', background: '#111', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 20,
            background: status !== 'idle' ? '#C8FF00' : '#333',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 800, color: status !== 'idle' ? '#000' : '#666',
          }}>ש</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>שימי</div>
            <div style={{ fontSize: 11, color: status === 'listening' ? '#C8FF00' : status === 'processing' ? '#f59e0b' : status === 'speaking' ? '#3b82f6' : '#666' }}>
              {status === 'idle' && 'לחץ כדי לדבר'}
              {status === 'listening' && '🎤 מקשיב... לחץ לשליחה'}
              {status === 'processing' && '🤔 חושב...'}
              {status === 'speaking' && '🔊 מדבר...'}
            </div>
          </div>
        </div>
        {messages.length > 0 && (
          <button onClick={clearHistory} style={{
            background: 'none', border: '1px solid #333', color: '#666',
            padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
          }}>🗑️</button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, textAlign: 'center', padding: 30 }}>
            <div style={{
              width: 90, height: 90, borderRadius: 45,
              background: 'linear-gradient(135deg, #C8FF00, #90B800)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 42, fontWeight: 900, color: '#000',
            }}>ש</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>שיחה קולית עם שימי</h1>
            <p style={{ color: '#9ca3af', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              לחץ על הכפתור כדי לדבר<br/>לחץ שוב כדי לשלוח
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = messages[i - 1]
          const showDate = !prev || new Date(msg.timestamp).toDateString() !== new Date(prev.timestamp).toDateString()
          return (
            <div key={msg.id}>
              {showDate && (
                <div style={{ textAlign: 'center', fontSize: 11, color: '#555', margin: '12px 0 8px' }}>
                  {new Date(msg.timestamp).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-start' : 'flex-end', maxWidth: '85%', marginLeft: msg.role === 'assistant' ? 'auto' : undefined }}>
                <div style={{
                  background: msg.role === 'user' ? '#1a1a1a' : '#C8FF00',
                  color: msg.role === 'user' ? '#fff' : '#000',
                  padding: '10px 14px', borderRadius: 16,
                  borderTopRightRadius: msg.role === 'assistant' ? 4 : 16,
                  borderTopLeftRadius: msg.role === 'user' ? 4 : 16,
                  fontSize: 15, lineHeight: 1.6, wordBreak: 'break-word',
                }}>
                  {msg.text}
                </div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 3 }}>
                  {new Date(msg.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )
        })}

        {liveTranscript && (
          <div style={{ maxWidth: '85%' }}>
            <div style={{ background: '#1a1a1a', border: '1px solid #C8FF00', color: '#C8FF00', padding: '10px 14px', borderRadius: 16, borderTopLeftRadius: 4, fontSize: 15 }}>
              {liveTranscript}
            </div>
          </div>
        )}

        {status === 'processing' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ background: '#1a1a1a', padding: '12px 20px', borderRadius: 16, borderTopRightRadius: 4, display: 'flex', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#C8FF00', animation: 'dot1 1s ease infinite' }} />
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#C8FF00', animation: 'dot2 1s ease infinite' }} />
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#C8FF00', animation: 'dot3 1s ease infinite' }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div style={{ padding: '6px 16px', background: '#ff444420', color: '#ff4444', textAlign: 'center', fontSize: 12 }}>{error}</div>
      )}

      {/* Push-to-talk button */}
      <div style={{
        padding: '20px', borderTop: '1px solid #222', background: '#111',
        display: 'flex', justifyContent: 'center', flexShrink: 0,
      }}>
        <button
          onClick={toggleRecording}
          disabled={status === 'processing' || status === 'speaking'}
          style={{
            width: 72, height: 72, borderRadius: 36, border: 'none',
            cursor: status === 'processing' || status === 'speaking' ? 'wait' : 'pointer',
            background: status === 'listening' ? '#ff4444' : status === 'processing' ? '#f59e0b' : status === 'speaking' ? '#3b82f6' : '#C8FF00',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 30, transition: 'background 0.2s, transform 0.1s',
            transform: status === 'listening' ? 'scale(1.15)' : 'scale(1)',
            boxShadow: status === 'listening' ? '0 0 40px rgba(255,68,68,0.5)' : '0 0 20px rgba(200,255,0,0.2)',
          }}
        >
          {status === 'listening' ? '⏹️' : status === 'processing' ? '🤔' : status === 'speaking' ? '🔊' : '🎤'}
        </button>
      </div>

      <style>{`
        @keyframes dot1 { 0%,100% { opacity: 0.3; } 33% { opacity: 1; } }
        @keyframes dot2 { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
        @keyframes dot3 { 0%,100% { opacity: 0.3; } 66% { opacity: 1; } }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
      `}</style>
    </div>
  )
}
