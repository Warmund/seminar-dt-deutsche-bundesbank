import './App.css'

function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">WZ</span><div><strong>WZ-Validierung</strong><span>Forschungsprototyp</span></div></div>
        <span className="top-label">MENSCH + KI</span>
      </header>
      <main>
        <div className="breadcrumb">ARBEITSBEREICH <span>/</span> ÜBERSICHT</div>
        <section className="intro"><div><p className="eyebrow"><span /> WILLKOMMEN</p><h1>Validierung im Überblick<span>.</span></h1><p className="lead">Wirtschaftszweige gemeinsam mit KI prüfen – strukturiert, nachvollziehbar und auf einen Blick.</p></div><div className="intro-tag"><span>◌</span> Forschungsprototyp</div></section>
        <section aria-labelledby="overview-title" className="overview"><div className="section-head"><div><p className="eyebrow">IHR ARBEITSBEREICH</p><h2 id="overview-title">Übersicht</h2></div><span className="muted">Aktueller Stand</span></div>
          <div className="stats"><article className="stat"><div className="stat-head"><span>FÄLLE GESAMT</span><span className="icon">▦</span></div><strong>—</strong><p>Noch keine Daten verfügbar</p></article><article className="stat"><div className="stat-head"><span>ZUR PRÜFUNG</span><span className="icon amber">◷</span></div><strong>—</strong><p>Warten auf eine Entscheidung</p></article><article className="stat"><div className="stat-head"><span>ABGESCHLOSSEN</span><span className="icon green">✓</span></div><strong>—</strong><p>Bereits bearbeitete Fälle</p></article></div>
        </section>
        <section className="cases" aria-labelledby="cases-title"><div className="cases-head"><div><p className="eyebrow">VALIDIERUNG</p><h2 id="cases-title">Prüffälle</h2><p>Hier erscheinen die Fälle, sobald Daten verfügbar sind.</p></div><span className="status"><span /> Keine Daten</span></div><div className="table-head" aria-hidden="true"><span>UNTERNEHMEN</span><span>WZ-VORSCHLAG</span><span>KONFIDENZ</span><span>STATUS</span></div><div className="empty"><div className="empty-icon">▤</div><h3>Noch keine Fälle vorhanden</h3><p>Sobald Falldaten importiert wurden, können Sie hier mit der Prüfung beginnen.</p></div></section>
      </main><footer><span>WZ-VALIDIERUNG <b> / </b> FORSCHUNGSPROTOTYP</span><span>Entscheidungen im Kontext verstehen.</span></footer>
    </div>
  )
}
export default App
