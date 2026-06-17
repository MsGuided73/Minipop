import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeResizer, useReactFlow, useEdges, useNodes } from '@xyflow/react'
import { X, Send, Bot, User, Loader, Sparkles, RefreshCw, ChevronDown, Copy, Check, Trash2, Wand2, Globe, Download } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { callAI, buildAIContext, resolveConnectedNodeIds } from '../services/aiService'
import { useNodeReader, NodeReaderBar } from '../components/NodeReader'
import './nodes.css'

export default function AIAssistantNode({ id, data, selected }) {
  const { deleteNode, updateNode, state } = useCanvas()
  const { getNodes, getEdges } = useReactFlow()

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copiedMsgId, setCopiedMsgId] = useState(null)
  const isGemini = state.model?.startsWith('gemini')
  const [contextPreview, setContextPreview] = useState(false)
  const reader = useNodeReader({ id, initialFontSize: data.fontSize, defaultFontSize: 12 })

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const messages = data.messages || []
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])

  const allEdges = useEdges()
  const allNodes = useNodes()
  const connectedSources = resolveConnectedNodeIds(id, allNodes, allEdges).length

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const handleSend = useCallback(async () => {
    const msg = input.trim()
    if (!msg || loading) return

    setInput('')
    setError('')
    setLoading(true)

    const currentMessages = messagesRef.current
    const userMsg = { id: Date.now(), role: 'user', content: msg, timestamp: new Date().toISOString() }
    const updatedMessages = [...currentMessages, userMsg]
    updateNode(id, { data: { messages: updatedMessages } })

    try {
      const nodes = getNodes()
      const edges = getEdges()
      const response = await callAI(id, msg, nodes, edges, state.apiKey, state.model, state.geminiKey)

      const assistantMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString()
      }
      updateNode(id, { data: { messages: [...updatedMessages, assistantMsg] } })
    } catch (err) {
      setError(err.message)
      updateNode(id, { data: { messages: currentMessages } })
      setInput(msg)
    } finally {
      setLoading(false)
    }
  }, [input, loading, id, updateNode, callAI, state.apiKey, state.model, state.geminiKey, getNodes, getEdges])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleClear = useCallback((e) => {
    e.stopPropagation()
    updateNode(id, { data: { messages: [] } })
  }, [id, updateNode])

  const handleCopy = useCallback((msgId, content) => {
    navigator.clipboard.writeText(content)
    setCopiedMsgId(msgId)
    setTimeout(() => setCopiedMsgId(null), 2000)
  }, [])

  const handleQuickPrompt = useCallback((prompt) => {
    setInput(prompt)
    inputRef.current?.focus()
  }, [])

  const getContextPreview = useCallback(() => {
    const nodes = getNodes()
    const edges = getEdges()
    return buildAIContext(id, nodes, edges)
  }, [id, getNodes, getEdges, buildAIContext])

  const handleExportMarkdown = useCallback((e) => {
    e.stopPropagation()
    const mdLines = ['# AI Assistant Synthesis\n']
    messages.forEach(msg => {
      mdLines.push(`### ${msg.role === 'user' ? 'User' : 'Assistant'}\n`)
      mdLines.push(`${msg.content}\n`)
      mdLines.push('---\n')
    })
    
    const blob = new Blob([mdLines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `AI_Synthesis_${Date.now()}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [messages])

  const quickPrompts = [
    'Identify the contents of...',
    'Brainstorm ideas from this...',
    'Summarize the key points...',
    'Create a table from this data...',
  ]

  return (
    <div className={`node ai-node ${selected ? 'node--selected' : ''}`} style={{ width: '100%', height: '100%', minWidth: 300, minHeight: 360 }}>
      <NodeResizer minWidth={300} minHeight={360} isVisible={selected} />
      {/* Handles */}
      <Handle type="target" position={Position.Left} id="target" />
      <Handle type="source" position={Position.Right} id="out" />

      {/* Header */}
      <div className="node-header ai-node-header">
        <div className="node-header-left">
          <div className="node-icon node-icon--ai">
            <Bot size={13} />
          </div>
          <div className="ai-header-info">
            <span className="node-label">AI Assistant</span>
            <span className="ai-node-subtitle">
              {connectedSources > 0
                ? `${connectedSources} source${connectedSources !== 1 ? 's' : ''} connected`
                : 'No sources — connect nodes'}
            </span>
          </div>
        </div>
        <div className="node-actions">
          {messages.length > 0 && (
            <button className="node-action-btn" onClick={handleExportMarkdown} title="Download Conversation (.md)">
              <Download size={11} />
            </button>
          )}
          {messages.length > 0 && (
            <button className="node-action-btn" onClick={handleClear} title="Clear chat">
              <Trash2 size={11} />
            </button>
          )}
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      {/* New Chat badge */}
      <div className="ai-new-chat-bar">
        <Sparkles size={12} />
        <span>New Chat</span>
        {connectedSources > 0 && (
          <span
            className="ai-context-badge"
            onClick={(e) => { e.stopPropagation(); setContextPreview(!contextPreview) }}
          >
            {connectedSources} connected <ChevronDown size={10} />
          </span>
        )}
      </div>

      {/* Context preview dropdown */}
      {contextPreview && (
        <div className="ai-context-preview" onClick={e => e.stopPropagation()}>
          <div className="ai-context-title">Connected context:</div>
          <div className="ai-context-text">{getContextPreview() || 'No content extracted yet.'}</div>
        </div>
      )}

      {/* Reader controls (search + font size) — only when there are messages */}
      {messages.length > 0 && (
        <NodeReaderBar
          reader={reader}
          placeholder="Find in chat…"
          matchCount={reader.countMatches(messages.map(m => m.content))}
          compact
        />
      )}

      {/* Messages */}
      <div
        className="ai-messages nopan node-scrollable"
        onClick={e => e.stopPropagation()}
        style={{ fontSize: reader.fontSize }}
      >
        {messages.length === 0 ? (
          <div className="ai-empty-state">
            <Wand2 size={28} opacity={0.3} />
            <p>Connect content nodes and ask me anything</p>
            {connectedSources === 0 && (
              <p className="ai-hint">Draw a connection from a content node to this assistant</p>
            )}
            <div className="ai-quick-prompts">
              {quickPrompts.map((p, i) => (
                <button key={i} className="ai-quick-prompt" onClick={() => handleQuickPrompt(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`ai-message ai-message--${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="ai-message-avatar">
                  <Bot size={12} />
                </div>
              )}
              <div className="ai-message-bubble">
                <div className="ai-message-content">
                  {formatMessageContent(msg.content, reader.highlight)}
                </div>
                <div className="ai-message-actions">
                  <button
                    className="ai-msg-action"
                    onClick={() => handleCopy(msg.id, msg.content)}
                    title="Copy"
                  >
                    {copiedMsgId === msg.id ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="ai-message ai-message--assistant">
            <div className="ai-message-avatar">
              <Bot size={12} />
            </div>
            <div className="ai-message-bubble">
              <div className="ai-typing">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="ai-error" onClick={e => e.stopPropagation()}>
          ⚠️ {error}
        </div>
      )}

      {/* Input */}
      <div className="ai-input-area" onClick={e => e.stopPropagation()}>
        <div className="ai-input-wrap">
          <textarea
            ref={inputRef}
            className="ai-textarea"
            placeholder={`Ask anything about your connected sources...`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={loading}
          />
          <button
            className={`ai-send-btn ${loading ? 'loading' : ''} ${input.trim() ? 'active' : ''}`}
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            {loading
              ? <RefreshCw size={14} className="spin" />
              : <Send size={14} />
            }
          </button>
        </div>
        <div className="ai-input-footer">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="ai-model-badge">
              {state.model || 'gpt-4o'}
            </span>
            {isGemini && (
              <span className="ai-grounding-badge" style={{ fontSize: 10, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Globe size={10} /> Search Active
              </span>
            )}
          </div>
          <span className="ai-shortcut">↵ Send · ⇧↵ Newline</span>
        </div>
      </div>
    </div>
  )
}

function formatMessageContent(content, highlight) {
  if (!content) return null;
  const h = highlight || (s => s)
  return content.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{h(part.slice(2, -2))}</strong>
      }
      return <React.Fragment key={j}>{h(part)}</React.Fragment>
    })
    return <span key={i}>{parts}<br /></span>
  })
}
