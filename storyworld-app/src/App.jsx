import React, { useEffect, useState } from 'react';
import { BookOpen, Eye, Layers3, Play, RefreshCw, Settings } from 'lucide-react';
import './App.css';

function App() {
  const [config, setConfig] = useState({
    numCharacters: 3,
    numThemes: 2,
    numVariables: 5,
    encounterLength: 500
  });

  const [customPrompt, setCustomPrompt] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [storyworlds, setStoryworlds] = useState([]);
  const [selectedStoryworld, setSelectedStoryworld] = useState(null);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [galleryError, setGalleryError] = useState('');
  const [galleryStats, setGalleryStats] = useState(null);

  useEffect(() => {
    void loadGallery();
  }, []);

  const handleSliderChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: parseInt(value, 10) }));
  };

  const loadGallery = async () => {
    setGalleryLoading(true);
    setGalleryError('');

    try {
      const [storyworldResponse, statsResponse] = await Promise.all([
        fetch('/api/storyworlds?limit=12'),
        fetch('/api/stats')
      ]);

      const storyworldData = await storyworldResponse.json();
      const statsData = await statsResponse.json();

      if (!storyworldResponse.ok) {
        throw new Error(storyworldData.error || 'Failed to load storyworlds');
      }

      if (!statsResponse.ok) {
        throw new Error(statsData.error || 'Failed to load stats');
      }

      const nextStoryworlds = storyworldData.storyworlds || [];
      setStoryworlds(nextStoryworlds);
      setGalleryStats(statsData.stats || null);
      setSelectedStoryworld(prev => {
        if (prev) {
          const preserved = nextStoryworlds.find(item => item.id === prev.id);
          if (preserved) {
            return preserved;
          }
        }

        return nextStoryworlds[0] || null;
      });
    } catch (error) {
      setGalleryError(error.message);
      setStoryworlds([]);
      setGalleryStats(null);
      setSelectedStoryworld(null);
    } finally {
      setGalleryLoading(false);
    }
  };

  const generateSystemPrompt = () => {
    const basePrompt = `You are a Sweepweave Storyworld generator. Create an interactive narrative environment with the following parameters:

- Characters: ${config.numCharacters} distinct characters with unique motivations and relationships
- Themes: ${config.numThemes} central thematic elements that weave through the narrative
- Variables: ${config.numVariables} trackable state variables that affect story progression
- Encounter Length: Approximately ${config.encounterLength} words per scene

Each encounter should:
1. Present meaningful choices that affect character relationships and tracked variables
2. Maintain consistency with established lore and character personalities
3. Create branching possibilities for future encounters
4. Balance narrative coherence with player agency

${customPrompt ? `\nAdditional Instructions:\n${customPrompt}` : ''}

Structure each output as JSON with: {
  "encounter": "narrative text",
  "choices": ["choice1", "choice2", "choice3"],
  "variables_affected": {"var_name": delta},
  "metadata": {
    "characters_present": [],
    "themes_emphasized": [],
    "narrative_weight": 0-10
  }
}`;

    return basePrompt;
  };

  const parseGeneratedContent = content => {
    if (!content || typeof content !== 'string') {
      return null;
    }

    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  };

  const downloadStoryworld = payload => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `storyworld_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Storyworld JSON generated and downloaded.');
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setStatus('');

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          config,
          custom_prompt: customPrompt,
          system_prompt: generateSystemPrompt()
        })
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        alert(`API Error: ${data.error || data.details?.error?.message || 'Unknown error'}`);
        return;
      }

      const payload = data.parsed || parseGeneratedContent(data.content) || data;
      downloadStoryworld(payload);
      void loadGallery();
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const selectedEncounter = selectedStoryworld ? getEncounterData(selectedStoryworld) : null;
  const statChips = galleryStats
    ? [
        `${galleryStats.total_storyworlds || 0} storyworlds`,
        `${galleryStats.total_views || 0} views`,
        `${galleryStats.total_likes || 0} likes`,
        `${galleryStats.total_forks || 0} forks`
      ]
    : [];

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>Morality Lab Storyworld</h1>
          <p>Generator, browse, and reader deployment package for Sweepweave-compatible storyworlds.</p>
        </div>
        <button
          className="config-btn"
          onClick={() => setShowInfo(true)}
          title="Deployment info"
        >
          <Settings size={20} />
        </button>
      </header>

      <main className="main-content">
        <div className="controls-panel">
          <div className="meta-row">
            <a className="utility-link" href="/reader">
              <BookOpen size={18} />
              Open Reader
            </a>
            <a
              className="utility-link"
              href="https://github.com/MoralityLabAI/GPTStoryworld"
              target="_blank"
              rel="noreferrer"
            >
              Source Repo
            </a>
          </div>

          <div className="control-group">
            <label>
              <span className="label-text">Characters</span>
              <span className="value">{config.numCharacters}</span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={config.numCharacters}
              onChange={(e) => handleSliderChange('numCharacters', e.target.value)}
              className="slider"
            />
            <div className="range-labels">
              <span>1</span>
              <span>10</span>
            </div>
          </div>

          <div className="control-group">
            <label>
              <span className="label-text">Themes</span>
              <span className="value">{config.numThemes}</span>
            </label>
            <input
              type="range"
              min="1"
              max="5"
              value={config.numThemes}
              onChange={(e) => handleSliderChange('numThemes', e.target.value)}
              className="slider"
            />
            <div className="range-labels">
              <span>1</span>
              <span>5</span>
            </div>
          </div>

          <div className="control-group">
            <label>
              <span className="label-text">Tracked Variables</span>
              <span className="value">{config.numVariables}</span>
            </label>
            <input
              type="range"
              min="3"
              max="20"
              value={config.numVariables}
              onChange={(e) => handleSliderChange('numVariables', e.target.value)}
              className="slider"
            />
            <div className="range-labels">
              <span>3</span>
              <span>20</span>
            </div>
          </div>

          <div className="control-group">
            <label>
              <span className="label-text">Encounter Length (words)</span>
              <span className="value">{config.encounterLength}</span>
            </label>
            <input
              type="range"
              min="200"
              max="1500"
              step="50"
              value={config.encounterLength}
              onChange={(e) => handleSliderChange('encounterLength', e.target.value)}
              className="slider"
            />
            <div className="range-labels">
              <span>200</span>
              <span>1500</span>
            </div>
          </div>

          <div className="control-group">
            <label className="label-text">Additional Instructions</label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Add custom instructions to the system prompt..."
              className="custom-prompt"
              rows="6"
            />
          </div>

          <div className="action-buttons">
            <button
              className="btn btn-secondary"
              onClick={() => setShowPrompt(true)}
            >
              <Eye size={18} />
              Preview Prompt
            </button>
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>Generating...</>
              ) : (
                <>
                  <Play size={18} />
                  Generate Storyworld
                </>
              )}
            </button>
          </div>

          <div className="library">
            <div className="library-head">
              <div>
                <div className="tag">Browse Live Data</div>
                <h2>Storyworld Library</h2>
                <p>Browse the Neon-backed gallery and inspect the current encounter payloads.</p>
              </div>
              <button className="btn btn-secondary library-refresh" onClick={() => void loadGallery()} disabled={galleryLoading}>
                <RefreshCw size={16} />
                {galleryLoading ? 'Loading' : 'Refresh'}
              </button>
            </div>

            <div className="library-stats">
              {statChips.map((chip) => (
                <span className="stat-chip" key={chip}>
                  <Layers3 size={14} />
                  {chip}
                </span>
              ))}
            </div>

            <div className="library-grid">
              <div className="library-list">
                {galleryError ? (
                  <div className="empty-state">{galleryError}</div>
                ) : null}

                {!galleryError && galleryLoading ? (
                  <div className="empty-state">Loading storyworlds...</div>
                ) : null}

                {!galleryError && !galleryLoading && storyworlds.length === 0 ? (
                  <div className="empty-state">No public storyworlds yet.</div>
                ) : null}

                {storyworlds.map((storyworld) => (
                  <button
                    className={`story-card ${selectedStoryworld?.id === storyworld.id ? 'active' : ''}`}
                    key={storyworld.id}
                    onClick={() => setSelectedStoryworld(storyworld)}
                    type="button"
                  >
                    <div className="story-card-top">
                      <div>
                        <div className="tag">Storyworld</div>
                        <h3>{storyworld.title}</h3>
                        <p>{storyworld.description || 'No description provided.'}</p>
                      </div>
                      <span className="story-date">{formatDate(storyworld.created_at)}</span>
                    </div>
                    <div className="story-metrics">
                      <span className="metric">{storyworld.num_characters} chars</span>
                      <span className="metric">{storyworld.num_themes} themes</span>
                      <span className="metric">{storyworld.views || 0} views</span>
                      <span className="metric">{storyworld.likes || 0} likes</span>
                    </div>
                  </button>
                ))}
              </div>

              <article className="library-detail">
                {selectedStoryworld ? (
                  <>
                    <div className="detail-head">
                      <div>
                        <div className="tag">Selected Storyworld</div>
                        <h3>{selectedStoryworld.title}</h3>
                        <p>{selectedStoryworld.description || 'No description provided.'}</p>
                      </div>
                      <button className="mini-link" onClick={() => setShowPrompt(true)} type="button">
                        Preview Prompt
                      </button>
                    </div>

                    <div className="detail-meta">
                      <span className="stat-chip"><Layers3 size={14} />{selectedStoryworld.model_used || 'gpt-4.1'}</span>
                      <span className="stat-chip">{formatDate(selectedStoryworld.created_at)}</span>
                      <span className="stat-chip">{selectedStoryworld.num_variables} variables</span>
                    </div>

                    <div className="detail-section">
                      <h4>Encounter</h4>
                      <p className="detail-copy">{selectedEncounter.text || 'No encounter text available.'}</p>
                    </div>

                    {selectedEncounter.choices.length > 0 ? (
                      <div className="detail-section">
                        <h4>Choices</h4>
                        <ul className="choice-list">
                          {selectedEncounter.choices.map((choice, index) => (
                            <li key={`${choice}-${index}`}>{choice}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="detail-section">
                      <h4>Metadata</h4>
                      <pre className="story-pre">
                        {JSON.stringify(selectedEncounter.metadata || {}, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    Select a storyworld to inspect its encounter and metadata.
                  </div>
                )}
              </article>
            </div>

            <p className="status-note">
              Reader is live and the gallery is backed by Neon. Generated encounters download locally unless you save them into the library.
            </p>
          </div>

          {status ? <p className="status-note">{status}</p> : null}
        </div>
      </main>

      {showInfo && (
        <div className="modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Deployment Info</h2>
              <button onClick={() => setShowInfo(false)} className="close-btn">x</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Generation Mode</label>
                <p className="help-text">
                  This deployment uses server-side generation with the org OpenAI key.
                  No browser-stored API key is needed.
                </p>
              </div>
              <div className="form-group">
                <label>Reader</label>
                <p className="help-text">
                  The standalone reader is available at <a href="/reader">/reader</a>.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={() => setShowInfo(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrompt && (
        <div className="modal-overlay" onClick={() => setShowPrompt(false)}>
          <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>System Prompt Preview</h2>
              <button onClick={() => setShowPrompt(false)} className="close-btn">x</button>
            </div>
            <div className="modal-body">
              <pre className="prompt-preview">{generateSystemPrompt()}</pre>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(generateSystemPrompt());
                  alert('Copied to clipboard!');
                }}
              >
                Copy to Clipboard
              </button>
              <button className="btn btn-primary" onClick={() => setShowPrompt(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getEncounterData(storyworld) {
  const encounter = storyworld?.encounter;
  if (!encounter) {
    return { text: '', choices: [], metadata: {} };
  }

  if (typeof encounter === 'string') {
    try {
      const parsed = JSON.parse(encounter);
      return getEncounterData({ encounter: parsed });
    } catch {
      return { text: encounter, choices: [], metadata: {} };
    }
  }

  return {
    text: encounter.encounter || encounter.description || '',
    choices: Array.isArray(encounter.choices) ? encounter.choices : [],
    metadata: encounter.metadata || {}
  };
}

function formatDate(value) {
  if (!value) {
    return 'Unknown date';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
}

export default App;
