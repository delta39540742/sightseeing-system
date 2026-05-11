import { useState } from 'react';
import './DevSimulation.css';

// ─── Types (mirrors backend response) ────────────────────────────────────────

type ScenarioKey = 'rain_heavy' | 'rain_moderate' | 'traffic_heavy' | 'traffic_moderate' | 'closure';
type TransportKey = 'car' | 'motorbike';
type ActivityType = 'sightseeing' | 'meal' | 'rest' | 'transport' | 'activity';

interface TripSlot {
  slotId: string;
  dayIndex: number;
  slotOrder: number;
  placeId: number;
  plannedStart: string;
  plannedEnd: string;
  activityType: ActivityType;
  status: string;
  estimatedCost: number;
}

interface Place {
  placeId: number;
  name: string;
  lat: number;
  lng: number;
  indoorOutdoor: 'indoor' | 'outdoor' | 'mixed';
  avgVisitDurationMin: number;
  estimatedCost: number;
  tags: { tagId: number }[];
}

interface CriterionResult {
  id: string;
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
  level: 'error' | 'warning' | 'info';
}

interface EffectivenessReport {
  overallPass: boolean;
  passRate: number;
  criteria: CriterionResult[];
  suggestions: string[];
  devNote: string;
}

interface SimulateResult {
  scenario: ScenarioKey;
  scenarioLabel: string;
  scoreBefore: number;
  scoreAfter: number;
  scoreImprovementPct: number;
  mutationCount: number;
  mutationSummary: { operator: string; description: string; affectedSlotIds: string[] }[];
  oldPlan: TripSlot[];
  newPlan: TripSlot[];
  placesMap: Record<number, Place>;
  effectiveness: EffectivenessReport;
  causalTrace: { stepIndex: number; operator: string; reason: string; affectedSlotIds: string[] }[];
  computeTimeMs: number;
  isFallback: boolean;
  isTimeout: boolean;
}

interface HistoryItem {
  proposalId: string;
  tripId: string;
  createdAt: string;
  scoreBefore: number;
  scoreAfter: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  oldPlan: TripSlot[];
  newPlan: TripSlot[];
  causalTrace: { stepIndex?: number; operator?: string; reason?: string }[];
  effectiveness: (EffectivenessReport & { incidentType: string; incidentSeverity: string }) | null;
}

// ─── Scenario config ──────────────────────────────────────────────────────────

const SCENARIOS: Array<{
  key: ScenarioKey;
  icon: string;
  label: string;
  desc: string;
  cssClass: string;
}> = [
  { key: 'rain_heavy',    icon: '⛈',  label: 'Mưa lớn',         desc: '>25 mm/h',         cssClass: 'rain-heavy' },
  { key: 'rain_moderate', icon: '🌧',  label: 'Mưa vừa',         desc: '5–25 mm/h',        cssClass: 'rain-mod' },
  { key: 'traffic_heavy', icon: '🚗',  label: 'Kẹt xe nặng',     desc: '~45 phút trễ',     cssClass: 'traffic-h' },
  { key: 'closure',       icon: '🔒',  label: 'Quán đóng cửa',   desc: 'Đột xuất',         cssClass: 'closure' },
];

const STATUS_LABEL: Record<string, string> = {
  pending:  'Chờ duyệt',
  accepted: 'Đã chấp nhận',
  rejected: 'Đã từ chối',
  expired:  'Hết hạn',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  const h = (d.getUTCHours() + 7) % 24;
  const m = d.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });
}

function isSlotChanged(slot: TripSlot, oldPlan: TripSlot[]): boolean {
  const old = oldPlan.find((s) => s.slotOrder === slot.slotOrder && s.dayIndex === slot.dayIndex);
  return !old || old.placeId !== slot.placeId;
}

function isSlotAdded(slot: TripSlot, oldPlan: TripSlot[]): boolean {
  return !oldPlan.some((s) => s.slotId === slot.slotId);
}

function activityLabel(type: ActivityType): string {
  const map: Record<ActivityType, string> = {
    sightseeing: 'Tham quan',
    meal: 'Bữa ăn',
    rest: 'Nghỉ ngơi',
    transport: 'Di chuyển',
    activity: 'Hoạt động',
  };
  return map[type] ?? type;
}

