import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, Check, ChevronRight, Heart, History, Home, ListPlus,
  Play, Search, Sparkles, User, Users, X
} from 'lucide-react';
import './App.css';

const STORAGE_KEY = 'moralitylab.storyworld.profile.v1';
const FILTERS = ['Featured', 'Historical', 'Diplomacy', 'Moral dilemmas', 'All worlds'];
const FALLBACK_WORLDS = [
  {
    id: 'mihna', title: 'The Mihna', genre: 'Historical', theme: 'Constitutional alignment',
    description: 'Baghdad, 833 CE. Navigate an inquisition where doctrine, conscience, and state power collide.',
    size_category: 'Epic', views: 0, likes: 0, localPath: '/storyworlds/mihna_constitutional_alignment.json',
    encounter: { encounter: 'The court is waiting. The Caliph has made belief a condition of public office, and every answer now carries a cost.', choices: ['Enter the council chamber', 'Seek Ibn Hanbal first', 'Review the decree'] }
  }
];

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function App() {
  const [worlds, setWorlds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [activeFilter, setActiveFilter] = useState('Featured');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [profile, setProfile] = useState(loadProfile);
  const [profileOpen, setProfileOpen] = useState(!loadProfile());
  const [profileName, setProfileName] = useState(loadProfile()?.name || '');
  const [view, setView] = useState('home');

  useEffect(() => {
    Promise.allSettled([fetch('/api/storyworlds?limit=60'), fetch('/api/stats')])
      .then(async ([catalogResult]) => {
        if (catalogResult.status !== 'fulfilled' || !catalogResult.value.ok) throw new Error();
        const data = await catalogResult.value.json();
        const catalog = (data.storyworlds || []).map(normalizeWorld);
        setWorlds(catalog.length ? catalog : FALLBACK_WORLDS);
      })
      .catch(() => {
        setWorlds(FALLBACK_WORLDS);
        setNotice('The live catalog is temporarily unavailable. Showing locally hosted worlds.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (profile) localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }, [profile]);

  const visibleWorlds = useMemo(() => worlds.filter(world => {
    const text = `${world.title} ${world.description} ${world.genre} ${world.theme}`.toLowerCase();
    const matchesQuery = text.includes(query.trim().toLowerCase());
    const matchesFilter = activeFilter === 'All worlds' || activeFilter === 'Featured' ||
      text.includes(activeFilter.toLowerCase().replace('moral dilemmas', 'moral'));
    return matchesQuery && matchesFilter;
  }), [worlds, query, activeFilter]);

  const featured = visibleWorlds[0] || worlds[0];
  const myList = worlds.filter(world => profile?.list?.includes(String(world.id)));
  const recent = worlds.filter(world => profile?.history?.some(item => item.id === String(world.id)));

  const updateProfile = changes => setProfile(current => ({
    name: current?.name || 'Reader', list: current?.list || [], history: current?.history || [], ...current, ...changes
  }));

  const toggleList = world => {
    const id = String(world.id);
    const list = profile?.list || [];
    updateProfile({ list: list.includes(id) ? list.filter(item => item !== id) : [...list, id] });
  };

  const play = world => {
    const id = String(world.id);
    const history = [{ id, playedAt: new Date().toISOString() }, ...(profile?.history || []).filter(item => item.id !== id)].slice(0, 20);
    updateProfile({ history });
    if (world.localPath) {
      window.location.href = `/storyworld/reader?world=${encodeURIComponent(world.localPath)}`;
      return;
    }
    setSelected(world);
  };

  const saveProfile = event => {
    event.preventDefault();
    const name = profileName.trim();
    if (!name) return;
    updateProfile({ name });
    setProfileOpen(false);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark">ML</span><span>Storyworlds</span></a>
        <nav aria-label="Storyworld navigation">
          <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Home size={17}/>Browse</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><Heart size={17}/>My List</button>
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History size={17}/>Continue</button>
        </nav>
        <div className="top-actions">
          <label className="search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search worlds" aria-label="Search worlds"/></label>
          <button className="profile-button" onClick={() => setProfileOpen(true)} title="Profile"><User size={18}/><span>{profile?.name || 'Profile'}</span></button>
        </div>
      </header>

      <main>
        {view === 'home' && featured ? (
          <>
            <section className="hero">
              <div className="hero-backdrop" aria-hidden="true" />
              <div className="hero-content">
                <span className="eyebrow"><Sparkles size={14}/>Featured Storyworld</span>
                <h1>{featured.title}</h1>
                <p>{featured.description}</p>
                <div className="hero-meta"><span>{featured.genre}</span><span>{featured.size_category || 'Interactive'}</span><span>{featured.theme}</span></div>
                <div className="hero-actions">
                  <button className="primary" onClick={() => play(featured)}><Play size={19} fill="currentColor"/>Play</button>
                  <button className="secondary" onClick={() => toggleList(featured)}>{profile?.list?.includes(String(featured.id)) ? <Check size={19}/> : <ListPlus size={19}/>}My List</button>
                </div>
              </div>
            </section>

            <div className="catalog">
              <div className="filter-row" role="tablist" aria-label="Catalog filters">
                {FILTERS.map(filter => <button key={filter} className={activeFilter === filter ? 'active' : ''} onClick={() => setActiveFilter(filter)}>{filter}</button>)}
              </div>
              {notice && <p className="notice">{notice}</p>}
              {recent.length > 0 && <WorldRow title="Continue playing" worlds={recent} onOpen={setSelected} onPlay={play} />}
              <WorldRow title={activeFilter === 'Featured' ? 'Featured worlds' : activeFilter} worlds={visibleWorlds} onOpen={setSelected} onPlay={play} loading={loading}/>
              {myList.length > 0 && <WorldRow title={`${profile?.name || 'Your'}'s list`} worlds={myList} onOpen={setSelected} onPlay={play}/>}
            </div>
          </>
        ) : null}

        {view === 'list' && (
          <LibraryView icon={<Heart size={24}/>} title="My List" empty="Add a world from the gallery to find it here." worlds={myList} onOpen={setSelected} onPlay={play}/>
        )}
        {view === 'history' && (
          <LibraryView icon={<History size={24}/>} title="Continue Playing" empty="Worlds you start will appear here." worlds={recent} onOpen={setSelected} onPlay={play}/>
        )}
      </main>

      {selected && (
        <WorldModal world={selected} listed={profile?.list?.includes(String(selected.id))} onClose={() => setSelected(null)} onList={() => toggleList(selected)} onPlay={() => play(selected)}/>
      )}
      {profileOpen && (
        <ProfileModal name={profileName} setName={setProfileName} onSubmit={saveProfile} onClose={profile ? () => setProfileOpen(false) : null}/>
      )}
    </div>
  );
}

function WorldRow({ title, worlds, onOpen, onPlay, loading }) {
  return <section className="world-section"><div className="section-heading"><h2>{title}</h2><span>{worlds.length} worlds</span></div><div className="world-grid">
    {loading ? Array.from({ length: 4 }, (_, i) => <div className="world-card skeleton" key={i}/>) : null}
    {!loading && worlds.length === 0 ? <p className="empty">No worlds match this view.</p> : worlds.map((world, index) => <WorldCard key={world.id} world={world} index={index} onOpen={onOpen} onPlay={onPlay}/>) }
  </div></section>;
}

function WorldCard({ world, index, onOpen, onPlay }) {
  return <article className={`world-card art-${index % 5}`}><button className="card-main" onClick={() => onOpen(world)}><span className="card-kicker">{world.genre}</span><h3>{world.title}</h3><p>{world.description}</p><span className="card-theme">{world.theme}</span></button><button className="card-play" onClick={() => onPlay(world)} title={`Play ${world.title}`}><Play size={18} fill="currentColor"/></button></article>;
}

function LibraryView({ icon, title, empty, worlds, onOpen, onPlay }) {
  return <div className="library-view"><a href="/" className="back"><ArrowLeft size={17}/>Morality Lab</a><div className="library-title">{icon}<h1>{title}</h1></div>{worlds.length ? <WorldRow title="Your worlds" worlds={worlds} onOpen={onOpen} onPlay={onPlay}/> : <p className="empty large">{empty}</p>}</div>;
}

function WorldModal({ world, listed, onClose, onList, onPlay }) {
  const encounter = getEncounter(world);
  return <div className="overlay" onMouseDown={onClose}><article className="world-modal" onMouseDown={e => e.stopPropagation()}><button className="icon-close" onClick={onClose} title="Close"><X/></button><div className="modal-art"><span>{world.genre}</span><h2>{world.title}</h2></div><div className="modal-body"><p>{world.description}</p><div className="hero-meta"><span>{world.size_category || 'Interactive'}</span><span>{world.theme}</span><span>{world.views || 0} plays</span></div><div className="hero-actions"><button className="primary" onClick={onPlay}><Play size={19} fill="currentColor"/>Start playing</button><button className="secondary" onClick={onList}>{listed ? <Check size={19}/> : <ListPlus size={19}/>}My List</button></div><div className="preview"><span className="eyebrow"><BookOpen size={14}/>Opening encounter</span><p>{encounter.text}</p>{encounter.choices.slice(0, 3).map(choice => <div className="choice-preview" key={choice}>{choice}<ChevronRight size={16}/></div>)}</div></div></article></div>;
}

function ProfileModal({ name, setName, onSubmit, onClose }) {
  return <div className="overlay"><form className="profile-modal" onSubmit={onSubmit}>{onClose && <button type="button" className="icon-close" onClick={onClose} title="Close"><X/></button>}<div className="profile-icon"><Users size={30}/></div><span className="eyebrow">Local reader profile</span><h2>Who's exploring?</h2><p>Your list and play history stay in this browser.</p><label>Display name<input autoFocus maxLength="28" value={name} onChange={e => setName(e.target.value)} placeholder="Reader name"/></label><button className="primary" type="submit">Enter Storyworlds<ChevronRight size={18}/></button></form></div>;
}

function normalizeWorld(world) {
  const metadata = typeof world.metadata === 'object' && world.metadata ? world.metadata : {};
  return {
    ...world,
    id: String(world.id),
    localPath: world.localPath || (world.source_path ? `/api/storyworlds/${encodeURIComponent(world.id)}` : undefined),
    genre: world.genre || metadata.genre || 'Moral dilemmas',
    theme: world.theme || metadata.theme || 'Interactive fiction'
  };
}

function getEncounter(world) {
  let encounter = world?.encounter;
  if (typeof encounter === 'string') {
    try { encounter = JSON.parse(encounter); } catch { return { text: encounter, choices: [] }; }
  }
  return { text: encounter?.encounter || encounter?.description || world.description, choices: Array.isArray(encounter?.choices) ? encounter.choices : [] };
}

export default App;
