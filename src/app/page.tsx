'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: Date
}

export default function VoicePage() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [messages, setMessages] = useState<Message[]>([])
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [currentTranscript, setCurrentTranscript] = useState('')
  const [assistantText, setAssistantText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentTranscript, assistantText])

  const addMessage = useCallback((role: 'user' | 'assistant', text: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString() + Math.random(),
      role, text, timestamp: new Date(),
    }])
  }, [])

  const connect = async () => {
    setStatus('connecting')
    setErrorMsg('')

    try {
      // 1. Get ephemeral token
      const tokenRes = await fetch('/api/session', { method: 'POST' })
      if (!tokenRes.ok) throw new Error('Failed to get session token')
      const session = await tokenRes.json()
      if (session.error) throw new Error(session.error)

      const ephemeralKey = session.client_secret?.value
      if (!ephemeralKey) throw new Error('No ephemeral key in response')

      // 2. Create peer connection
      const pc = new RTCPeerConnection()
      pcRef.current = pc

      // 3. Set up audio output
      const audioEl = document.createElement('audio')
      audioEl.autoplay = true
      audioRef.current = audioEl

      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0]
      }

      // 4. Capture mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioTrack = stream.getTracks()[0]
      pc.addTrack(audioTrack, stream)

      // 5. Data channel for events
      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc

      dc.onopen = () => {
        setStatus('connected')
        setIsListening(true)
      }

      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data)
          handleServerEvent(event)
        } catch {}
      }

      dc.onerror = (e) => {
        console.error('DC error:', e)
      }

      // 6. Create offer and connect to OpenAI
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ephemeralKey}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        }
      )

      if (!sdpRes.ok) throw new Error('Failed to connect to OpenAI Realtime')

      const answerSdp = await sdpRes.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

    } catch (err: any) {
      console.error('Connection error:', err)
      setStatus('error')
      setErrorMsg(err.message || 'שגיאה בחיבור')
    }
  }

  const handleServerEvent = (event: any) => {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        setIsSpeaking(true)
        setCurrentTranscript('')
        break

      case 'input_audio_buffer.speech_stopped':
        setIsSpeaking(false)
        break

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) {
          addMessage('user', event.transcript)
          setCurrentTranscript('')
        }
        break

      case 'response.audio_transcript.delta':
        setAssistantText(prev => prev + (event.delta || ''))
        setIsListening(false)
        break

      case 'response.audio_transcript.done':
        if (event.transcript) {
          addMessage('assistant', event.transcript)
        }
        setAssistantText('')
        setIsListening(true)
        break

      case 'response.done':
        setIsListening(true)
        break

      case 'error':
        console.error('Server error:', event.error)
        setErrorMsg(event.error?.message || 'שגיאה מהשרת')
        break
    }
  }

  const disconnect = () => {
    pcRef.current?.close()
    pcRef.current = null
    dcRef.current = null
    if (audioRef.current) {
      audioRef.current.srcObject = null
    }
    setStatus('idle')
    setIsListening(false)
    setIsSpeaking(false)
    setCurrentTranscript('')
    setAssistantText('')
  }

  return (
    <div style={{
      margin: 0, padding: 0, height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0a0a0a', color: '#fff', fontFamily: "'Heebo', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #222', background: '#111', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 22, background: '#C8FF00',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 800, color: '#000',
          }}>ש</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>שימי</div>
            <div style={{ fontSize: 12, color: status === 'connected' ? '#C8FF00' : '#666' }}>
              {status === 'idle' && 'לא מחובר'}
              {status === 'connecting' && 'מתחבר...'}
              {status === 'connected' && (isListening ? '🎤 מקשיב...' : '🔊 מדבר...')}
              {status === 'error' && '❌ שגיאה'}
            </div>
          </div>
        </div>
        {status === 'connected' && (
          <button onClick={disconnect} style={{
            background: '#ff4444', border: 'none', color: '#fff', padding: '8px 16px',
            borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
            fontFamily: "'Heebo', sans-serif",
          }}>
            נתק
          </button>
        )}
      </div>

      {/* Messages Area */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '20px', display: 'flex',
        flexDirection: 'column', gap: 12,
      }}>
        {messages.length === 0 && status === 'idle' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 24, textAlign: 'center', padding: 40,
          }}>
            <div style={{
              width: 100, height: 100, borderRadius: 50, background: 'linear-gradient(135deg, #C8FF00, #90B800)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 48, fontWeight: 900, color: '#000',
              boxShadow: '0 0 60px rgba(200,255,0,0.2)',
            }}>ש</div>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>שיחה עם שימי</h1>
              <p style={{ color: '#9ca3af', fontSize: 15, marginTop: 8, lineHeight: 1.6 }}>
                לחץ על הכפתור למטה כדי להתחיל שיחה קולית<br/>
                דבר בחופשיות — שימי מקשיב ועונה בזמן אמת
              </p>
            </div>
            <div style={{
              display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8,
            }}>
              {['💬 שיחה חופשית', '📊 ייעוץ עסקי', '💻 שאלות טכניות', '💡 רעיונות'].map(tag => (
                <span key={tag} style={{
                  background: '#1a1a1a', border: '1px solid #333', borderRadius: 20,
                  padding: '6px 14px', fontSize: 13, color: '#9ca3af',
                }}>{tag}</span>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={{
            alignSelf: msg.role === 'user' ? 'flex-start' : 'flex-end',
            maxWidth: '80%',
          }}>
            <div style={{
              background: msg.role === 'user' ? '#1a1a1a' : '#C8FF00',
              color: msg.role === 'user' ? '#fff' : '#000',
              padding: '10px 16px', borderRadius: 16,
              borderTopRightRadius: msg.role === 'assistant' ? 4 : 16,
              borderTopLeftRadius: msg.role === 'user' ? 4 : 16,
              fontSize: 15, lineHeight: 1.5,
            }}>
              {msg.text}
            </div>
            <div style={{
              fontSize: 11, color: '#555', marginTop: 4,
              textAlign: msg.role === 'user' ? 'right' : 'left',
            }}>
              {msg.timestamp.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}

        {/* Live assistant transcript */}
        {assistantText && (
          <div style={{ alignSelf: 'flex-end', maxWidth: '80%' }}>
            <div style={{
              background: '#C8FF00', color: '#000', padding: '10px 16px',
              borderRadius: 16, borderTopRightRadius: 4, fontSize: 15, lineHeight: 1.5,
              opacity: 0.8,
            }}>
              {assistantText}
              <span style={{ animation: 'blink 1s infinite', marginRight: 2 }}>▍</span>
            </div>
          </div>
        )}

        {/* Speaking indicator */}
        {isSpeaking && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '80%' }}>
            <div style={{
              background: '#1a1a1a', color: '#C8FF00', padding: '10px 16px',
              borderRadius: 16, borderTopLeftRadius: 4, fontSize: 14,
            }}>
              🎤 מדבר...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {errorMsg && (
        <div style={{
          padding: '8px 16px', background: '#ff444420', color: '#ff4444',
          textAlign: 'center', fontSize: 13, borderTop: '1px solid #ff444440',
        }}>
          {errorMsg}
        </div>
      )}

      {/* Bottom Bar */}
      <div style={{
        padding: '16px 20px', borderTop: '1px solid #222', background: '#111',
        display: 'flex', justifyContent: 'center', flexShrink: 0,
      }}>
        {status === 'idle' || status === 'error' ? (
          <button onClick={connect} style={{
            width: 72, height: 72, borderRadius: 36,
            background: 'linear-gradient(135deg, #C8FF00, #90B800)',
            border: 'none', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 30px rgba(200,255,0,0.3)',
            transition: 'transform 0.2s, box-shadow 0.2s',
            fontSize: 30,
          }}
          onMouseOver={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 0 50px rgba(200,255,0,0.5)'; }}
          onMouseOut={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 0 30px rgba(200,255,0,0.3)'; }}
          >
            🎤
          </button>
        ) : status === 'connecting' ? (
          <div style={{
            width: 72, height: 72, borderRadius: 36,
            border: '3px solid #333', borderTopColor: '#C8FF00',
            animation: 'spin 1s linear infinite',
          }} />
        ) : (
          /* Connected — audio visualizer */
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 3, height: 48,
            }}>
              {[...Array(12)].map((_, i) => (
                <div key={i} style={{
                  width: 4, borderRadius: 2,
                  background: isListening ? '#C8FF00' : (isSpeaking ? '#C8FF00' : '#333'),
                  height: isListening || isSpeaking
                    ? `${12 + Math.sin(Date.now() / 200 + i) * 16 + Math.random() * 8}px`
                    : '8px',
                  transition: 'height 0.15s ease',
                  animation: (isListening || isSpeaking) ? `bar 0.5s ease ${i * 0.05}s infinite alternate` : 'none',
                }} />
              ))}
            </div>
            <button onClick={disconnect} style={{
              width: 56, height: 56, borderRadius: 28,
              background: '#ff4444', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, color: '#fff',
              transition: 'transform 0.2s',
            }}
            onMouseOver={e => e.currentTarget.style.transform = 'scale(1.1)'}
            onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes bar {
          0% { height: 8px; }
          100% { height: 36px; }
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        ::selection { background: rgba(200,255,0,0.3); }
      `}</style>
    </div>
  )
}