function scoreDelta(before: number, after: number): string {
  const d = after - before;
  return `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SlotCard({
  slot,
  place,
  variant,
}: {
  slot: TripSlot;
  place: Place | { name: string; indoorOutdoor: string } | undefined;
  variant: 'normal' | 'changed' | 'added' | 'removed';
}) {
  return (
    <div className={`slot-item ${variant !== 'normal' ? variant : ''}`}>
      <span className="slot-time">{formatTime(slot.plannedStart)}</span>
      <div className="slot-info">
        <div className="slot-name">{place?.name ?? `Place #${slot.placeId}`}</div>
        <div className="slot-tags">
          {place && (
            <span className={`slot-tag ${place.indoorOutdoor}`}>
              {place.indoorOutdoor === 'indoor' ? 'Trong nhà' : place.indoorOutdoor === 'mixed' ? 'Hỗn hợp' : 'Ngoài trời'}
            </span>
          )}
          <span className={`slot-tag ${slot.activityType === 'meal' ? 'meal' : slot.activityType === 'rest' ? 'rest' : ''}`}>
            {activityLabel(slot.activityType)}
          </span>
          {variant === 'changed' && <span className="slot-tag changed">THAY THẾ</span>}
          {variant === 'added'   && <span className="slot-tag new">MỚI THÊM</span>}
        </div>
      </div>
    </div>
  );
}

function ScoreBlock({
  label,
  value,
  type,
}: {
  label: string;
  value: string;
  type: 'before' | 'after' | 'delta';
}) {
  return (
    <div className="score-value">
      <div className="score-label">{label}</div>
      <div className={`score-number ${type}`}>{value}</div>
    </div>
  );
}

