import React, { useState, useCallback, useMemo } from 'react'
import { Handle, Position, useReactFlow, useEdges, useNodes } from '@xyflow/react'
import { X, Zap, Sparkles, Copy, Check, Trash2, Brain, Loader, AlertCircle, FileText } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { analyzeViralPatterns, resolveConnectedNodeIds } from '../services/aiService'
import { useNodeReader, NodeReaderBar } from '../components/NodeReader'
import './nodes.css'

export default function AnalysisNode({ id, data, selected }) {
  const { deleteNode, updateNode, state } = useCanvas()
  const { getEdges, getNodes } = useReactFlow()
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // Messages/Report content
  const report = data.report || ''
  const reader = useNodeReader({ id, initialFontSize: data.fontSize, defaultFontSize: 12 })
  
  const allEdges = useEdges()
  const allNodes = useNodes()

  // Find connected source nodes
  const connectedSources = useMemo(() => {
    const edgeIds = resolveConnectedNodeIds(id, allNodes, allEdges)
    return allNodes.filter(n => edgeIds.includes(n.id) && n.type !== 'analysisNode' && n.type !== 'aiAssistantNode')
  }, [allEdges, allNodes, id])


  const handleDelete = useCallback((e) => {
    e.stopPropagation()
    deleteNode(id)
  }, [id, deleteNode])

  const handleRunAnalysis = useCallback(async () => {
    if (connectedSources.length === 0) {
      setError('No sources connected. Connect video or text nodes to analyze.')
      return
    }

    setLoading(true)
    setError('')
    
    try {
      const nodes = getNodes()
      const edges = getEdges()
      const response = await analyzeViralPatterns(id, nodes, edges, state.apiKey, state.model, state.geminiKey)
      
      updateNode(id, { data: { report: response } })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [connectedSources, id, state.apiKey, state.model, state.geminiKey, getNodes, getEdges, updateNode])

  const handleCopy = useCallback(() => {
    if (!report) return
    navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [report])

  const handleClear = useCallback((e) => {
    e.stopPropagation()
    updateNode(id, { data: { report: '' } })
  }, [id, updateNode])

  return (
    <div className={`node analysis-node ${selected ? 'node--selected' : ''}`} style={{ width: 320, height: 420 }}>
      <Handle type="target" position={Position.Left} id="target" />
      <Handle type="source" position={Position.Right} id="source" />

      {/* Header */}
      <div className="node-header analysis-node-header">
        <div className="node-header-left">
          <div className="node-icon node-icon--analysis">
            <Zap size={13} />
          </div>
          <div className="ai-header-info">
            <span className="node-label">Viral Pattern Analysis</span>
            <span className="ai-node-subtitle">
              {connectedSources.length > 0
                ? `${connectedSources.length} source${connectedSources.length !== 1 ? 's' : ''} connected`
                : 'Connect videos to begin'}
            </span>
          </div>
        </div>
        <div className="node-actions">
          {report && (
            <button className="node-action-btn" onClick={handleClear} title="Clear analysis">
              <Trash2 size={11} />
            </button>
          )}
          <button className="node-action-btn node-action-btn--danger" onClick={handleDelete}>
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="analysis-content node-scrollable nopan" onClick={e => e.stopPropagation()}>
        {!report && !loading && (
          <div className="analysis-empty">
            <Sparkles size={32} className="sparkle-icon" />
            <h3>Ready for Insight</h3>
            <p>Connect video transcripts or research notes to extract viral patterns and storytelling frameworks.</p>
            
            <div className="analysis-requirements">
              <div className={`req-item ${connectedSources.length > 0 ? 'met' : ''}`}>
                {connectedSources.length > 0 ? <Check size={12} /> : <div className="dot" />}
                Sources connected
              </div>
              <div className={`req-item ${state.apiKey ? 'met' : ''}`}>
                {state.apiKey ? <Check size={12} /> : <div className="dot" />}
                API Key configured
              </div>
            </div>

            <button 
              className={`btn btn-primary analysis-run-btn ${connectedSources.length === 0 ? 'disabled' : ''}`}
              onClick={handleRunAnalysis}
              disabled={connectedSources.length === 0}
            >
              <Zap size={14} />
              Run Pattern Analysis
            </button>
          </div>
        )}

        {loading && (
          <div className="analysis-loading">
            <div className="ai-typing">
              <span /><span /><span />
            </div>
            <p>Deconstructing patterns...</p>
          </div>
        )}

        {error && (
          <div className="ai-error" style={{ margin: '10px' }}>
            <AlertCircle size={12} /> {error}
          </div>
        )}

        {report && (
          <div className="analysis-report">
            <div className="report-header">
              <FileText size={14} />
              <span>Extracted Patterns</span>
              <button className="report-copy-btn" onClick={handleCopy}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <NodeReaderBar
              reader={reader}
              placeholder="Find in report…"
              matchCount={reader.countMatches(report)}
              compact
            />
            <div className="report-body" style={{ fontSize: reader.fontSize }}>
              {report.split('\n').map((line, i) => (
                <p key={i}>{reader.highlight(line)}</p>
              ))}
            </div>
          </div>
        )}
      </div>

      {report && !loading && (
        <div className="analysis-footer">
          <button className="btn btn-ghost btn-sm" onClick={handleRunAnalysis}>
            <RefreshCw size={12} /> Re-analyze
          </button>
        </div>
      )}
    </div>
  )
}

function RefreshCw({ size }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.83 1 6.39 2.6L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}
