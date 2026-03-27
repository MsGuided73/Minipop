import React, { useState, useMemo } from 'react';
import { 
  Folder, FolderOpen, FileText, ChevronRight, 
  ChevronDown, Plus, Trash2, Edit2, PanelLeftClose, PanelLeftOpen 
} from 'lucide-react';
import { useCanvas } from '../context/CanvasContext';
import './Sidebar.css';

export default function Sidebar({ isOpen, onToggle }) {
  const { 
    state, 
    createFolder, 
    deleteFolder, 
    loadBoardFromServer, 
    saveBoardToServer, 
    setBoardInfo,
    clearCanvas,
    dispatch
  } = useCanvas();

  const [expandedFolders, setExpandedFolders] = useState({});
  const [addingFolderTo, setAddingFolderTo] = useState(null); // folderId or 'root'
  const [newFolderName, setNewFolderName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Group boards by folderId
  const boardsByFolder = useMemo(() => {
    const map = { root: [] };
    state.folders.forEach(f => map[f.id] = []);
    state.remoteBoards.forEach(b => {
      if (b.folderId && map[b.folderId]) {
        map[b.folderId].push(b);
      } else {
        map.root.push(b);
      }
    });
    return map;
  }, [state.remoteBoards, state.folders]);

  // Group folders by parentId (for subfolders)
  const foldersByParent = useMemo(() => {
    const map = { root: [] };
    state.folders.forEach(f => {
      const pId = f.parentId || 'root';
      if (!map[pId]) map[pId] = [];
      map[pId].push(f);
    });
    return map;
  }, [state.folders]);

  const toggleFolder = (e, id) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreateFolder = async (e, parentId = null) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await createFolder(newFolderName.trim(), parentId);
      setNewFolderName('');
      setAddingFolderTo(null);
      if (parentId) {
        setExpandedFolders(prev => ({ ...prev, [parentId]: true }));
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCreateCanvas = () => {
    // Clear canvas and set new ID
    clearCanvas();
    setBoardInfo('Untitled Canvas', crypto.randomUUID(), null);
  };

  const handleSaveCurrentCanvas = async () => {
    setIsSaving(true);
    let name = state.boardName;
    if (name === 'Untitled Board' || name === 'Untitled Canvas') {
      const inputName = prompt("Enter a name for this Canvas:", "New Strategy");
      if (!inputName) {
        setIsSaving(false);
        return;
      }
      name = inputName;
      setBoardInfo(name, state.boardId, state.folderId);
    }
    
    try {
      await saveBoardToServer();
      // Need a small delay before state updates can be completely relied upon without forcing a re-fetch manually
      // though saveBoard returns the board. We'll just re-fetch boards.
      const res = await fetch('/api/v1/boards');
      if (res.ok) {
        const boards = await res.json();
        dispatch({ type: 'SET_REMOTE_BOARDS', boards });
      }
    } catch (err) {
      alert("Failed to save: " + err.message);
    }
    setIsSaving(false);
  };

  const renderFolderForm = (parentId) => {
    if (addingFolderTo !== parentId) return null;
    return (
      <form 
        className="sidebar-new-folder-form"
        onSubmit={(e) => handleCreateFolder(e, parentId === 'root' ? null : parentId)}
      >
        <input 
          autoFocus
          value={newFolderName}
          onChange={e => setNewFolderName(e.target.value)}
          onBlur={() => setAddingFolderTo(null)}
          placeholder="Folder name..."
          className="sidebar-folder-input"
        />
      </form>
    );
  };

  const renderTree = (parentId, depth = 0) => {
    const folders = foldersByParent[parentId] || [];
    const boards = boardsByFolder[parentId] || [];

    return (
      <div className="sidebar-tree" style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
        {folders.map(folder => {
          const isExpanded = expandedFolders[folder.id];
          return (
            <div key={folder.id} className="sidebar-node">
              <div 
                className="sidebar-folder-row"
                onClick={(e) => toggleFolder(e, folder.id)}
              >
                <div className="sidebar-folder-left">
                  {isExpanded ? <ChevronDown size={14} className="folder-chevron" /> : <ChevronRight size={14} className="folder-chevron" />}
                  {isExpanded ? <FolderOpen size={14} className="folder-icon" /> : <Folder size={14} className="folder-icon" />}
                  <span className="folder-name">{folder.name}</span>
                </div>
                <div className="sidebar-folder-actions">
                  <button 
                    className="sidebar-icon-btn" 
                    onClick={(e) => { e.stopPropagation(); setAddingFolderTo(folder.id); setNewFolderName(''); }}
                    title="Add Subfolder"
                  >
                    <Plus size={14} />
                  </button>
                  <button 
                    className="sidebar-icon-btn danger" 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      if(confirm(`Delete folder "${folder.name}"? Boards inside will not be deleted but moved to root.`)) deleteFolder(folder.id); 
                    }}
                    title="Delete Folder"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              
              {renderFolderForm(folder.id)}
              
              {isExpanded && (
                <div className="sidebar-folder-children">
                  {renderTree(folder.id, depth + 1)}
                </div>
              )}
            </div>
          );
        })}

        {boards.map(board => (
          <div 
            key={board.id} 
            className={`sidebar-board-row ${state.boardId === board.id ? 'active' : ''}`}
            onClick={() => loadBoardFromServer(board.id)}
          >
            <FileText size={14} className="board-icon" />
            <span className="board-name">{board.name}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <div className={`sidebar-container ${isOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <span className="sidebar-logo-icon">🧠</span>
            <span className="sidebar-logo-text">ContentLoom</span>
          </div>
          <button className="sidebar-toggle-btn" onClick={onToggle}>
            <PanelLeftClose size={18} />
          </button>
        </div>

        <div className="sidebar-actions">
          <button className="btn btn-primary sidebar-new-btn" onClick={handleCreateCanvas}>
            <Plus size={14} /> New Canvas
          </button>
          <button 
            className={`btn sidebar-save-btn ${isSaving ? 'saving' : ''}`} 
            onClick={handleSaveCurrentCanvas}
          >
            {isSaving ? 'Saving...' : 'Save Current'}
          </button>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-section-header">
            <span>Workspace</span>
            <button 
              className="sidebar-icon-btn" 
              onClick={() => { setAddingFolderTo('root'); setNewFolderName(''); }}
              title="New Folder"
            >
              <Plus size={14} />
            </button>
          </div>
          
          {renderFolderForm('root')}
          <div className="sidebar-scrollable">
            {renderTree('root')}
          </div>
        </div>
      </div>
      
      {/* Floating open button when closed */}
      {!isOpen && (
        <button className="sidebar-float-open" onClick={onToggle}>
          <PanelLeftOpen size={18} />
        </button>
      )}
    </>
  );
}
