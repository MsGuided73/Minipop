import React, { useState, useCallback, useMemo } from 'react'
import { Handle, Position, useReactFlow, useEdges, useNodes } from '@xyflow/react'
import { X, GitCompare, Copy, Check, Trash2, Loader, AlertCircle, FileText, RefreshCw, Sparkles, Table2 } from 'lucide-react'
import { useCanvas } from '../context/CanvasContext'
import { generateCrossReference, generateCrossReferenceTable, resolveConnectedNodeIds } from '../services/aiService'
import { useNodeReader, NodeReaderBar } from '../components/NodeReader'
import './nodes.css'

export default function CrossReferenceNode({ id, data, selected }) {
  const { deleteNode, updateNode, state } = useCanvas()
  const { getEdges, getNodes } = useReactFlow()
  
  const [loading, setLoading] = useState(false)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // Report content
  const report = data.report || ''
  const tableData = data.tableData || ''
  const reader = useNodeReader({ id, initialFontSize: data.fontSize, defaultFontSize: 12 })
  
  const allEdges = useEdges()
  const allNodes = useNodes()

  // Find connected source nodes
  const connectedSources = useMemo(() => {
    const edgeIds = resolveConnectedNodeIds(id, allNodes, allEdges)
    return allNodes.filter(n => edgeIds.includes(n.id) && n.type !== 'aiAssistantNode' && n.type !== 'analysisNode' && n.type !== 'crossReferenceNode')
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
      const response = await generateCrossReference(id, nodes, edges, state.apiKey, state.model, state.geminiKey)
      
      updateNode(id, { data: { ...data, report: response, tableData: '' } })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [connectedSources, id, data, state.apiKey, state.model, state.geminiKey, getNodes, getEdges, updateNode])

  const handleGenerateTable = useCallback(async () => {
    if (!report) return
    setTableLoading(true)
    setError('')
    
    try {
      const response = await generateCrossReferenceTable(report, state.apiKey, state.model, state.geminiKey)
      updateNode(id, { data: { ...data, tableData: response } })
    } catch (err) {
      setError(err.message)
    } finally {
      setTableLoading(false)
    }
  }, [report, id, data, state.apiKey, state.model, state.geminiKey, updateNode])

  const handleCopy = useCallback(() => {
    if (!report) return
    navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [report])

  const handleClear = useCallback((e) => {
    e.stopPropagation()
    updateNode(id, { data: { ...data, report: '', tableData: '' } })
  }, [id, data, updateNode])

  const renderMarkdownTable = (md) => {
    // Quick and dirty markdown table rendering
    const lines = md.split('\n').filter(line => line.includes('|'))
    if (lines.length < 3) return <div className="report-body"><pre>{md}</pre></div> // Not a table, just render the text
    
    // Ignore the separator line (usually row 1 after header)
    const headerRow = lines[0]
    const dataRows = lines.slice(2)
    
    const getCells = (line) => line.split('|').map(c => c.trim()).filter(Boolean)
    const headers = getCells(headerRow)

    return (
      <div className="cr-table-wrap">
        <table className="cr-table">
          <thead>
            <tr>
              {headers.map((h, i) => <th key={i}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, i) => {
              const cells = getCells(row)
              return (
                <tr key={i}>
                  {cells.map((cell, j) => (
                    <td key={j} className={cell.toLowerCase() === 'conflict' ? 'status-conflict' : cell.toLowerCase() === 'agree' ? 'status-agree' : ''}>
                      {cell}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className={`node cr-node ${selected ? 'node--selected' : ''}`} style={{ width: 480, height: 420 }}>
      <Handle type="target" position={Position.Left} id="target" />
      <Handle type="source" position={Position.Right} id="source" />

      {/* Header */}
      <div className="node-header cr-node-header">
        <div className="node-header-left">
          <div className="node-icon node-icon--cr">
            <GitCompare size={13} />
          </div>
          <div className="ai-header-info">
            <span className="node-label">Cross-Reference Matrix</span>
            <span className="ai-node-subtitle">
              {connectedSources.length > 0
                ? `${connectedSources.length} source${connectedSources.length !== 1 ? 's' : ''} connected`
                : 'Connect 2+ sources to compare'}
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
            <GitCompare size={32} className="sparkle-icon" opacity={0.6} />
            <h3>Map The Truth</h3>
            <p>Connect multiple sources to automatically detect agreements, contradictions, assumptions, and logic gaps.</p>
            
            <div className="analysis-requirements">
              <div className={`req-item ${connectedSources.length > 1 ? 'met' : ''}`}>
                {connectedSources.length > 1 ? <Check size={12} /> : <div className="dot" />}
                2+ Sources connected
              </div>
              <div className={`req-item ${state.apiKey ? 'met' : ''}`}>
                {state.apiKey ? <Check size={12} /> : <div className="dot" />}
                API Key configured
              </div>
            </div>

            <button 
              className={`btn btn-primary analysis-run-btn ${connectedSources.length < 2 ? 'disabled' : ''}`}
              onClick={handleRunAnalysis}
              disabled={connectedSources.length === 0}
            >
              <GitCompare size={14} />
              Generate Matrix
            </button>
          </div>
        )}

        {loading && (
          <div className="analysis-loading">
            <div className="ai-typing">
              <span /><span /><span />
            </div>
            <p>Cross-referencing claims and evidence...</p>
          </div>
        )}

        {error && (
          <div className="ai-error" style={{ margin: '10px' }}>
            <AlertCircle size={12} /> {error}
          </div>
        )}

        {report && (
          <div className="cr-report">
            <div className="report-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                 <FileText size={14} />
                 <span>Matrix Results</span>
              </div>
              <button className="report-copy-btn" onClick={handleCopy}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <NodeReaderBar
              reader={reader}
              placeholder="Find in report…"
              matchCount={reader.countMatches([report, tableData])}
              compact
            />
            <div className="report-body" style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: reader.fontSize }}>
              {reader.highlight(report)}
            </div>

            {tableLoading && (
              <div className="analysis-loading" style={{ marginTop: 15, padding: 15, background: 'rgba(0,0,0,0.2)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="ai-typing"><span /><span /><span /></div>
                <p style={{ margin: 0, marginTop: 10, fontSize: '0.85rem' }}>Structuring data into table...</p>
              </div>
            )}

            {tableData && !tableLoading && (
              <div className="cr-report" style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 15 }}>
                <div className="report-header" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                     <Table2 size={14} />
                     <span>Structured Table</span>
                  </div>
                </div>
                <div className="report-body">
                  {renderMarkdownTable(tableData)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {report && !loading && (
        <div className="analysis-footer" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={handleRunAnalysis}>
            <RefreshCw size={12} /> Re-analyze
          </button>
          {!tableData && (
             <button className="btn btn-primary btn-sm" onClick={handleGenerateTable} disabled={tableLoading} style={{ padding: '4px 12px' }}>
               <Table2 size={12} /> Generate Table
             </button>
          )}
        </div>
      )}
    </div>
  )
}
