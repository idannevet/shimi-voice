'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

// localStorage history
function loadHistory(): Message[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem('shimi-history') || '[]') } catch { return [] }
}
function saveHistory(msgs: Message[]) {
  if (typeof window === 'undefined') return
  // Keep last 200 messages
  const trimmed = msgs.slice(-200)
  localStorage.setItem('shimi-history', JSON.stringify(trimmed))
}

export default function VoicePage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isListening, setIsListening] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'idle' | 'active'>('idle')
  
  const recognitionRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load history on mount
  useEffect(() => { setMessages(loadHistory()) }, [])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, liveTranscript])

  const addMessage = useCallback((role: 'user' | 'assistant', text: string) => {
    const msg: Message = { id: Date.now().toString() + Math.random(), role, text, timestamp: Date.now() }
    setMessages(prev => {
      const updated = [...prev, msg]
      saveHistory(updated)
      return updated
    })
    return msg
  }, [])

  // ===== SPEECH RECOGNITION =====
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { setError('הדפדפן לא תומך בזיהוי קול. נסה Chrome.'); return }

    const recognition = new SR()
    recognition.lang = 'he-IL'
    recognition.continuous = true
    recognition.interimResults = true
    recognitionRef.current = recognition

    recognition.onresult = (e: any) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      setLiveTranscript(interim)
      if (final.trim()) {
        setLiveTranscript('')
        handleUserMessage(final.trim())
      }
    }

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError(`שגיאה בזיהוי קול: ${e.error}`)
      }
    }

    recognition.onend = () => {
      // Auto-restart if still in active mode
      if (mode === 'active' && !isProcessing && !isSpeaking) {
        try { recognition.start() } catch {}
      } else {
        setIsListening(false)
      }
    }

    try {
      recognition.start()
      setIsListening(true)
      setError('')
    } catch (e: any) {
      setError('לא ניתן להפעיל מיקרופון')
    }
  }, [mode, isProcessing, isSpeaking])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setIsListening(false)
    setLiveTranscript('')
  }, [])

  // ===== HANDLE MESSAGE =====
  const handleUserMessage = useCallback(async (text: string) => {
    // Pause recognition while processing
    recognitionRef.current?.stop()
    setIsListening(false)
    setIsProcessing(true)

    addMessage('user', text)

    try {
      // Get current history for context
      const currentHistory = loadHistory()
      const historyForApi = currentHistory.slice(-40).map(m => ({
        role: m.role, content: m.text
      }))

      // 1. Get AI response
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historyForApi }),
      })
      
      if (!chatRes.ok) throw new Error('שגיאה בקבלת תשובה')
      const { reply } = await chatRes.json()

      addMessage('assistant', reply)
      setIsProcessing(false)

      // 2. Convert to speech
      setIsSpeaking(true)
      const ttsRes = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reply }),
      })

      if (ttsRes.ok) {
        const audioBlob = await ttsRes.blob()
        const audioUrl = URL.createObjectURL(audioBlob)
        const audio = new Audio(audioUrl)
        audioRef.current = audio
        
        audio.onended = () => {
          setIsSpeaking(false)
          URL.revokeObjectURL(audioUrl)
          // Resume listening
          if (mode === 'active') {
            setTimeout(() => startListening(), 300)
          }
        }
        
        audio.onerror = () => {
          setIsSpeaking(false)
          if (mode === 'active') startListening()
        }

        await audio.play()
      } else {
        setIsSpeaking(false)
        if (mode === 'active') startListening()
      }

    } catch (e: any) {
      setError(e.message || 'שגיאה')
      setIsProcessing(false)
      setIsSpeaking(false)
      if (mode === 'active') startListening()
    }
  }, [addMessage, mode, startListening])

  // ===== TOGGLE VOICE MODE =====
  const toggleVoice = () => {
    if (mode === 'active') {
      setMode('idle')
      stopListening()
      audioRef.current?.pause()
      setIsSpeaking(false)
      setIsProcessing(false)
    } else {
      setMode('active')
      startListening()
    }
  }

  // Update recognition restart behavior when mode changes
  useEffect(() => {
    if (mode === 'active' && !isListening && !isProcessing && !isSpeaking) {
      startListening()
    }
  }, [mode, isListening, isProcessing, isSpeaking])

  const clearHistory = () => {
    if (confirm('למחוק את כל היסטוריית השיחות?')) {
      setMessages([])
      localStorage.removeItem('shimi-history')
    }
  }

  const currentState = isProcessing ? 'thinking' : isSpeaking ? 'speaking' : isListening ? 'listening' : 'idle'

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
            background: mode === 'active' ? '#C8FF00' : '#333',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 800, color: mode === 'active' ? '#000' : '#666',
            transition: 'all 0.3s',
          }}>ש</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>שימי</div>
            <div style={{
              fontSize: 11,
              color: currentState === 'listening' ? '#C8FF00' : currentState === 'thinking' ? '#f59e0b' : currentState === 'speaking' ? '#3b82f6' : '#666',
            }}>
              {currentState === 'idle' && 'לחץ על המיקרופון כדי לדבר'}
              {currentState === 'listening' && '🎤 מקשיב...'}
              {currentState === 'thinking' && '🤔 חושב...'}
              {currentState === 'speaking' && '🔊 מדבר...'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {messages.length > 0 && (
            <button onClick={clearHistory} style={{
              background: 'none', border: '1px solid #333', color: '#666',
              padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
              fontFamily: "'Heebo', sans-serif",
            }}>🗑️</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '16px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {messages.length === 0 && mode === 'idle' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 20, textAlign: 'center', padding: 30,
          }}>
            <div style={{
              width: 90, height: 90, borderRadius: 45,
              background: 'linear-gradient(135deg, #C8FF00, #90B800)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 42, fontWeight: 900, color: '#000',
              boxShadow: '0 0 60px rgba(200,255,0,0.15)',
            }}>ש</div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>שיחה קולית עם שימי</h1>
              <p style={{ color: '#9ca3af', fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
                לחץ על הכפתור למטה ודבר<br/>
                שימי מקשיב, חושב, ועונה בקול<br/>
                <span style={{ color: '#666', fontSize: 12 }}>ההיסטוריה נשמרת בין שיחות</span>
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // Show date separator
          const prevMsg = messages[i - 1]
          const showDate = !prevMsg || new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString()
          
          return (
            <div key={msg.id}>
              {showDate && (
                <div style={{
                  textAlign: 'center', fontSize: 11, color: '#555',
                  margin: '12px 0 8px',
                }}>
                  {new Date(msg.timestamp).toLocaleDateString('he-IL', {
                    weekday: 'short', day: 'numeric', month: 'short',
                  })}
                </div>
              )}
              <div style={{ alignSelf: msg.role === 'user' ? 'flex-start' : 'flex-end', maxWidth: '85%', display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-start' : 'flex-end' }}>
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

        {/* Live transcript */}
        {liveTranscript && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
            <div style={{
              background: '#1a1a1a', border: '1px solid #C8FF00', color: '#C8FF00',
              padding: '10px 14px', borderRadius: 16, borderTopLeftRadius: 4,
              fontSize: 15, opacity: 0.8,
            }}>
              {liveTranscript}
              <span style={{ animation: 'blink 1s infinite' }}>▍</span>
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {isProcessing && (
          <div style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
            <div style={{
              background: '#1a1a1a', padding: '12px 20px', borderRadius: 16, borderTopRightRadius: 4,
              display: 'flex', gap: 6, alignItems: 'center',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: '#C8FF00', animation: 'bounce 0.6s ease infinite' }} />
              <div style={{ width: 8, height: 8, borderRadius: 4, background: '#C8FF00', animation: 'bounce 0.6s ease 0.15s infinite' }} />
              <div style={{ width: 8, height: 8, borderRadius: 4, background: '#C8FF00', animation: 'bounce 0.6s ease 0.3s infinite' }} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '6px 16px', background: '#ff444420', color: '#ff4444',
          textAlign: 'center', fontSize: 12,
        }}>{error}</div>
      )}

      {/* Bottom */}
      <div style={{
        padding: '16px 20px', borderTop: '1px solid #222', background: '#111',
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16,
        flexShrink: 0,
      }}>
        {mode === 'active' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 40 }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{
                width: 3, borderRadius: 2, background: '#C8FF00',
                transition: 'height 0.15s',
                animation: currentState === 'listening'
                  ? `bar 0.4s ease ${i * 0.05}s infinite alternate`
                  : currentState === 'speaking'
                  ? `bar 0.3s ease ${i * 0.04}s infinite alternate`
                  : 'none',
                height: currentState === 'idle' || currentState === 'thinking' ? '6px' : '6px',
              }} />
            ))}
          </div>
        )}

        <button onClick={toggleVoice} style={{
          width: 64, height: 64, borderRadius: 32, border: 'none', cursor: 'pointer',
          background: mode === 'active'
            ? (currentState === 'listening' ? '#C8FF00' : currentState === 'thinking' ? '#f59e0b' : currentState === 'speaking' ? '#3b82f6' : '#C8FF00')
            : 'linear-gradient(135deg, #C8FF00, #90B800)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: mode === 'active' ? `0 0 30px ${currentState === 'listening' ? 'rgba(200,255,0,0.4)' : currentState === 'speaking' ? 'rgba(59,130,246,0.4)' : 'rgba(245,158,11,0.4)'}` : '0 0 20px rgba(200,255,0,0.2)',
          transition: 'all 0.3s',
          fontSize: 28,
          animation: currentState === 'listening' ? 'pulse 2s ease infinite' : 'none',
        }}>
          {mode === 'idle' ? '🎤' : mode === 'active' && currentState === 'listening' ? '🎤' : currentState === 'thinking' ? '🤔' : currentState === 'speaking' ? '🔊' : '⏹️'}
        </button>

        {mode === 'active' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 40 }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{
                width: 3, borderRadius: 2, background: '#C8FF00',
                transition: 'height 0.15s',
                animation: currentState === 'listening'
                  ? `bar 0.4s ease ${i * 0.05 + 0.2}s infinite alternate`
                  : currentState === 'speaking'
                  ? `bar 0.3s ease ${i * 0.04 + 0.15}s infinite alternate`
                  : 'none',
                height: '6px',
              }} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0; } }
        @keyframes bounce {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes bar {
          0% { height: 6px; }
          100% { height: 28px; }
        }
        @keyframes pulse {
          0%,100% { box-shadow: 0 0 20px rgba(200,255,0,0.3); }
          50% { box-shadow: 0 0 40px rgba(200,255,0,0.6); }
        }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        ::selection { background: rgba(200,255,0,0.3); }
      `}</style>
    </div>
  )
}