function CriteriaTable({ report }: { report: EffectivenessReport }) {
  const statusClass = (c: CriterionResult) => {
    if (c.pass) return 'pass';
    if (c.level === 'error') return 'fail-error';
    if (c.level === 'warning') return 'fail-warn';
    return 'info';
  };
  const statusLabel = (c: CriterionResult) => {
    if (c.pass) return '✓ Đạt';
    if (c.level === 'error') return '✗ Lỗi';
    if (c.level === 'warning') return '⚠ Cảnh báo';
    return 'ℹ Info';
  };

  const passColor = `hsl(${Math.round(report.passRate * 120)}, 60%, 50%)`;

  return (
    <div className="effectiveness-section">
      <div className="effectiveness-header">
        <span className="section-title">Đánh giá hiệu quả</span>
        <div className="pass-rate-badge">
          <div className="pass-rate-bar-wrap">
            <div
              className="pass-rate-bar"
              style={{ width: `${report.passRate * 100}%`, background: passColor }}
            />
          </div>
          <span className="pass-rate-pct" style={{ color: passColor }}>
            {Math.round(report.passRate * 100)}%
          </span>
        </div>
      </div>

      <table className="criteria-table">
        <thead>
          <tr>
            <th style={{ width: 100 }}>Kết quả</th>
            <th>Tiêu chí</th>
            <th>Thực tế</th>
          </tr>
        </thead>
        <tbody>
          {report.criteria.map((c) => (
            <tr key={c.id}>
              <td>
                <span className={`criteria-status ${statusClass(c)}`}>{statusLabel(c)}</span>
              </td>
              <td>
                <div className="criteria-label">{c.label}</div>
                <div className="criteria-actual">{c.expected}</div>
              </td>
              <td style={{ color: '#a0aec0', fontSize: 12 }}>{c.actual}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={`dev-note ${report.overallPass ? 'pass' : 'fail'}`}>
        {report.devNote}
      </div>
    </div>
  );
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryDetail({
  item,
  pm,
}: {
  item: HistoryItem;
  pm: Record<number, { placeId: number; name: string; indoorOutdoor: string }>;
}) {
  const oldPlan = item.oldPlan;
  const newPlan = item.newPlan;
  const delta = item.scoreAfter - item.scoreBefore;

  return (
    <>
      {/* Score banner */}
      <div className="score-banner">
        <ScoreBlock label="ĐIỂM TRƯỚC" value={item.scoreBefore.toFixed(2)} type="before" />
        <div className="score-arrow">→</div>
        <ScoreBlock label="ĐIỂM SAU" value={item.scoreAfter.toFixed(2)} type="after" />
        <div className="score-arrow"></div>
        <div className="score-delta">
          <div className="score-label">THAY ĐỔI</div>
          <div className={`score-pct ${delta >= 0 ? 'positive' : 'negative'}`}>
            {scoreDelta(item.scoreBefore, item.scoreAfter)}
          </div>
          {item.effectiveness && (
            <div className="score-meta">
              <span className={`score-tag ${item.effectiveness.overallPass ? 'pass' : item.effectiveness.passRate >= 0.5 ? 'warn' : 'fail'}`}>
                {item.effectiveness.overallPass ? '✓ ĐẠT YÊU CẦU' : `${Math.round(item.effectiveness.passRate * 100)}% tiêu chí đạt`}
              </span>
              <span className="score-tag neutral">
                {item.effectiveness.incidentType} / {item.effectiveness.incidentSeverity}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Before / After timeline */}
      <div className="timeline-section">
        <div className="timeline-section-header">
          <span className="section-title">So sánh lịch trình thực tế</span>
        </div>
        <div className="timeline-grid">
          <div className="timeline-col">
            <div className="timeline-col-header before">📋 TRƯỚC KHI REPLAN</div>
            {oldPlan.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13, padding: 12 }}>Không có dữ liệu</div>
            )}
            {oldPlan.map((slot) => (
              <SlotCard
                key={slot.slotId ?? `${slot.dayIndex}-${slot.slotOrder}`}
                slot={slot}
                place={pm[slot.placeId]}
                variant="normal"
              />
            ))}
          </div>

          <div className="timeline-col">
            <div className="timeline-col-header after">✅ SAU KHI REPLAN</div>
            {newPlan.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13, padding: 12 }}>Không có dữ liệu</div>
            )}
            {newPlan.map((slot) => {
              const added = isSlotAdded(slot, oldPlan);
              const changed = !added && isSlotChanged(slot, oldPlan);
              return (
                <SlotCard
                  key={slot.slotId ?? `${slot.dayIndex}-${slot.slotOrder}`}
                  slot={slot}
                  place={pm[slot.placeId]}
                  variant={added ? 'added' : changed ? 'changed' : 'normal'}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Effectiveness criteria */}
      {item.effectiveness && <CriteriaTable report={item.effectiveness} />}
      {!item.effectiveness && (
        <div style={{ color: '#64748b', fontSize: 13, padding: '12px 0' }}>
          Chưa có dữ liệu đánh giá hiệu quả cho proposal này.
        </div>
      )}

      {/* Causal trace */}
      {item.causalTrace.length > 0 && (
        <div className="trace-section">
          <p className="panel-title" style={{ marginBottom: 20 }}>Quá trình ra quyết định (Causal Trace)</p>
          <ol className="trace-list">
            {item.causalTrace.map((step, i) => (
              <li key={step.stepIndex ?? i} className="trace-step">
                <div className="trace-step-num">{(step.stepIndex ?? i) + 1}</div>
                <div className="trace-step-content">
                  {step.operator && <div className="trace-op">{step.operator}</div>}
                  <div className="trace-desc">{step.reason ?? '—'}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DevSimulation() {
  // Demo tab state
  const [scenario, setScenario] = useState<ScenarioKey>('rain_heavy');
  const [transport, setTransport] = useState<TransportKey>('motorbike');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // History tab state
  const [activeTab, setActiveTab] = useState<'demo' | 'history'>('demo');
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyPm, setHistoryPm] = useState<Record<number, { placeId: number; name: string; indoorOutdoor: string }>>({});
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);

  async function runSimulation() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/demo/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, transportType: transport }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).message ?? `HTTP ${res.status}`);
      }
      const data: SimulateResult = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch('/api/demo/history?limit=20&offset=0');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistoryItems(data.items ?? []);
      setHistoryPm(data.placesMap ?? {});
      setHistoryTotal(data.total ?? 0);
      if ((data.items ?? []).length > 0) setSelectedItem(data.items[0]);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Lỗi không xác định');
    } finally {
      setHistoryLoading(false);
    }
  }

  function switchTab(tab: 'demo' | 'history') {
    setActiveTab(tab);
    if (tab === 'history' && historyItems.length === 0 && !historyLoading) {
      loadHistory();
    }
  }

  const pm = result?.placesMap ?? {};
  const oldPlan = result?.oldPlan ?? [];
  const newPlan = result?.newPlan ?? [];

  return (
    <div className="dev-sim">
      {/* Header */}
      <header className="dev-sim-header">
        <div className="dev-sim-header-left">
          <h1>REPLAN SIMULATION</h1>
          <span className="dev-sim-badge">CÔNG CỤ NỘI BỘ — DEV &amp; PROJECT OWNER</span>
        </div>
        <div style={{ fontSize: 12, color: '#4a5568', textAlign: 'right', lineHeight: 1.5 }}>
          Trang này không hiển thị với người dùng cuối<br />
          Mô phỏng bằng địa điểm thật Đà Nẵng từ DB
        </div>
      </header>

      {/* Tab bar */}
      <div className="dev-sim-tabbar">
        <button
          className={`dev-sim-tab ${activeTab === 'demo' ? 'active' : ''}`}
          onClick={() => switchTab('demo')}
        >
          ▶ Mô phỏng
        </button>
        <button
          className={`dev-sim-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => switchTab('history')}
        >
          📂 Lịch sử thực tế
        </button>
      </div>

      {/* ── DEMO TAB ── */}
      {activeTab === 'demo' && (
        <div className="dev-sim-body">
          {/* LEFT: Scenario control */}
          <aside className="scenario-panel">
            <p className="panel-title">Chọn tình huống</p>

            <div className="scenario-cards">
              {SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  className={`scenario-card ${s.cssClass} ${scenario === s.key ? 'active' : ''}`}
                  onClick={() => setScenario(s.key)}
                >
                  <span className="scenario-icon">{s.icon}</span>
                  <div className="scenario-label">
                    {s.label}
                    <br />
                    <span style={{ fontWeight: 400, color: '#64748b' }}>{s.desc}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Transport type — only relevant for rain */}
            {(scenario === 'rain_heavy' || scenario === 'rain_moderate') && (
              <div className="transport-row">
                <p className="panel-title" style={{ marginBottom: 10 }}>Phương tiện di chuyển</p>
                <div className="transport-toggle">
                  <button
                    className={`transport-btn ${transport === 'motorbike' ? 'active' : ''}`}
                    onClick={() => setTransport('motorbike')}
                  >
                    🛵 Xe máy
                  </button>
                  <button
                    className={`transport-btn ${transport === 'car' ? 'active' : ''}`}
                    onClick={() => setTransport('car')}
                  >
                    🚗 Xe hơi
                  </button>
                </div>
              </div>
            )}

            <button className="run-btn" onClick={runSimulation} disabled={loading}>
              {loading ? (
                <>
                  <span className="run-btn-spinner" />
                  Đang tính toán...
                </>
              ) : (
                '▶  Chạy mô phỏng'
              )}
            </button>

            <div style={{ marginTop: 20, padding: '14px 16px', background: '#12151f', borderRadius: 12, fontSize: 12, color: '#64748b', lineHeight: 1.7 }}>
              <strong style={{ color: '#8892b0', display: 'block', marginBottom: 6 }}>Quy trình demo:</strong>
              1. Tải địa điểm thật Đà Nẵng từ DB<br />
              2. Dựng lịch trình mẫu 6 điểm/ngày<br />
              3. Tiêm tình huống vào ngữ cảnh<br />
              4. Chạy BeamSearch (tối đa 4.5s)<br />
              5. Đánh giá theo tiêu chí đã thỏa thuận
            </div>
          </aside>

          {/* RIGHT: Results */}
          <main className="results-panel">
            {error && <div className="error-banner">⚠ Lỗi: {error}</div>}

            {!result && !error && (
              <div className="empty-state">
                <span className="empty-icon">🗺</span>
                <div className="empty-title">Chọn tình huống và nhấn Chạy mô phỏng</div>
                <div className="empty-sub">
                  Hệ thống sẽ tự động xây dựng lịch trình mẫu từ địa điểm thật ở Đà Nẵng,<br />
                  tiêm tình huống bất ngờ, sau đó chạy thuật toán BeamSearch để đề xuất lịch tối ưu.
                </div>
              </div>
            )}

            {result && (
              <>
                {/* Score banner */}
                <div className="score-banner">
                  <ScoreBlock label="ĐIỂM TRƯỚC" value={result.scoreBefore.toFixed(2)} type="before" />
                  <div className="score-arrow">→</div>
                  <ScoreBlock label="ĐIỂM SAU" value={result.scoreAfter.toFixed(2)} type="after" />
                  <div className="score-arrow"></div>
                  <div className="score-delta">
                    <div className="score-label">CẢI THIỆN</div>
                    <div className={`score-pct ${result.scoreImprovementPct >= 0 ? 'positive' : 'negative'}`}>
                      {result.scoreImprovementPct >= 0 ? '+' : ''}{result.scoreImprovementPct.toFixed(1)}%
                    </div>
                    <div className="score-meta">
                      <span className={`score-tag ${result.effectiveness.overallPass ? 'pass' : result.effectiveness.passRate >= 0.5 ? 'warn' : 'fail'}`}>
                        {result.effectiveness.overallPass ? '✓ ĐẠT YÊU CẦU' : `${Math.round(result.effectiveness.passRate * 100)}% tiêu chí đạt`}
                      </span>
                      <span className="score-tag neutral">
                        {result.computeTimeMs}ms
                      </span>
                    </div>
                  </div>
                </div>

                {/* Compute metrics */}
                <div className="metrics-row">
                  <div className="metric-chip">
                    <div className="metric-value">{result.mutationCount}</div>
                    <div className="metric-label">Mutation thực hiện</div>
                  </div>
                  <div className="metric-chip">
                    <div className="metric-value">{result.effectiveness.criteria.filter(c => c.pass).length}/{result.effectiveness.criteria.length}</div>
                    <div className="metric-label">Tiêu chí đạt</div>
                  </div>
                  <div className="metric-chip">
                    <div className="metric-value">{result.computeTimeMs}ms</div>
                    <div className="metric-label">Thời gian xử lý</div>
                  </div>
                  <div className="metric-chip">
                    <div className="metric-value">{newPlan.filter(s => s.placeId !== (oldPlan.find(o => o.slotOrder === s.slotOrder)?.placeId ?? -1)).length}</div>
                    <div className="metric-label">Slot được thay</div>
                  </div>
                </div>

                {/* Before / After timeline */}
                <div className="timeline-section">
                  <div className="timeline-section-header">
                    <span className="section-title">So sánh lịch trình: {result.scenarioLabel}</span>
                  </div>
                  <div className="timeline-grid">
                    <div className="timeline-col">
                      <div className="timeline-col-header before">📋 TRƯỚC KHI REPLAN</div>
                      {oldPlan.map((slot) => (
                        <SlotCard key={slot.slotId} slot={slot} place={pm[slot.placeId]} variant="normal" />
                      ))}
                    </div>

                    <div className="timeline-col">
                      <div className="timeline-col-header after">✅ SAU KHI REPLAN</div>
                      {newPlan.map((slot) => {
                        const added = isSlotAdded(slot, oldPlan);
                        const changed = !added && isSlotChanged(slot, oldPlan);
                        return (
                          <SlotCard
                            key={slot.slotId}
                            slot={slot}
                            place={pm[slot.placeId]}
                            variant={added ? 'added' : changed ? 'changed' : 'normal'}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Effectiveness criteria */}
                <CriteriaTable report={result.effectiveness} />

                {/* Causal trace */}
                {result.causalTrace.length > 0 && (
                  <div className="trace-section">
                    <p className="panel-title" style={{ marginBottom: 20 }}>Quá trình ra quyết định (Causal Trace)</p>
                    <ol className="trace-list">
                      {result.causalTrace.map((step) => (
                        <li key={step.stepIndex} className="trace-step">
                          <div className="trace-step-num">{step.stepIndex + 1}</div>
                          <div className="trace-step-content">
                            <div className="trace-op">{step.operator}</div>
                            <div className="trace-desc">{step.reason}</div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {result.causalTrace.length === 0 && (
                  <div className="trace-section">
                    <p className="panel-title">Quá trình ra quyết định</p>
                    <div style={{ color: '#64748b', fontSize: 13, padding: '8px 0' }}>
                      {result.isFallback
                        ? '⚠ BeamSearch trả về kết quả dự phòng (fallback) — kế hoạch giữ nguyên.'
                        : 'Kế hoạch đã tối ưu — không cần thay đổi lớn.'}
                    </div>
                  </div>
                )}

                {/* Agreement summary */}
                <div style={{ background: '#1a1d2e', border: '1px solid #2a2d3e', borderRadius: 16, padding: '20px 24px' }}>
                  <p className="panel-title" style={{ marginBottom: 12 }}>Đối chiếu với thỏa thuận</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {[
                      { req: 'Xử lý thời tiết xấu (mưa)',  done: scenario.startsWith('rain') },
                      { req: 'Xử lý kẹt xe',               done: scenario.startsWith('traffic') },
                      { req: 'Xử lý quán đóng cửa',        done: scenario === 'closure' },
                      { req: 'Đề xuất lộ trình tối ưu',    done: result.scoreAfter >= result.scoreBefore },
                      { req: 'Minh bạch lý do thay đổi',   done: result.causalTrace.length > 0 },
                      { req: 'Xử lý trong < 5 giây',       done: result.computeTimeMs < 5000 },
                    ].map((item) => (
                      <div
                        key={item.req}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                          borderRadius: 10,
                          background: item.done ? 'rgba(76,175,80,0.08)' : 'rgba(239,83,80,0.08)',
                          border: `1px solid ${item.done ? 'rgba(76,175,80,0.25)' : 'rgba(239,83,80,0.25)'}`,
                        }}
                      >
                        <span style={{ fontSize: 16 }}>{item.done ? '✅' : '❌'}</span>
                        <span style={{ fontSize: 12, color: item.done ? '#a5d6a7' : '#ef9a9a' }}>{item.req}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {activeTab === 'history' && (
        <div className="dev-sim-body">
          {/* LEFT: Proposal list */}
          <aside className="scenario-panel history-list-panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <p className="panel-title" style={{ margin: 0 }}>Proposals thực tế ({historyTotal})</p>
              <button
                onClick={loadHistory}
                disabled={historyLoading}
                style={{ fontSize: 11, padding: '4px 10px', background: '#1e2235', border: '1px solid #2a2d3e', borderRadius: 6, color: '#8892b0', cursor: 'pointer' }}
              >
                {historyLoading ? '...' : '↻ Tải lại'}
              </button>
            </div>

            {historyError && <div className="error-banner" style={{ marginBottom: 12 }}>⚠ {historyError}</div>}

            {historyLoading && (
              <div style={{ color: '#64748b', fontSize: 13, padding: 12 }}>Đang tải...</div>
            )}

            {!historyLoading && historyItems.length === 0 && !historyError && (
              <div style={{ color: '#64748b', fontSize: 13, padding: 12, lineHeight: 1.6 }}>
                Chưa có proposal nào trong DB.<br />
                Thực hiện một chuyến đi và kích hoạt replan để tạo dữ liệu.
              </div>
            )}

            <div className="history-item-list">
              {historyItems.map((item) => {
                const delta = item.scoreAfter - item.scoreBefore;
                const isSelected = selectedItem?.proposalId === item.proposalId;
                return (
                  <button
                    key={item.proposalId}
                    className={`history-item-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className="history-item-header">
                      <span className="history-trip-id" title={item.tripId}>
                        Trip {item.tripId.slice(0, 8)}…
                      </span>
                      <span className={`history-status status-${item.status}`}>
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                    </div>
                    <div className="history-item-meta">
                      <span style={{ color: '#8892b0', fontSize: 11 }}>{formatDate(item.createdAt)}</span>
                    </div>
                    <div className="history-item-scores">
                      <span style={{ color: '#a0aec0', fontSize: 12 }}>
                        {item.scoreBefore.toFixed(2)} → {item.scoreAfter.toFixed(2)}
                      </span>
                      <span className={`history-delta ${delta >= 0 ? 'positive' : 'negative'}`}>
                        {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                      </span>
                    </div>
                    {item.effectiveness && (
                      <div className="history-item-pass">
                        <span className={`score-tag ${item.effectiveness.overallPass ? 'pass' : 'fail'}`} style={{ fontSize: 10 }}>
                          {item.effectiveness.overallPass ? '✓ Đạt' : '✗ Không đạt'}
                        </span>
                        <span style={{ color: '#64748b', fontSize: 10, marginLeft: 4 }}>
                          {item.effectiveness.incidentType}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          {/* RIGHT: Selected proposal detail */}
          <main className="results-panel">
            {!selectedItem && !historyLoading && (
              <div className="empty-state">
                <span className="empty-icon">📂</span>
                <div className="empty-title">Chọn một proposal từ danh sách</div>
                <div className="empty-sub">
                  Danh sách bên trái liệt kê các replan đã xảy ra thực tế.<br />
                  Nhấn vào để xem so sánh lịch trình cũ và mới.
                </div>
              </div>
            )}

            {selectedItem && (
              <HistoryDetail item={selectedItem} pm={historyPm} />
            )}
          </main>
        </div>
      )}
    </div>
  );
}