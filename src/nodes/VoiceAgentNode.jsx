import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import { Mic, MicOff, Loader, Phone, PhoneOff } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import './nodes.css'

export default function VoiceAgentNode({ id, data, selected }) {
  const { state, buildAIContext } = useCanvas()
  const { getNodes, getEdges } = useReactFlow()
  
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('Idle')

  const wsRef = useRef(null)
  const audioContextRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioQueueRef = useRef([])
  const isPlayingRef = useRef(false)
  const nextPlayTimeRef = useRef(0)

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (mediaRecorderRef.current) {
      // Disconnect processor
      if (mediaRecorderRef.current.processor) {
        mediaRecorderRef.current.processor.disconnect()
      }
      // Stop all tracks in the MediaStream
      mediaRecorderRef.current.getTracks().forEach(t => t.stop())
      mediaRecorderRef.current = null
    }
    setIsConnected(false)
    setIsConnecting(false)
    setStatus('Disconnected')
  }, [])

  const playNextAudio = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      return
    }
    
    isPlayingRef.current = true
    const { pcmData, resolve } = audioQueueRef.current.shift()
    const ctx = audioContextRef.current

    try {
      const binaryString = atob(pcmData)
      const len = binaryString.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      
      const pcm16 = new Int16Array(bytes.buffer)
      const audioBuffer = ctx.createBuffer(1, pcm16.length, 24000)
      const channelData = audioBuffer.getChannelData(0)
      for (let i = 0; i < pcm16.length; i++) {
        channelData[i] = pcm16[i] / 32768.0
      }

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      
      const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current)
      source.start(startTime)
      
      nextPlayTimeRef.current = startTime + audioBuffer.duration
      
      source.onended = () => {
        resolve()
        playNextAudio()
      }
    } catch (err) {
      console.error('Audio playback error', err)
      resolve()
      playNextAudio()
    }
  }, [])

  const enqueueAudio = useCallback((base64pcm) => {
    return new Promise(resolve => {
      audioQueueRef.current.push({ pcmData: base64pcm, resolve })
      if (!isPlayingRef.current) {
        nextPlayTimeRef.current = audioContextRef.current.currentTime
        playNextAudio()
      }
    })
  }, [playNextAudio])

  const connectVoice = useCallback(async () => {
    if (!state.geminiKey) {
      setError('Missing Gemini API Key in Settings')
      return
    }

    setIsConnecting(true)
    setError(null)
    setStatus('Initializing...')

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 })
      }
      await audioContextRef.current.resume()

      // Connect to Gemini 2.0 experimental for BidiGenerateContent (Voice)
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${state.geminiKey}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        const { sourceContext, personaContext } = buildAIContext(id, getNodes(), getEdges())
        
        let instructions = "You are a live voice AI assistant operating on a visual canvas."
        if (personaContext) instructions += `\n\nMANDATORY PERSONA:\n${personaContext}`
        if (sourceContext) instructions += `\n\nCONNECTED SOURCES:\n${sourceContext}\n\nYou must strictly ground your responses based on these sources.`

        ws.send(JSON.stringify({
          setup: {
            model: "models/gemini-2.0-flash-exp",
            systemInstruction: {
              parts: [{ text: instructions }]
            },
            generationConfig: {
              responseModalities: ["AUDIO"]
            }
          }
        }))
        
        setIsConnected(true)
        setIsConnecting(false)
        setStatus('Listening & Speaking...')

        navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } })
        .then(stream => {
          mediaRecorderRef.current = stream // Store stream to stop tracks later
          
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          const source = audioCtx.createMediaStreamSource(stream);
          const processor = audioCtx.createScriptProcessor(4096, 1, 1);
          
          source.connect(processor);
          processor.connect(audioCtx.destination);
          
          processor.onaudioprocess = (e) => {
            if (ws.readyState === WebSocket.OPEN && !isMuted) {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcm16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              const uint8 = new Uint8Array(pcm16.buffer);
              let binary = '';
              for (let i = 0; i < uint8.byteLength; i++) {
                binary += String.fromCharCode(uint8[i]);
              }
              const base64 = btoa(binary);
              
              ws.send(JSON.stringify({
                realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: base64 }] }
              }));
            }
          };
          
          // Store processor so it doesn't get garbage collected
          mediaRecorderRef.current.processor = processor;
        }).catch(err => {
          console.error(err)
          setError('Microphone permission denied')
          disconnect()
        })
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.serverContent && msg.serverContent.modelTurn) {
          const parts = msg.serverContent.modelTurn.parts || []
          parts.forEach(p => {
            if (p.inlineData && p.inlineData.data) {
              enqueueAudio(p.inlineData.data)
            }
          })
        }
      }

      ws.onerror = (e) => {
        console.error('WS Error', e)
        setError('Voice connection failed. Check API key & model support.')
        disconnect()
      }

      ws.onclose = () => {
        disconnect()
      }

    } catch (err) {
      console.error(err)
      setError(err.message)
      disconnect()
    }
  }, [state.geminiKey, buildAIContext, id, getNodes, getEdges, isMuted, disconnect, enqueueAudio])

  useEffect(() => {
    return () => disconnect()
  }, [disconnect])

  return (
    <div className={`node ai-node ${selected ? 'selected' : ''}`} style={{ minHeight: '140px', width: '280px' }}>
      <Handle type="target" position={Position.Left} className="node-handle" />
      
      <div className="node-header ai-node-header">
        <div className="node-header-left">
          <div className="node-icon-bg" style={{ background: 'var(--node-ai)' }}>
            <Mic size={14} color="var(--accent-primary)" />
          </div>
          <span className="node-title">{data.label || 'Voice Agent'}</span>
        </div>
        <div className="node-actions">
           <div style={{ width: 8, height: 8, borderRadius: '50%', background: isConnected ? '#4ade80' : '#ff6b6b' }} />
        </div>
      </div>

      <div className="node-content" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
          Status: <strong>{status}</strong>
        </div>

        {error && <div style={{ color: '#ff6b6b', fontSize: '10px', textAlign: 'center' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '8px' }}>
          {!isConnected ? (
             <button 
               className="btn btn-primary" 
               style={{ flex: 1, justifyContent: 'center' }} 
               onClick={connectVoice}
               disabled={isConnecting}
             >
               {isConnecting ? <Loader size={14} className="spin" /> : <Phone size={14} />}
               {isConnecting ? 'Connecting...' : 'Start Call'}
             </button>
          ) : (
             <>
               <button 
                 className={`btn btn-ghost`} 
                 style={{ flex: 1, justifyContent: 'center', color: isMuted ? '#ff6b6b' : 'inherit' }}
                 onClick={() => setIsMuted(!isMuted)}
               >
                 {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                 {isMuted ? 'Muted' : 'Mute'}
               </button>
               <button 
                 className="btn" 
                 style={{ flex: 1, justifyContent: 'center', background: '#ff6b6b', color: '#fff', border: 'none' }}
                 onClick={disconnect}
               >
                 <PhoneOff size={14} /> End Call
               </button>
             </>
          )}
        </div>
        
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '4px' }}>
          Connect source/persona nodes to inject context before calling.
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  )
}
