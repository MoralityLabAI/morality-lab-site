import React, { useEffect, useState } from 'react';
import { BookOpen, Eye, Play, Settings } from 'lucide-react';
import './App.css';

function App() {
  const [config, setConfig] = useState({
    numCharacters: 3,
    numThemes: 2,
    numVariables: 5,
    encounterLength: 500
  });
  
  const [customPrompt, setCustomPrompt] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const savedKey = localStorage.getItem('openai_api_key');
    if (savedKey) {
      setApiKey(savedKey);
    }
  }, []);

  const handleSliderChange = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: parseInt(value) }));
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

  const handleGenerate = async () => {
    if (!apiKey) {
      alert('Please configure your OpenAI API key in settings');
      setShowConfig(true);
      return;
    }

    setIsGenerating(true);
    setStatus('');
    const systemPrompt = generateSystemPrompt();
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4.1',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Generate the first encounter of this storyworld.' }
          ],
          temperature: 0.8,
          max_tokens: config.encounterLength * 2
        })
      });

      const data = await response.json();
      
      if (data.error) {
        alert(`API Error: ${data.error.message}`);
      } else {
        // Download the result
        const blob = new Blob([data.choices[0].message.content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `storyworld_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus('Storyworld JSON generated and downloaded.');
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1>Morality Lab Storyworld</h1>
          <p>Generator and reader deployment package for Sweepweave-compatible storyworlds.</p>
        </div>
        <button 
          className="config-btn"
          onClick={() => setShowConfig(true)}
          title="Configure API Key"
        >
          <Settings size={20} />
        </button>
      </header>

      {/* Main Content */}
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

          {/* Number of Characters */}
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

          {/* Number of Themes */}
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

          {/* Number of Variables */}
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

          {/* Encounter Length */}
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

          {/* Custom Prompt */}
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

          {/* Action Buttons */}
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

          <p className="status-note">
            Reader is live now. Postgres-backed gallery routes will come online once the database is attached in Vercel.
          </p>
          {status ? <p className="status-note">{status}</p> : null}
        </div>
      </main>

      {/* Config Modal */}
      {showConfig && (
        <div className="modal-overlay" onClick={() => setShowConfig(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>API Configuration</h2>
              <button onClick={() => setShowConfig(false)} className="close-btn">x</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>OpenAI API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="api-input"
                />
                <p className="help-text">
                  Your API key is stored locally and never sent anywhere except OpenAI.
                  Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com</a>
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-primary"
                onClick={() => {
                  localStorage.setItem('openai_api_key', apiKey);
                  setStatus('OpenAI API key saved locally in this browser.');
                  setShowConfig(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Preview Modal */}
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

export default App;
